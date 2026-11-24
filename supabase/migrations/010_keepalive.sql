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
