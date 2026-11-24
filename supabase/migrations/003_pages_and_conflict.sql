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
