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
