-- マンダラ発想法：データベースを用意する SQL（001〜010 をまとめたもの）
-- Supabase の SQL Editor に全部貼って、1回だけ Run する。2回目は実行しない（「already exists」のエラーになる）


-- ===================== 001_init.sql =====================
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

-- ===================== 002_advisor_fixes.sql =====================
-- =====================================================================
-- マンダラアプリ 2つ目の SQL（002_advisor_fixes.sql）
-- 001_init.sql を実行したあとに、Supabase の「SQL Editor」で1回だけ実行する。
--
-- Supabase の自動点検（Advisors）で出た注意を直す。
--   1. rls_auto_enable 関数を、外（API）から呼べないようにする
--   2. 読み取りの許可（ポリシー）2つを、速い書き方に直す
--   3. 足りない索引（さくいん）を足す
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. rls_auto_enable を外から呼べないようにする
--    （プロジェクト作成時の「Enable automatic RLS」が作った関数。
--      新しい表に RLS を自動でかける働きは、このあとも変わらない）
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable'
               and p.pronargs = 0) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 2. ポリシーを速い書き方に直す
--    auth.uid() を (select auth.uid()) にすると、行ごとではなく1回だけ計算される
-- ---------------------------------------------------------------------
drop policy "自分の所属と、先生はクラス全員を見られる" on public.group_members;
create policy "自分の所属と、先生はクラス全員を見られる" on public.group_members
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_group_teacher(group_id));

drop policy "持ち主はマンダラを削除できる" on public.mandalas;
create policy "持ち主はマンダラを削除できる" on public.mandalas
  for delete to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 3. 索引を足す（データが増えても、探したり消したりするのが遅くならないように）
-- ---------------------------------------------------------------------
create index if not exists cells_updated_by_idx           on public.cells (updated_by);
create index if not exists group_members_user_idx         on public.group_members (user_id);
create index if not exists groups_created_by_idx          on public.groups (created_by);
create index if not exists mandala_members_user_idx       on public.mandala_members (user_id);
create index if not exists mandalas_group_idx             on public.mandalas (group_id);
create index if not exists mandalas_owner_idx             on public.mandalas (owner_id);
create index if not exists operations_reverts_seq_idx     on public.operations (reverts_seq);
create index if not exists operations_unit_position_idx   on public.operations (unit_id, position);
create index if not exists operations_user_idx            on public.operations (user_id);
create index if not exists share_links_created_by_idx     on public.share_links (created_by);
create index if not exists share_links_mandala_idx        on public.share_links (mandala_id);

-- ===================== 003_pages_and_conflict.sql =====================
-- =====================================================================
-- マンダラアプリ 3つ目の SQL（003_pages_and_conflict.sql）
-- 002 を実行したあとに、Supabase の「SQL Editor」で1回だけ実行する。
--
-- 1. 「続き」のユニット（2枚目・3枚目…）
--    ユニットの8マスがすべて埋まったら、同じ中央（テーマ）の2枚目を自動で作る。
--    2枚目以降は continues_unit_id で1枚目を指し、page に何枚目かを入れる。
-- 2. 同時に書いてぶつかったとき
--    先に確定したほうがそのマスに入る。遅いほうは、時計回りで次の空いているマスに自動で入る。
--    そのユニットに空きがなければ、次の枚（なければ作る）の空いているマスに入る。
-- 3. マンダラごとの基本色（管理者が8色から選ぶ）
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ユニットの表に「何枚目か」を足す
-- ---------------------------------------------------------------------
alter table public.units
  add column continues_unit_id uuid references public.units(id) on delete cascade,
  add column page smallint not null default 1 check (page between 1 and 99);

-- 1枚目は continues_unit_id が空、2枚目以降は1枚目を指す
alter table public.units
  add constraint units_page_consistent check ((continues_unit_id is null) = (page = 1));

-- 同じ1枚目の、同じ枚数は1つだけ
create unique index units_continuation_page_uq
  on public.units (continues_unit_id, page) where continues_unit_id is not null;

