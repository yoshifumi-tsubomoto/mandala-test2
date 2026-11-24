// 学校のアカウントで入る（学校の GAS「マンダラ通行証」→ Supabase の係 school-login）の、通信しない部分。テストあり。
// 設計図：docs/設計_学校のGASで生徒の本人確認.md

import type { Session } from '@supabase/supabase-js'

/** このブラウザのタブに覚えておく「画面の番号」の名前 */
export const SCHOOL_STATE_KEY = 'mandala-school-state'

/** 画面の番号（ほかの人の通行証を使わせないため。英数字と - _ の32文字） */
export function newSchoolState(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 学校の GAS を開くアドレス */
export function schoolLoginUrl(gasUrl: string, returnUrl: string, state: string): string {
  const u = new URL(gasUrl)
  u.searchParams.set('return', returnUrl)
  u.searchParams.set('state', state)
  return u.toString()
}

/** 戻ってきたアドレスの # のうしろから通行証を取り出す（なければ null） */
export function ticketFromHash(hash: string): string | null {
  const h = hash.startsWith('#') ? hash.slice(1) : hash
  const t = new URLSearchParams(h).get('ticket')
  return t && t.length <= 2000 ? t : null
}

interface SchoolMeta {
  school?: unknown
  school_role?: unknown
}

function schoolMeta(session: Session | null): SchoolMeta {
  return (session?.user.app_metadata ?? {}) as SchoolMeta
}

/** 学校のアカウントで入った人か（先生も生徒も。Supabase の係が app_metadata.school を入れる） */
export function isSchoolSession(session: Session | null): boolean {
  const { school } = schoolMeta(session)
  return typeof school === 'string' && school !== ''
}

/**
 * 学校のアカウントで入った先生なら、その学校（ドメイン）。先生でなければ null。
 * 先生かどうかは、学校の GAS の TEACHER_EMAILS に登録したアドレスかどうかで決まる（本人は変えられない）
 */
export function teacherSchoolOf(session: Session | null): string | null {
  const { school, school_role } = schoolMeta(session)
  return isSchoolSession(session) && school_role === 'teacher' ? (school as string) : null
}

/** 学校のアカウントで入った生徒か（先生ではない） */
export function isSchoolStudent(session: Session | null): boolean {
  return isSchoolSession(session) && teacherSchoolOf(session) === null
}
