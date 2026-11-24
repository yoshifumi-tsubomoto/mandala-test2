// 学校の GAS「マンダラ通行証」が作った通行証を確かめる（通信しない部分。テストあり）。
// 通行証の形は gas/school-ticket/コード.gs の makeTicket_ と同じ：
//   base64url(中身の JSON) + "." + base64url(HMAC-SHA256(TICKET_SECRET, base64url(中身の JSON)))
// GAS の Utilities.base64EncodeWebSafe は末尾に "=" を付けるので、比べる前に "=" を取る。

export interface TicketPayload {
  v: number
  /** 本人の印（アドレスから GAS が作る。アドレスには戻せない） */
  sub: string
  /** 学校のドメイン */
  dom: string
  /** 先生か生徒か（学校の GAS の TEACHER_EMAILS に登録したアドレスが先生。古い通行証にはないので、ないときは生徒） */
  role: 'teacher' | 'student'
  /** アプリが作った画面の番号（ほかの人の通行証を使わせないため） */
  state: string
  /** 1回きりの番号 */
  nonce: string
  /** 期限（UNIX 秒） */
  exp: number
}

export type TicketResult = { ok: true; payload: TicketPayload } | { ok: false; error: string }

/** 通行証の期限の上限（GAS は2分で作る。時計のずれを見て少しだけ余裕を持たせる） */
export const MAX_TICKET_AGE_SEC = 5 * 60

function stripPad(s: string): string {
  return s.replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = stripPad(s).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}

/** 長さに関係なく同じ時間で比べる（署名を少しずつ当てられないように） */
function sameString(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

export async function verifyTicket(
  ticket: unknown,
  state: unknown,
  secret: string,
  domains: string[],
  nowMs: number,
): Promise<TicketResult> {
  if (!secret) return { ok: false, error: '係の設定（SCHOOL_TICKET_SECRET）がまだ済んでいません' }
  if (typeof ticket !== 'string' || ticket.length > 2000) return { ok: false, error: '通行証の形が正しくありません' }
  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(state)) {
    return { ok: false, error: '画面の番号が正しくありません。マンダラ発想法からやり直してください' }
  }
  const parts = ticket.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, error: '通行証の形が正しくありません' }

  const expected = toBase64Url(await hmac(secret, parts[0]))
  if (!sameString(expected, stripPad(parts[1]))) return { ok: false, error: '通行証を確かめられませんでした' }

  let p: Partial<TicketPayload>
  try {
    p = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[0])))
  } catch {
    return { ok: false, error: '通行証を読み取れません' }
  }
  if (p.v !== 1) return { ok: false, error: '通行証の版がちがいます' }
  if (typeof p.sub !== 'string' || !/^[0-9a-f]{64}$/.test(p.sub)) return { ok: false, error: '通行証の中身が正しくありません' }
  if (typeof p.dom !== 'string' || !domains.includes(p.dom)) return { ok: false, error: 'この学校のアカウントでは入れません' }
  if (p.role === undefined) p.role = 'student'
  if (p.role !== 'teacher' && p.role !== 'student') return { ok: false, error: '通行証の中身が正しくありません' }
  if (typeof p.nonce !== 'string' || p.nonce.length < 16) return { ok: false, error: '通行証の中身が正しくありません' }
  if (typeof p.exp !== 'number') return { ok: false, error: '通行証の中身が正しくありません' }
  const now = Math.floor(nowMs / 1000)
  if (p.exp < now) return { ok: false, error: '通行証の期限が切れています。もう一度「学校のアカウントで入る」を押してください' }
  if (p.exp > now + MAX_TICKET_AGE_SEC) return { ok: false, error: '通行証の期限が正しくありません' }
  if (p.state !== state) return { ok: false, error: 'この画面で始めたログインではありません。もう一度「学校のアカウントで入る」を押してください' }
  return { ok: true, payload: p as TicketPayload }
}

/** Supabase に置くアカウントのメール欄（本物ではないアドレス。本人の印から作る） */
export function schoolUserEmail(sub: string): string {
  return `${sub.slice(0, 32)}@school.mandala.invalid`
}
