-- =====================================================================
-- マンダラアプリ 8つ目の SQL（008_student_rooms.sql）
-- 007 を実行したあとに、Supabase の「SQL Editor」で1回だけ実行する。
--
-- 生徒が「部屋の合言葉」で入れるようにする（Google ログインを使わない）。
--   ・生徒は Supabase の「匿名ログイン」で、名前のない仮のアカウントを作り、合言葉でマンダラに入る
--   ・匿名の生徒にできるのは、合言葉で入ったマンダラを書く（または見る）ことだけ
--     （マンダラを作る・招待リンクを作る/使う・クラスを作る/入る、はできない）
--   ・部屋は先生（管理者）が開く。開いてから24時間で自動で閉じる。先生が閉じることもできる
--   ・先生は、入った生徒を外せる。外した生徒は、同じ部屋にもう入れない
--   ・合言葉のまちがいが続いたら、しばらく待たせる（当てずっぽうで入られないように）
--
-- このあと、Supabase の「Authentication」で匿名ログインをオンにする（手順は説明を参照）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 表
-- ---------------------------------------------------------------------

-- 部屋（マンダラ1枚ごと）。code は読みまちがえやすい文字（0 O 1 I）を使わない6文字
create table public.rooms (
  code       text primary key check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  mandala_id uuid not null references public.mandalas(id) on delete cascade,
  role       text not null check (role in ('editor', 'viewer')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed     boolean not null default false
);
create index rooms_mandala_idx    on public.rooms (mandala_id);
create index rooms_created_by_idx on public.rooms (created_by);

-- 部屋から入った人の表示名（先生が一覧で見るため）。Google で入った人は空のまま
alter table public.mandala_members
  add column display_name text check (char_length(display_name) between 1 and 20);

-- 先生が外した人（同じマンダラの部屋には、もう入れない）
create table public.room_kicks (
  mandala_id uuid not null references public.mandalas(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kicked_by  uuid references auth.users(id) on delete set null,
  kicked_at  timestamptz not null default now(),
  primary key (mandala_id, user_id)
);
create index room_kicks_user_idx      on public.room_kicks (user_id);
create index room_kicks_kicked_by_idx on public.room_kicks (kicked_by);

-- 合言葉のまちがいの記録（API からは見えない置き場所）
create table private.room_attempts (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index room_attempts_user_at_idx on private.room_attempts (user_id, at);

-- ---------------------------------------------------------------------
-- 2. 内部用の関数
-- ---------------------------------------------------------------------

-- ログイン中の人が、匿名ログイン（部屋の合言葉で入る生徒）かどうか
create or replace function private.is_anonymous()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;

-- 匿名の生徒なら止める
create or replace function private.forbid_anonymous()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.is_anonymous() then
    raise exception '部屋の合言葉で入った人は、この操作ができません' using errcode = '42501';
  end if;
end
$$;

-- 合言葉を作る（6文字。A〜Z と 2〜9 のうち、I と O を除く32文字から）
create or replace function private.new_room_code()
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  letters constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b    bytea;
  c    text;
  i    integer;
begin
  loop
    b := decode(md5(gen_random_uuid()::text), 'hex');
    c := '';
    for i in 0..5 loop
      c := c || substr(letters, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.rooms r where r.code = c);
  end loop;
  return c;
end
$$;

revoke all on function private.is_anonymous()     from public, anon;
revoke all on function private.forbid_anonymous() from public, anon;
revoke all on function private.new_room_code()    from public, anon;
grant execute on function private.is_anonymous()     to authenticated;
grant execute on function private.forbid_anonymous() to authenticated;
grant execute on function private.new_room_code()    to authenticated;

-- ---------------------------------------------------------------------
-- 3. 匿名の生徒にさせない操作（001 の係に、止める1行を足す。ほかは 001 と同じ）
-- ---------------------------------------------------------------------

create or replace function public.create_mandala(p_title text, p_group_id uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  m uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインしていません' using errcode = '42501';
  end if;
  perform private.forbid_anonymous();
  if p_group_id is not null and not private.is_group_member(p_group_id) then
    raise exception 'そのグループに入っていません' using errcode = '42501';
  end if;
  insert into public.mandalas (title, owner_id, group_id)
    values (p_title, auth.uid(), p_group_id) returning id into m;
  insert into public.mandala_members (mandala_id, user_id, role)
    values (m, auth.uid(), 'admin');
  perform private.create_unit(m, null, null, 1);
  return m;
end
$$;

create or replace function public.join_by_link(p_token text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  l public.share_links;
begin
  if auth.uid() is null then
    raise exception 'ログインしていません' using errcode = '42501';
  end if;
  perform private.forbid_anonymous();
  select * into l from public.share_links where token = p_token and not revoked;
  if l.token is null then
    raise exception 'このリンクは使えません' using errcode = 'P0002';
  end if;
  insert into public.mandala_members (mandala_id, user_id, role)
    values (l.mandala_id, auth.uid(), l.role)
  on conflict (mandala_id, user_id) do update
    set role = excluded.role
    where public.mandala_members.role = 'viewer' and excluded.role = 'editor';
  return l.mandala_id;
end
$$;

create or replace function public.create_group(p_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  g uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインしていません' using errcode = '42501';
  end if;
  perform private.forbid_anonymous();
  insert into public.groups (name, created_by) values (p_name, auth.uid()) returning id into g;
  insert into public.group_members (group_id, user_id, role) values (g, auth.uid(), 'teacher');
  return g;
end
$$;

create or replace function public.join_group(p_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  g uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインしていません' using errcode = '42501';
  end if;
  perform private.forbid_anonymous();
  select id into g from public.groups where join_code = upper(btrim(p_code));
  if g is null then
    raise exception '参加コードがちがいます' using errcode = 'P0002';
  end if;
  insert into public.group_members (group_id, user_id, role)
    values (g, auth.uid(), 'student')
  on conflict (group_id, user_id) do nothing;
  return g;
end
$$;

-- 招待リンクを作る（管理者。匿名の生徒は管理者になれないが、念のため止める）
create or replace function public.create_share_link(p_mandala_id uuid, p_role text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  t text;
begin
  perform private.forbid_anonymous();
  perform private.require_role(p_mandala_id, array['admin']);
  insert into public.share_links (mandala_id, role, created_by)
    values (p_mandala_id, p_role, auth.uid()) returning token into t;
  return t;
end
$$;

-- ---------------------------------------------------------------------
-- 4. 部屋の係
-- ---------------------------------------------------------------------

-- 部屋を開く（管理者）。開いている部屋があれば閉じて、新しい合言葉にする
create or replace function public.open_room(p_mandala_id uuid, p_role text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.rooms;
begin
  perform private.forbid_anonymous();
  perform private.require_role(p_mandala_id, array['admin']);
  if p_role not in ('editor', 'viewer') then
    raise exception '役わりがちがいます' using errcode = '22023';
  end if;
  update public.rooms set closed = true where mandala_id = p_mandala_id and not closed;
  insert into public.rooms (code, mandala_id, role, created_by, expires_at)
    values (private.new_room_code(), p_mandala_id, p_role, auth.uid(), now() + interval '24 hours')
    returning * into r;
  return jsonb_build_object('code', r.code, 'role', r.role, 'expires_at', r.expires_at);
end
$$;

-- 部屋を閉じる（管理者）。もう入った人はそのまま
create or replace function public.close_room(p_mandala_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role(p_mandala_id, array['admin']);
  update public.rooms set closed = true where mandala_id = p_mandala_id and not closed;
end
$$;

-- 合言葉で入る。入れたらマンダラの番号、合言葉がちがえば null を返す
-- （まちがいを記録するために、エラーにせず null を返す。10分に10回まちがえたら待たせる）
create or replace function public.join_room(p_code text, p_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  c    text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
  nm   text := btrim(coalesce(p_name, ''));
  r    public.rooms;
begin
  if auth.uid() is null then
    raise exception 'ログインしていません' using errcode = '42501';
  end if;
  if char_length(nm) not between 1 and 20 then
    raise exception '名前は1〜20文字で入れてください' using errcode = '22023';
  end if;
  if (select count(*) from private.room_attempts
      where user_id = auth.uid() and at > now() - interval '10 minutes') >= 10 then
    raise exception '合言葉のまちがいが続いたので、10分ほど待ってからためしてください'
      using errcode = '54000';
  end if;

  select * into r from public.rooms
    where code = c and not closed and expires_at > now();
  if r.code is null then
    insert into private.room_attempts (user_id) values (auth.uid());
    delete from private.room_attempts where at < now() - interval '1 day';
    return null;
  end if;

  if exists (select 1 from public.room_kicks
             where mandala_id = r.mandala_id and user_id = auth.uid()) then
    raise exception 'この部屋には入れません。先生に伝えてください' using errcode = '42501';
  end if;

  -- すでに入っていれば、権限は下げない（見るだけ → 書ける、だけ上げる）
  insert into public.mandala_members (mandala_id, user_id, role, display_name)
    values (r.mandala_id, auth.uid(), r.role, nm)
  on conflict (mandala_id, user_id) do update
    set role = case
                 when public.mandala_members.role = 'viewer' and excluded.role = 'editor' then 'editor'
                 else public.mandala_members.role
               end,
        display_name = coalesce(public.mandala_members.display_name, excluded.display_name);
  return r.mandala_id;
end
$$;

-- 部屋から入った人を外す（管理者）。外した人は、このマンダラの部屋にもう入れない
create or replace function public.remove_room_member(p_mandala_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.forbid_anonymous();
  perform private.require_role(p_mandala_id, array['admin']);
  if p_user_id = auth.uid()
     or exists (select 1 from public.mandalas where id = p_mandala_id and owner_id = p_user_id) then
    raise exception '自分や持ち主は外せません' using errcode = '22023';
  end if;
  delete from public.mandala_members where mandala_id = p_mandala_id and user_id = p_user_id;
  insert into public.room_kicks (mandala_id, user_id, kicked_by)
    values (p_mandala_id, p_user_id, auth.uid())
  on conflict (mandala_id, user_id) do nothing;
end
$$;

revoke execute on function public.open_room(uuid, text)                from public, anon;
revoke execute on function public.close_room(uuid)                     from public, anon;
revoke execute on function public.join_room(text, text)                from public, anon;
revoke execute on function public.remove_room_member(uuid, uuid)       from public, anon;
grant execute on function public.open_room(uuid, text)                to authenticated;
grant execute on function public.close_room(uuid)                     to authenticated;
grant execute on function public.join_room(text, text)                to authenticated;
grant execute on function public.remove_room_member(uuid, uuid)       to authenticated;

-- ---------------------------------------------------------------------
-- 5. 読み取りの許可（RLS）。書き込みは係だけ
-- ---------------------------------------------------------------------
alter table public.rooms      enable row level security;
alter table public.room_kicks enable row level security;
alter table private.room_attempts enable row level security;

revoke all on public.rooms, public.room_kicks from anon, authenticated;
grant select on public.rooms, public.room_kicks to authenticated;
revoke all on private.room_attempts from public, anon, authenticated;

create policy "管理者は部屋を見られる" on public.rooms
  for select to authenticated using (private.mandala_role(mandala_id) = 'admin');

create policy "管理者は外した人を見られる" on public.room_kicks
  for select to authenticated using (private.mandala_role(mandala_id) = 'admin');
