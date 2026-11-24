// 試し方：リポジトリのいちばん上で  node --test supabase/functions/school-login/ticket.test.ts
// GAS と同じ作り方で通行証を作り、Supabase の係の確かめ方（ticket.ts）で通るかを試す
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifyTicket, schoolUserEmail } from './ticket.ts'

const SECRET = 'dummy-ticket-secret-for-test'
const SALT = 'dummy-salt-for-test'
// GAS の Utilities.base64EncodeWebSafe は「=」を付ける
const gasB64 = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
const subjectOf = (email: string) => createHmac('sha256', SALT).update(email).digest('hex')
function gasTicket(over: Record<string, unknown> = {}, secret = SECRET) {
  const payload = JSON.stringify({ v: 1, sub: subjectOf('dummy01@school.example'), dom: 'school.example', state: 'S'.repeat(32),
    nonce: 'n'.repeat(32), exp: Math.floor(Date.now() / 1000) + 120, ...over })
  const data = gasB64(Buffer.from(payload, 'utf8'))
  const sig = gasB64(createHmac('sha256', secret).update(data).digest())
  return data + '.' + sig
}
const ST = 'S'.repeat(32), DOMS = ['school.example']

test('GAS と同じ作り方の通行証が通る', async () => {
  const r = await verifyTicket(gasTicket(), ST, SECRET, DOMS, Date.now())
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.payload.sub, subjectOf('dummy01@school.example'))
})
test('先生か生徒かを読み取る（ないときは生徒、ほかの値は断る）', async () => {
  const t = await verifyTicket(gasTicket({ role: 'teacher' }), ST, SECRET, DOMS, Date.now())
  assert.equal(t.ok && t.payload.role, 'teacher')
  const s0 = await verifyTicket(gasTicket(), ST, SECRET, DOMS, Date.now())
  assert.equal(s0.ok && s0.payload.role, 'student')
  assert.equal((await verifyTicket(gasTicket({ role: 'admin' }), ST, SECRET, DOMS, Date.now())).ok, false)
})
test('合言葉がちがうと通らない', async () => {
  assert.equal((await verifyTicket(gasTicket({}, 'other'), ST, SECRET, DOMS, Date.now())).ok, false)
})
test('中身を書きかえると通らない', async () => {
  const [d, s] = gasTicket().split('.')
  const p = JSON.parse(Buffer.from(d, 'base64url').toString()); p.dom = 'evil.example'
  const d2 = gasB64(Buffer.from(JSON.stringify(p)))
  assert.equal((await verifyTicket(d2 + '.' + s, ST, SECRET, ['school.example', 'evil.example'], Date.now())).ok, false)
})
test('期限切れ・遠すぎる期限は通らない', async () => {
  const now = Date.now()
  assert.match(String((await verifyTicket(gasTicket({ exp: Math.floor(now / 1000) - 1 }), ST, SECRET, DOMS, now) as any).error), /期限が切れて/)
  assert.equal((await verifyTicket(gasTicket({ exp: Math.floor(now / 1000) + 3600 }), ST, SECRET, DOMS, now)).ok, false)
})
test('画面の番号（state）がちがうと通らない', async () => {
  assert.match(String((await verifyTicket(gasTicket(), 'T'.repeat(32), SECRET, DOMS, Date.now()) as any).error), /この画面で始めた/)
  assert.equal((await verifyTicket(gasTicket(), 'short', SECRET, DOMS, Date.now())).ok, false)
})
test('許可していない学校は通らない', async () => {
  assert.match(String((await verifyTicket(gasTicket(), ST, SECRET, ['other.example'], Date.now()) as any).error), /この学校/)
})
test('合言葉が設定されていなければ通らない', async () => {
  assert.equal((await verifyTicket(gasTicket(), ST, '', DOMS, Date.now())).ok, false)
})
test('形がおかしい通行証は通らない', async () => {
  for (const t of [null, 1, '', 'abc', 'a.b.c', 'x'.repeat(3000)]) assert.equal((await verifyTicket(t, ST, SECRET, DOMS, Date.now())).ok, false)
})
test('アカウントのメール欄は本人の印から作る（本物のアドレスは入らない）', () => {
  const sub = subjectOf('dummy01@school.example')
  const e = schoolUserEmail(sub)
  assert.equal(e, sub.slice(0, 32) + '@school.mandala.invalid')
  assert.ok(!e.includes('dummy01'))
})
