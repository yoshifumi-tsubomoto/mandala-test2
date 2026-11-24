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
