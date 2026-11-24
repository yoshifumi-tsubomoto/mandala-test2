-- =====================================================================
-- マンダラアプリ 初期設定 SQL（001_init.sql）
-- Supabase の「SQL Editor」に貼り付けて、1回だけ実行する。
--
-- 方針
--   ・ブラウザからは表を直接書き換えられない（RLS で読むことだけ許す）
--   ・書き換えはすべて「係」（関数）を通す。係は必ず操作ログを残す
--   ・中央セルの文字は保存しない（親セルの文字を表示する）
--   ・セルの文字を消しても、子ユニットは消さない（画面で灰色に隠す）
-- =====================================================================

-- 外から呼ばれない内部用の置き場所（API に公開されない）
create schema if not exists private;

-- ---------------------------------------------------------------------
-- 1. 表
-- ---------------------------------------------------------------------

-- クラスや班のまとまり。先生(teacher)は、所属する生徒のマンダラをすべて管理できる
create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 100),
  join_code   text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  created_by  uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.group_members (
  group_id  uuid not null references public.groups(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null check (role in ('teacher', 'student')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- マンダラ1枚。title が最初のユニットの中央（テーマ）になる
create table public.mandalas (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (char_length(title) between 1 and 200),
  owner_id         uuid not null references auth.users(id) on delete cascade,
  group_id         uuid references public.groups(id) on delete set null,
  next_unit_number integer not null default 2,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- マンダラごとの権限：admin（管理者）/ editor（編集者）/ viewer（閲覧者）
create table public.mandala_members (
  mandala_id uuid not null references public.mandalas(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin', 'editor', 'viewer')),
  joined_at  timestamptz not null default now(),
  primary key (mandala_id, user_id)
);

-- URL で共有するための招待リンク
create table public.share_links (
  token      text primary key default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  mandala_id uuid not null references public.mandalas(id) on delete cascade,
  role       text not null check (role in ('editor', 'viewer')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked    boolean not null default false
);

-- ユニット（3×3）。最初のユニットだけ親がない
create table public.units (
  id             uuid primary key default gen_random_uuid(),
  mandala_id     uuid not null references public.mandalas(id) on delete cascade,
  number         integer not null,
  parent_unit_id uuid references public.units(id) on delete cascade,
  parent_cell    smallint check (parent_cell between 1 and 8),
  depth          integer not null check (depth between 1 and 256),
  x              real,
  y              real,
  created_at     timestamptz not null default now(),
  unique (mandala_id, number),
  unique (parent_unit_id, parent_cell),
  check ((parent_unit_id is null) = (parent_cell is null))
);
create index units_mandala_idx on public.units (mandala_id);

-- 周りの8セル。position は左上を1として時計回りに1〜8
create table public.cells (
  unit_id    uuid not null references public.units(id) on delete cascade,
  position   smallint not null check (position between 1 and 8),
  mandala_id uuid not null references public.mandalas(id) on delete cascade,
  text       text not null default '' check (char_length(text) <= 500),
  version    integer not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (unit_id, position)
);
create index cells_mandala_idx on public.cells (mandala_id);

-- 操作ログ。消さずに積み上げる
create table public.operations (
  seq         bigint generated always as identity primary key,
  mandala_id  uuid not null references public.mandalas(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  kind        text not null check (kind in ('set_text', 'set_title', 'move_unit', 'revert', 'restore')),
  unit_id     uuid references public.units(id) on delete cascade,
  position    smallint,
  before      jsonb,
  after       jsonb,
  reverts_seq bigint references public.operations(seq),
  restore_to  bigint
);
create index operations_mandala_seq_idx on public.operations (mandala_id, seq);

-- ---------------------------------------------------------------------
-- 2. 内部用の関数（private：API からは呼べない）
-- ---------------------------------------------------------------------

-- ログイン中の人の、そのマンダラでの権限（なければ null）
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
    else (select mm.role from public.mandala_members mm
          where mm.mandala_id = m and mm.user_id = auth.uid())
  end
$$;

create or replace function private.is_group_member(g uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.group_members
                 where group_id = g and user_id = auth.uid())
$$;

create or replace function private.is_group_teacher(g uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.group_members
                 where group_id = g and user_id = auth.uid() and role = 'teacher')
$$;

-- 権限が足りなければ止める
create or replace function private.require_role(m uuid, allowed text[])
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'ログインしていません' using errcode = '42501';
  end if;
  if coalesce(private.mandala_role(m), '') <> all (allowed) then
    raise exception 'この操作をする権限がありません' using errcode = '42501';
  end if;
end
$$;

-- ユニットを1つ作り、空の8セルも作る
create or replace function private.create_unit(m uuid, parent uuid, cell smallint, d integer)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  n   integer;
  uid uuid;
begin
  if parent is null then
    n := 1;
  else
    update public.mandalas set next_unit_number = next_unit_number + 1
      where id = m returning next_unit_number - 1 into n;
  end if;
  insert into public.units (mandala_id, number, parent_unit_id, parent_cell, depth)
    values (m, n, parent, cell, d) returning id into uid;
  insert into public.cells (unit_id, position, mandala_id)
    select uid, p, m from generate_series(1, 8) as p;
  return uid;
end
$$;

-- セルの文字を書き換えて、ログを残す。必要なら子ユニットを作る
create or replace function private.apply_text(
  u uuid, pos smallint, new_text text, op_kind text,
  expected_version integer, reverts bigint, restore_seq bigint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  m        uuid;
  d        integer;
  old_text text;
  old_ver  integer;
  child    uuid;
  new_seq  bigint;
begin
  select mandala_id, depth into m, d from public.units where id = u;
  if m is null then
    raise exception 'ユニットが見つかりません' using errcode = 'P0002';
  end if;

  select text, version into old_text, old_ver
    from public.cells where unit_id = u and position = pos for update;

  -- 同時に書いたときの衝突（楽観ロック）
  if expected_version is not null and expected_version <> old_ver then
    raise exception 'ほかの人が先に書き換えました' using errcode = '40001',
      detail = json_build_object('text', old_text, 'version', old_ver)::text;
  end if;

  if old_text = new_text then
    return jsonb_build_object('version', old_ver, 'changed', false);
  end if;

  update public.cells
    set text = new_text, version = version + 1,
        updated_by = auth.uid(), updated_at = now()
    where unit_id = u and position = pos;

  insert into public.operations
    (mandala_id, user_id, kind, unit_id, position, before, after, reverts_seq, restore_to)
  values
    (m, auth.uid(), op_kind, u, pos,
     jsonb_build_object('text', old_text), jsonb_build_object('text', new_text),
     reverts, restore_seq)
  returning seq into new_seq;

  update public.mandalas set updated_at = now() where id = m;

  -- 文字が入ったら、そのセルを中央にした子ユニットを用意する（256段まで）
  if btrim(new_text) <> '' and d < 256 then
    select id into child from public.units where parent_unit_id = u and parent_cell = pos;
    if child is null then
      child := private.create_unit(m, u, pos, d + 1);
    end if;
  end if;

  return jsonb_build_object('version', old_ver + 1, 'changed', true,
                            'seq', new_seq, 'child_unit_id', child);
end
$$;

-- 題名（最初のユニットの中央）を書き換えて、ログを残す
create or replace function private.apply_title(
  m uuid, new_title text, op_kind text, reverts bigint, restore_seq bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  old_title text;
begin
  select title into old_title from public.mandalas where id = m for update;
  if old_title = new_title then
    return;
  end if;
  update public.mandalas set title = new_title, updated_at = now() where id = m;
  insert into public.operations
    (mandala_id, user_id, kind, before, after, reverts_seq, restore_to)
  values
    (m, auth.uid(), op_kind,
     jsonb_build_object('title', old_title), jsonb_build_object('title', new_title),
     reverts, restore_seq);
end
$$;

-- ---------------------------------------------------------------------
-- 3. ブラウザから呼ぶ「係」（public：supabase.rpc('名前', {...}) で呼ぶ）
-- ---------------------------------------------------------------------

-- 新しいマンダラを作る（group_id を渡すと、そのクラスの先生も管理できる）
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

-- セルの文字を書き換える（編集者以上）
create or replace function public.set_cell_text(
  p_unit_id uuid, p_position smallint, p_text text, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  m uuid;
begin
  select mandala_id into m from public.units where id = p_unit_id;
  perform private.require_role(m, array['admin', 'editor']);
  return private.apply_text(p_unit_id, p_position, p_text, 'set_text',
                            p_expected_version, null, null);
end
$$;

-- 題名を書き換える（編集者以上）
create or replace function public.set_title(p_mandala_id uuid, p_title text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role(p_mandala_id, array['admin', 'editor']);
  perform private.apply_title(p_mandala_id, p_title, 'set_title', null, null);
end
$$;

-- 自由配置ビューでユニットを動かす（編集者以上。ドラッグを終えたときに1回だけ呼ぶ）
create or replace function public.move_unit(p_unit_id uuid, p_x real, p_y real)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m  uuid;
  ox real;
  oy real;
begin
  select mandala_id, x, y into m, ox, oy from public.units where id = p_unit_id for update;
  perform private.require_role(m, array['admin', 'editor']);
  update public.units set x = p_x, y = p_y where id = p_unit_id;
  insert into public.operations (mandala_id, user_id, kind, unit_id, before, after)
  values (m, auth.uid(), 'move_unit', p_unit_id,
          jsonb_build_object('x', ox, 'y', oy), jsonb_build_object('x', p_x, 'y', p_y));
end
$$;

-- 管理者が、指定した操作を取り消す
--   その後に同じセルが書き換えられていたら止める（p_force = true なら上書きする）
create or replace function public.revert_operation(p_seq bigint, p_force boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  op  public.operations;
  cur text;
begin
  select * into op from public.operations where seq = p_seq;
  if op.seq is null then
    raise exception '操作が見つかりません' using errcode = 'P0002';
  end if;
  perform private.require_role(op.mandala_id, array['admin']);

  if op.unit_id is not null and op.position is not null then
    select text into cur from public.cells where unit_id = op.unit_id and position = op.position;
    if not p_force and cur is distinct from op.after->>'text' then
      raise exception 'この操作のあとに、同じセルが書き換えられています' using errcode = '40001';
    end if;
    perform private.apply_text(op.unit_id, op.position, op.before->>'text',
                               'revert', null, op.seq, null);
  elsif op.before ? 'title' then
    select title into cur from public.mandalas where id = op.mandala_id;
    if not p_force and cur is distinct from op.after->>'title' then
      raise exception 'この操作のあとに、題名が書き換えられています' using errcode = '40001';
    end if;
    perform private.apply_title(op.mandala_id, op.before->>'title', 'revert', op.seq, null);
  elsif op.kind = 'move_unit' then
    update public.units
      set x = (op.before->>'x')::real, y = (op.before->>'y')::real
      where id = op.unit_id;
    insert into public.operations (mandala_id, user_id, kind, unit_id, before, after, reverts_seq)
    values (op.mandala_id, auth.uid(), 'revert', op.unit_id, op.after, op.before, op.seq);
  else
    raise exception 'この操作は取り消せません' using errcode = '22023';
  end if;
end
$$;

-- 管理者が、マンダラ全体を「p_seq 番の操作が終わった時点」に巻き戻す
--   古いログは消さず、戻すための操作を新しく積む（巻き戻しも取り消せる）
create or replace function public.restore_to(p_mandala_id uuid, p_seq bigint)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r     record;
  cnt   integer := 0;
begin
  perform private.require_role(p_mandala_id, array['admin']);

  -- 各セルについて、p_seq より後の最初の操作の before が「その時点の文字」
  for r in
    select distinct on (o.unit_id, o.position)
           o.unit_id, o.position, o.before->>'text' as text_then
    from public.operations o
    where o.mandala_id = p_mandala_id and o.seq > p_seq
      and o.unit_id is not null and o.position is not null
    order by o.unit_id, o.position, o.seq
  loop
    perform private.apply_text(r.unit_id, r.position, r.text_then, 'restore', null, null, p_seq);
    cnt := cnt + 1;
  end loop;

  -- 題名も同じ考え方で戻す
  for r in
    select o.before->>'title' as title_then
    from public.operations o
    where o.mandala_id = p_mandala_id and o.seq > p_seq and o.before ? 'title'
    order by o.seq
    limit 1
  loop
    perform private.apply_title(p_mandala_id, r.title_then, 'restore', null, p_seq);
    cnt := cnt + 1;
  end loop;

  return cnt;
end
$$;

-- 招待リンクを作る（管理者）
create or replace function public.create_share_link(p_mandala_id uuid, p_role text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  t text;
begin
  perform private.require_role(p_mandala_id, array['admin']);
  insert into public.share_links (mandala_id, role, created_by)
    values (p_mandala_id, p_role, auth.uid()) returning token into t;
  return t;
end
$$;

-- 招待リンクを無効にする（管理者）
create or replace function public.revoke_share_link(p_token text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  m uuid;
begin
  select mandala_id into m from public.share_links where token = p_token;
  perform private.require_role(m, array['admin']);
  update public.share_links set revoked = true where token = p_token;
end
$$;

-- 招待リンクから参加する（ログインした人だけ）。すでに上の権限があれば下げない
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

-- クラス（グループ）を作る。作った人は先生になる
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
  insert into public.groups (name, created_by) values (p_name, auth.uid()) returning id into g;
  insert into public.group_members (group_id, user_id, role) values (g, auth.uid(), 'teacher');
  return g;
end
$$;

-- 参加コードでクラスに入る（生徒として）
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

-- ---------------------------------------------------------------------
-- 4. 読み取りの許可（RLS）。書き込みの許可は出さない（係だけが書ける）
-- ---------------------------------------------------------------------
alter table public.groups          enable row level security;
alter table public.group_members   enable row level security;
alter table public.mandalas        enable row level security;
alter table public.mandala_members enable row level security;
alter table public.share_links     enable row level security;
alter table public.units           enable row level security;
alter table public.cells           enable row level security;
alter table public.operations      enable row level security;

create policy "メンバーはクラスを見られる" on public.groups
  for select to authenticated using (private.is_group_member(id));

create policy "自分の所属と、先生はクラス全員を見られる" on public.group_members
  for select to authenticated
  using (user_id = auth.uid() or private.is_group_teacher(group_id));

create policy "権限のある人はマンダラを見られる" on public.mandalas
  for select to authenticated using (private.mandala_role(id) is not null);

create policy "持ち主はマンダラを削除できる" on public.mandalas
  for delete to authenticated using (owner_id = auth.uid());

create policy "権限のある人はメンバーを見られる" on public.mandala_members
  for select to authenticated using (private.mandala_role(mandala_id) is not null);

create policy "管理者は招待リンクを見られる" on public.share_links
  for select to authenticated using (private.mandala_role(mandala_id) = 'admin');

create policy "権限のある人はユニットを見られる" on public.units
  for select to authenticated using (private.mandala_role(mandala_id) is not null);

create policy "権限のある人はセルを見られる" on public.cells
  for select to authenticated using (private.mandala_role(mandala_id) is not null);

create policy "権限のある人は操作ログを見られる" on public.operations
  for select to authenticated using (private.mandala_role(mandala_id) is not null);

-- ---------------------------------------------------------------------
-- 5. 関数を呼べる人を絞る
-- ---------------------------------------------------------------------
revoke all on schema private from public;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on function private.mandala_role(uuid)     to authenticated;
grant execute on function private.is_group_member(uuid)  to authenticated;
grant execute on function private.is_group_teacher(uuid) to authenticated;

revoke execute on function public.create_mandala(text, uuid)                       from public, anon;
revoke execute on function public.set_cell_text(uuid, smallint, text, integer)     from public, anon;
revoke execute on function public.set_title(uuid, text)                            from public, anon;
revoke execute on function public.move_unit(uuid, real, real)                      from public, anon;
revoke execute on function public.revert_operation(bigint, boolean)                from public, anon;
revoke execute on function public.restore_to(uuid, bigint)                         from public, anon;
revoke execute on function public.create_share_link(uuid, text)                    from public, anon;
revoke execute on function public.revoke_share_link(text)                          from public, anon;
revoke execute on function public.join_by_link(text)                               from public, anon;
revoke execute on function public.create_group(text)                               from public, anon;
revoke execute on function public.join_group(text)                                 from public, anon;

grant execute on function public.create_mandala(text, uuid)                       to authenticated;
grant execute on function public.set_cell_text(uuid, smallint, text, integer)     to authenticated;
grant execute on function public.set_title(uuid, text)                            to authenticated;
grant execute on function public.move_unit(uuid, real, real)                      to authenticated;
grant execute on function public.revert_operation(bigint, boolean)                to authenticated;
grant execute on function public.restore_to(uuid, bigint)                         to authenticated;
grant execute on function public.create_share_link(uuid, text)                    to authenticated;
grant execute on function public.revoke_share_link(text)                          to authenticated;
grant execute on function public.join_by_link(text)                               to authenticated;
grant execute on function public.create_group(text)                               to authenticated;
grant execute on function public.join_group(text)                                 to authenticated;

-- 表への権限をいったん全部外してから、必要なものだけ出す
-- （読むことだけ。削除はマンダラの持ち主だけ RLS で許可。ログインしていない人には何も出さない）
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant delete on public.mandalas to authenticated;

-- ---------------------------------------------------------------------
-- 6. リアルタイム（ほかの人の変更をすぐ画面に届ける）
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table
  public.mandalas, public.units, public.cells, public.operations;
