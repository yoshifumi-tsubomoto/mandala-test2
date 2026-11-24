-- =====================================================================
-- マンダラアプリ 9つ目の SQL（009_school_students.sql）
-- 008 を実行したあとに、Supabase の「SQL Editor」で1回だけ実行する。
--
-- 学校のアカウントで入った人（⑧）のための決まり。
-- Supabase の係 school-login が app_metadata に school（学校）と school_role（teacher / student）を入れる。
-- 先生かどうかは、学校の GAS のスクリプトプロパティ TEACHER_EMAILS に登録したアドレスかどうかで決まる
-- （登録したアドレスが先生、それ以外はすべて生徒。アドレスそのものは Supabase には来ない）。
--
--   1. 学校の生徒は、自分のマンダラを作れる・招待リンクで入れる・クラスに入れる
--      招待リンクを作る・部屋を開く・部屋の生徒を外す・クラスを作る、は先生だけ
--   2. 学校の生徒が作ったマンダラには学校のしるしがつき、その学校の先生には全部見える（管理者と同じ）
--   3. 表示名（profiles）：生徒が自分で決める。その学校の先生が一覧で見られる
--   4. 通行証の「1回きりの番号」を記録して、同じ通行証を2回使えないようにする（係だけが使う）
--
-- 書きかえる係は、001・008 と同じ中身に、それぞれ数行を足しただけ。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 学校の先生・生徒かどうか（app_metadata は本人が書きかえられない）
-- ---------------------------------------------------------------------

-- 学校の生徒か（学校のしるしがあり、先生ではない）
create or replace function private.is_school_student()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'school', '') <> ''
     and coalesce(auth.jwt() -> 'app_metadata' ->> 'school_role', 'student') <> 'teacher'
$$;

-- 学校の先生なら、その学校（ドメイン）。先生でなければ null
create or replace function private.teacher_school()
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when auth.jwt() -> 'app_metadata' ->> 'school_role' = 'teacher'
      then nullif(auth.jwt() -> 'app_metadata' ->> 'school', '')
  end
$$;

-- 生徒（部屋の合言葉の匿名の生徒・学校の生徒）なら止める
create or replace function private.forbid_student()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if private.is_anonymous() then
    raise exception '部屋の合言葉で入った人は、この操作ができません' using errcode = '42501';
  end if;
  if private.is_school_student() then
    raise exception '生徒のアカウントでは、この操作ができません（先生に頼んでください）' using errcode = '42501';
  end if;
end
$$;

revoke all on function private.is_school_student() from public, anon;
revoke all on function private.teacher_school()    from public, anon;
revoke all on function private.forbid_student()    from public, anon;
grant execute on function private.is_school_student() to authenticated;
grant execute on function private.teacher_school()    to authenticated;
grant execute on function private.forbid_student()    to authenticated;

-- ---------------------------------------------------------------------
-- 2. 学校の生徒が作ったマンダラは、その学校の先生に見える
-- ---------------------------------------------------------------------
alter table public.mandalas add column school text;
create index mandalas_school_idx on public.mandalas (school) where school is not null;

-- 001 の mandala_role に「その学校の先生なら管理者」を1つ足した
create or replace function private.mandala_role(m uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when exists (select 1 from public.mandalas x
                 where x.id = m and x.owner_id = auth.uid()) then 'admin'
    when exists (select 1 from public.mandalas x
                 join public.group_members g on g.group_id = x.group_id
                 where x.id = m and g.user_id = auth.uid() and g.role = 'teacher') then 'admin'
    when exists (select 1 from public.mandalas x
                 where x.id = m and x.school is not null and x.school = private.teacher_school()) then 'admin'
    else (select mm.role from public.mandala_members mm
          where mm.mandala_id = m and mm.user_id = auth.uid())
  end
$$;

-- 008 の create_mandala に「学校の生徒が作ったら学校のしるしをつける」を足した
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
  -- 学校の生徒が作ったマンダラには、学校のしるしをつける（その学校の先生が見られるように）
  insert into public.mandalas (title, owner_id, group_id, school)
    values (p_title, auth.uid(), p_group_id,
            case when private.is_school_student() then auth.jwt() -> 'app_metadata' ->> 'school' end)
    returning id into m;
  insert into public.mandala_members (mandala_id, user_id, role)
    values (m, auth.uid(), 'admin');
  perform private.create_unit(m, null, null, 1);
  return m;
end
$$;

-- ---------------------------------------------------------------------
-- 3. 先生だけにする係（008 の中身の forbid_anonymous を forbid_student にしただけ）
-- ---------------------------------------------------------------------

create or replace function public.create_share_link(p_mandala_id uuid, p_role text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  t text;
begin
  perform private.forbid_student();
  perform private.require_role(p_mandala_id, array['admin']);
  insert into public.share_links (mandala_id, role, created_by)
    values (p_mandala_id, p_role, auth.uid()) returning token into t;
  return t;
end
$$;

create or replace function public.open_room(p_mandala_id uuid, p_role text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.rooms;
begin
  perform private.forbid_student();
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

create or replace function public.remove_room_member(p_mandala_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.forbid_student();
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
  perform private.forbid_student();
  insert into public.groups (name, created_by) values (p_name, auth.uid()) returning id into g;
  insert into public.group_members (group_id, user_id, role) values (g, auth.uid(), 'teacher');
  return g;
end
$$;

-- ---------------------------------------------------------------------
-- 4. 表示名（学校の先生が、生徒のマンダラの一覧で見る）
-- ---------------------------------------------------------------------
create table public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  school       text,
  updated_at   timestamptz not null default now()
);
create index profiles_school_idx on public.profiles (school) where school is not null;
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update on public.profiles to service_role;

create policy "自分と、学校の先生は表示名を見られる" on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid())
         or (school is not null and school = (select private.teacher_school())));

-- 自分の表示名を決める（1〜20文字）
create or replace function public.set_display_name(p_name text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  nm text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then
    raise exception 'ログインしていません' using errcode = '42501';
  end if;
  if char_length(nm) not between 1 and 20 then
    raise exception '表示名は1〜20文字で入れてください' using errcode = '22023';
  end if;
  insert into public.profiles (user_id, display_name, school)
    values (auth.uid(), nm, nullif(auth.jwt() -> 'app_metadata' ->> 'school', ''))
  on conflict (user_id) do update
    set display_name = excluded.display_name, school = excluded.school, updated_at = now();
end
$$;

revoke execute on function public.set_display_name(text) from public, anon;
grant execute on function public.set_display_name(text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. 通行証の「1回きりの番号」の記録（Supabase の係 school-login だけが使う）
-- ---------------------------------------------------------------------
create table private.school_tickets_used (
  nonce   text primary key check (char_length(nonce) between 16 and 64),
  used_at timestamptz not null default now()
);
alter table private.school_tickets_used enable row level security;
revoke all on private.school_tickets_used from public, anon, authenticated;

-- 初めて使う番号なら記録して true、もう使った番号なら false。1日より古い記録は消す
create or replace function public.school_claim_ticket(p_nonce text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  delete from private.school_tickets_used where used_at < now() - interval '1 day';
  insert into private.school_tickets_used (nonce) values (p_nonce) on conflict (nonce) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end
$$;

revoke execute on function public.school_claim_ticket(text) from public, anon, authenticated;
grant execute on function public.school_claim_ticket(text) to service_role;
