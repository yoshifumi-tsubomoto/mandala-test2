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
