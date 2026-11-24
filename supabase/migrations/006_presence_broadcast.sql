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
