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
