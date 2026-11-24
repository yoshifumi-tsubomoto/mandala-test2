// 接続先の設定と、体験モードの判定
//
// Supabase の接続先（URL と anon キー）は app/.env.local に書く（Git には記録しない）:
//   VITE_SUPABASE_URL=https://〇〇.supabase.co
//   VITE_SUPABASE_ANON_KEY=…（anon / publishable キー。service_role キーは絶対に書かない）
//
// 接続先がないとき、または URL に ?demo=1 があるときは「体験モード」になる。
// 体験モードは架空のデータで、ブラウザの中だけで動き、何も送らない。

/** アプリの名前（Google のログイン画面の名前と同じにする） */
export const APP_NAME = 'マンダラ発想法'

export const APP_VERSION = __APP_VERSION__

export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

/** 学校の GAS「マンダラ通行証」のアドレス。あるときだけ「学校のアカウントで入る」を出す（設計図 ⑧） */
export const SCHOOL_LOGIN_URL: string = import.meta.env.VITE_SCHOOL_LOGIN_URL ?? ''

export const hasSupabaseConfig = SUPABASE_URL !== '' && SUPABASE_ANON_KEY !== ''

function demoRequested(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('demo') === '1'
}

export const isDemoMode = !hasSupabaseConfig || demoRequested()