-- ---------------------------------------------------------------------
-- 2. 内部用の関数
-- ---------------------------------------------------------------------

-- 続きの枚（2枚目以降）を作る。中央は1枚目と同じ（親のセルや題名を、1枚目を通して表示する）
create or replace function private.create_page(base uuid, pg smallint)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  b   public.units;
  n   integer;
  uid uuid;
begin
  select * into b from public.units where id = base;
  update public.mandalas set next_unit_number = next_unit_number + 1
    where id = b.mandala_id returning next_unit_number - 1 into n;
  insert into public.units (mandala_id, number, parent_unit_id, parent_cell, depth, continues_unit_id, page)
    values (b.mandala_id, n, null, null, b.depth, base, pg) returning id into uid;
  insert into public.cells (unit_id, position, mandala_id)
    select uid, p, b.mandala_id from generate_series(1, 8) as p;
  return uid;
end
$$;

-- 8マスがすべて埋まっていて、次の枚がまだなければ作る
create or replace function private.ensure_next_page(u uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  cur   public.units;
  base  uuid;
  filled integer;
begin
  select * into cur from public.units where id = u;
  if cur.page >= 99 then
    return;
  end if;
  select count(*) into filled from public.cells
    where unit_id = u and btrim(text) <> '';
  if filled < 8 then
    return;
  end if;
  base := coalesce(cur.continues_unit_id, cur.id);
  if not exists (select 1 from public.units
                 where continues_unit_id = base and page = cur.page + 1) then
    perform private.create_page(base, (cur.page + 1)::smallint);
  end if;
end
$$;

-- セルの文字を書き換えて、ログを残す。必要なら子ユニットと続きの枚を作る
-- （001 の同じ名前の関数を置きかえる。続きの枚を作るところだけ足した）
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

  if expected_version is not null and expected_version <> old_ver then
    raise exception 'ほかの人が先に書き換えました' using errcode = '40001',
      detail = json_build_object('text', old_text, 'version', old_ver)::text;
  end if;

  if old_text = new_text then
    return jsonb_build_object('version', old_ver, 'changed', false,
                              'unit_id', u, 'position', pos, 'moved', false);
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
    -- 8マスがすべて埋まったら、続きの枚を用意する
    perform private.ensure_next_page(u);
  end if;

  return jsonb_build_object('version', old_ver + 1, 'changed', true,
                            'seq', new_seq, 'child_unit_id', child,
                            'unit_id', u, 'position', pos, 'moved', false);
end
$$;

-- ぶつかったとき、遅いほうを入れる場所を探す。
-- 時計回りで次のマスから、そのユニットの空いているマス → なければ次の枚（なければ作る）
-- 見つけたマスには鍵をかけて、同時に探しているほかの人と重ならないようにする
create or replace function private.find_free_cell(u uuid, pos smallint, out f_unit uuid, out f_pos smallint)
language plpgsql security definer set search_path = ''
as $$
declare
  cur  public.units;
  base uuid;
  pg   smallint;
  nu   uuid;
  i    integer;
  p    smallint;
  t    text;
begin
  select * into cur from public.units where id = u;

  -- 同じユニットの、次のマスから時計回り
  for i in 1..7 loop
    p := (((pos - 1 + i) % 8) + 1)::smallint;
    select text into t from public.cells where unit_id = u and position = p for update;
    if btrim(t) = '' then
      f_unit := u; f_pos := p; return;
    end if;
  end loop;

  -- 次の枚へ
  base := coalesce(cur.continues_unit_id, cur.id);
  pg := cur.page;
  loop
    pg := pg + 1;
    if pg > 99 then
      raise exception 'これ以上の枚数は作れません' using errcode = '54000';
    end if;
    select id into nu from public.units where continues_unit_id = base and page = pg;
    if nu is null then
      nu := private.create_page(base, pg);
    end if;
    for i in 1..8 loop
      p := i::smallint;
      select text into t from public.cells where unit_id = nu and position = p for update;
      if btrim(t) = '' then
        f_unit := nu; f_pos := p; return;
      end if;
    end loop;
  end loop;
end
$$;

revoke all on function private.create_page(uuid, smallint) from public, anon, authenticated;
revoke all on function private.ensure_next_page(uuid) from public, anon, authenticated;
revoke all on function private.find_free_cell(uuid, smallint) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. セルを書き換える係（001 の同じ名前の関数を置きかえる）
--    返す値：version・changed・child_unit_id に加えて、
--            実際に入れた unit_id・position と、ほかのマスへ移したか（moved）
-- ---------------------------------------------------------------------
create or replace function public.set_cell_text(
  p_unit_id uuid, p_position smallint, p_text text, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  m        uuid;
  cur_text text;
  cur_ver  integer;
  target   record;
  result   jsonb;
begin
  select mandala_id into m from public.units where id = p_unit_id;
  perform private.require_role(m, array['admin', 'editor']);

  select text, version into cur_text, cur_ver
    from public.cells where unit_id = p_unit_id and position = p_position for update;
  if cur_ver is null then
    raise exception 'マスが見つかりません' using errcode = 'P0002';
  end if;

  -- ぶつからなかった、または先に書いた人の文字が空だった → そのマスに入れる
  if p_expected_version is null or p_expected_version = cur_ver or btrim(cur_text) = '' then
    return private.apply_text(p_unit_id, p_position, p_text, 'set_text', null, null, null);
  end if;

  -- 先に書いた人と同じ文字なら、何もしない
  if cur_text = p_text then
    return jsonb_build_object('version', cur_ver, 'changed', false,
                              'unit_id', p_unit_id, 'position', p_position, 'moved', false);
  end if;

  -- 空白だけを書こうとしていたなら、移さずに終わる（先に書いた人の文字を残す）
  if btrim(p_text) = '' then
    return jsonb_build_object('version', cur_ver, 'changed', false,
                              'unit_id', p_unit_id, 'position', p_position, 'moved', false);
  end if;

  -- ぶつかった：先に確定した人を優先し、遅いほうは次の空いているマスへ
  select * into target from private.find_free_cell(p_unit_id, p_position);
  result := private.apply_text(target.f_unit, target.f_pos, p_text, 'set_text', null, null, null);
  return result || jsonb_build_object('moved', true,
                                      'requested_unit_id', p_unit_id,
                                      'requested_position', p_position);
end
$$;

-- ---------------------------------------------------------------------
-- 4. マンダラごとの基本色（一覧や画面で、別のテーマだとわかりやすくする）
-- ---------------------------------------------------------------------
alter table public.mandalas
  add column color text not null default 'green'
    check (color in ('green', 'blue', 'indigo', 'purple', 'pink', 'red', 'orange', 'brown'));

-- 基本色を変える（管理者だけ）
create or replace function public.set_color(p_mandala_id uuid, p_color text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role(p_mandala_id, array['admin']);
  update public.mandalas set color = p_color, updated_at = now() where id = p_mandala_id;
end
$$;

revoke execute on function public.set_color(uuid, text) from public, anon;
grant execute on function public.set_color(uuid, text) to authenticated;

-- ===================== 004_undo.sql =====================
-- =====================================================================
-- マンダラアプリ 4つ目の SQL（004_undo.sql）
-- 003 を実行したあとに、Supabase の「SQL Editor」で1回だけ実行する。
--
-- 自分の書き込みの「取り消し」「やり直し」のための係。
-- ふつうの書き込み（set_cell_text）は、ぶつかったら次の空いたマスへ移すが、
-- 取り消しは移さない。自分のあとにほかの人が同じマスを書き換えていたら、取り消さずに止める。
-- 取り消しも、ふつうの書き換えとして操作ログに残る（消さずに積み上げる）。
-- =====================================================================

create or replace function public.undo_cell_text(
  p_unit_id uuid, p_position smallint, p_text text, p_expected_version integer)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  m uuid;
begin
  select mandala_id into m from public.units where id = p_unit_id;
  perform private.require_role(m, array['admin', 'editor']);
  if p_expected_version is null then
    raise exception '取り消しには、版の番号が必要です' using errcode = '22023';
  end if;
  -- 版の番号がちがえば、apply_text が「ほかの人が先に書き換えました」（40001）で止める
  return private.apply_text(p_unit_id, p_position, p_text, 'set_text', p_expected_version, null, null);
end
$$;

revoke execute on function public.undo_cell_text(uuid, smallint, text, integer) from public, anon;
grant execute on function public.undo_cell_text(uuid, smallint, text, integer) to authenticated;

-- ===================== 005_presence.sql =====================
-- =====================================================================
-- マンダラアプリ 5つ目の SQL（005_presence.sql）
-- 004 を実行したあとに、Supabase の「SQL Editor」で1回だけ実行する。
--
-- 「誰がどこを触っているか」の表示（Supabase Realtime の Presence）のための準備。
-- 1. マンダラごとの設定「打っている途中の文字を見せ合う」（初めはオフ）
-- 2. Presence の通信路に入れるのを、そのマンダラのメンバーだけにする
--    （通信路の名前は 'presence-mandala:<マンダラの番号>'。名前・書いているマス・途中の文字が流れるため）
-- Presence の中身はデータベースに保存されない。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 「打っている途中の文字を見せ合う」の設定
-- ---------------------------------------------------------------------
alter table public.mandalas
  add column show_drafts boolean not null default false;

-- 設定を変える（管理者だけ）
create or replace function public.set_show_drafts(p_mandala_id uuid, p_value boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_role(p_mandala_id, array['admin']);
  update public.mandalas set show_drafts = p_value, updated_at = now() where id = p_mandala_id;
end
$$;

revoke execute on function public.set_show_drafts(uuid, boolean) from public, anon;
grant execute on function public.set_show_drafts(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2. Presence の通信路に入れる人
-- ---------------------------------------------------------------------

-- 通信路の名前から、マンダラの番号を取り出して、ログイン中の人がメンバーかを確かめる
create or replace function private.can_use_presence(topic text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  m uuid;
begin
  if auth.uid() is null or topic is null or topic not like 'presence-mandala:%' then
    return false;
  end if;
  begin
    m := substr(topic, length('presence-mandala:') + 1)::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return private.mandala_role(m) is not null;
end
$$;

revoke all on function private.can_use_presence(text) from public, anon;
grant execute on function private.can_use_presence(text) to authenticated;

-- Realtime は、非公開の通信路（private channel）に入るとき、realtime.messages の許可（RLS）を見る
create policy "メンバーはマンダラの在席を受け取れる" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'presence' and private.can_use_presence(realtime.topic()));

create policy "メンバーはマンダラの在席を知らせられる" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension = 'presence' and private.can_use_presence(realtime.topic()));

-- ===================== 006_presence_broadcast.sql =====================
-- =====================================================================
-- マンダラアプリ 6つ目の SQL（006_presence_broadcast.sql）
-- 005 を実行したあとに、Supabase の「SQL Editor」で1回だけ実行する。
--
-- 「誰がどこを触っているか」で、どのマスを触っているか・途中の文字を、
-- Presence（在席）ではなく Broadcast（放送）で送るようにしたための許可。
-- （Presence は1人あたり30秒に5回までしか知らせ直せず、マスを押すたびに送ると止められるため）
-- 通信路は 005 と同じ 'presence-mandala:<マンダラの番号>'。入れるのはそのマンダラのメンバーだけ。
-- 放送の中身はデータベースに保存されない。
-- =====================================================================

create policy "メンバーは触っている場所を受け取れる" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast' and private.can_use_presence(realtime.topic()));

create policy "メンバーは触っている場所を知らせられる" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and private.can_use_presence(realtime.topic()));

-- ===================== 007_conflict_errcode.sql =====================
-- =====================================================================
-- マンダラアプリ 7つ目の SQL（007_conflict_errcode.sql）
-- 006 を実行したあとに、Supabase の「SQL Editor」で1回だけ実行する。
-- （急ぐときは 006 の前でもよい。この SQL だけで、下の空回りは止まる）
--
-- 「ほかの人が先に書き換えました」のエラーの番号を 40001 から PT409 に変える。
-- 40001 は PostgreSQL で「同時に動いたので、やり直せば通るかもしれない」という意味の番号で、
-- Supabase の PostgREST（データの窓口）は、この番号のエラーを自動で何度もやり直す。
-- 版の番号がちがうときは何度やり直しても通らないので、終わらない空回りになり、
-- CPU が 99% になっていた（2026-11-03 に見つけた）。
-- PT409 は PostgREST で「HTTP 409（ぶつかった）を返す」という意味の番号で、やり直さない。
-- 関数の中身は、エラーの番号のほかは 003・001 と同じ。
-- =====================================================================

-- 003 の apply_text（取り消しで版の番号がちがうときのエラー）
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

  if expected_version is not null and expected_version <> old_ver then
    raise exception 'ほかの人が先に書き換えました' using errcode = 'PT409',
      detail = json_build_object('text', old_text, 'version', old_ver)::text;
  end if;

  if old_text = new_text then
    return jsonb_build_object('version', old_ver, 'changed', false,
                              'unit_id', u, 'position', pos, 'moved', false);
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
    -- 8マスがすべて埋まったら、続きの枚を用意する
    perform private.ensure_next_page(u);
  end if;

  return jsonb_build_object('version', old_ver + 1, 'changed', true,
                            'seq', new_seq, 'child_unit_id', child,
                            'unit_id', u, 'position', pos, 'moved', false);
end
$$;

-- 001 の revert_operation（管理者の取り消し。今はまだ画面から使っていない）
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
      raise exception 'この操作のあとに、同じセルが書き換えられています' using errcode = 'PT409';
    end if;
    perform private.apply_text(op.unit_id, op.position, op.before->>'text',
                               'revert', null, op.seq, null);
  elsif op.before ? 'title' then
    select title into cur from public.mandalas where id = op.mandala_id;
    if not p_force and cur is distinct from op.after->>'title' then
      raise exception 'この操作のあとに、題名が書き換えられています' using errcode = 'PT409';
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

-- ===================== 008_student_rooms.sql =====================
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

-- ===================== 009_school_students.sql =====================
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

-- ===================== 010_keepalive.sql =====================
-- =====================================================================
-- マンダラアプリ 10個目の SQL（010_keepalive.sql）
-- 009 を実行したあとに、Supabase の「SQL Editor」で1回だけ実行する。
--
-- Supabase の無料プランは、1週間データベースが使われないと、プロジェクトが自動で止まる。
-- 学校の GAS「マンダラ通行証」が毎日1回 keepalive() を呼んで、止まらないようにする。
--   ・ログインしていなくても呼べる（GAS は公開用の publishable キーで呼ぶ）
--   ・することは「最後に呼ばれた時刻」を1行だけ書きかえることだけ。生徒のデータは読まない・書かない
-- =====================================================================

-- 最後に呼ばれた時刻（1行だけ。API からは見えない置き場所）
create table private.keepalive (
  id        boolean primary key default true check (id),
  pinged_at timestamptz not null default now()
);
insert into private.keepalive (id) values (true);
alter table private.keepalive enable row level security;
revoke all on private.keepalive from public, anon, authenticated;

-- 「生きてる？」と聞かれたら、時刻を書きかえて true を返す
create or replace function public.keepalive()
returns boolean
language sql volatile security definer set search_path = ''
as $$
  update private.keepalive set pinged_at = now() where id;
  select true;
$$;

revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
