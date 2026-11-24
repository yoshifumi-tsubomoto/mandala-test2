// Supabase の係（Edge Function）「school-login」【試作】
// 学校の GAS「マンダラ通行証」が作った通行証を確かめて、その生徒のログインの状態を作る。
// 設計図：docs/設計_学校のGASで生徒の本人確認.md
//
// 秘密の設定（Supabase の「Edge Functions」→「Secrets」。リポジトリにもチャットにも書かない）
//   SCHOOL_TICKET_SECRET … GAS のスクリプトプロパティ TICKET_SECRET と同じ値
//   SCHOOL_DOMAINS       … 入ってよい学校のドメイン（カンマ区切り。例：example.ed.jp）
// SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY は、Supabase がはじめから入れてくれる（service_role はこの中だけで使う）
//
// SQL 009 が必要：1回きりの番号（nonce）を school_claim_ticket で記録し、同じ通行証を2回使わせない。
// 学校の生徒に招待リンクを作る・部屋を開く、をさせない決まりも SQL 009 にある。
// アカウントは、メール欄に「本人の印から作った本物ではないアドレス」を入れて探す（本人の印の先頭32文字＝128ビット）。

import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { schoolUserEmail, verifyTicket } from './ticket.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST だけ受け付けます' })

  let body: { ticket?: unknown; state?: unknown }
  try {
    body = await req.json()
  } catch {
    return json(400, { error: '送られてきた内容を読み取れません' })
  }

  const secret = Deno.env.get('SCHOOL_TICKET_SECRET') ?? ''
  const domains = (Deno.env.get('SCHOOL_DOMAINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const checked = await verifyTicket(body.ticket, body.state, secret, domains, Date.now())
  if (!checked.ok) return json(401, { error: checked.error })
  const { sub, dom, role } = checked.payload
  const defaultName = `${role === 'teacher' ? '学校の先生' : '学校の生徒'} ${sub.slice(0, 4)}`

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = schoolUserEmail(sub)

  // 同じ通行証は1回だけ（SQL 009）
  const claimed = await admin.rpc('school_claim_ticket', { p_nonce: checked.payload.nonce })
  if (claimed.error) {
    console.error('school_claim_ticket', claimed.error.code, claimed.error.message)
    return json(500, { error: 'ログインの準備ができませんでした（先生へ：SQL 009 を実行してください）' })
  }
  if (claimed.data !== true) return json(401, { error: 'この通行証はもう使われています。もう一度「学校のアカウントで入る」を押してください' })

  // はじめての生徒なら、アカウントを作る（すでにあれば何もしない）。本物のアドレスは入れない
  const created = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { school: dom, school_role: role },
    user_metadata: { full_name: defaultName },
  })
  if (created.error && created.error.code !== 'email_exists' && !/already/i.test(created.error.message)) {
    console.error('createUser', created.error.code, created.error.message)
    return json(500, { error: 'アカウントを用意できませんでした' })
  }

  // ログインの状態を作るための、1回きりの印を作る（メールは送らない）
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (link.error || !link.data.properties?.hashed_token) {
    console.error('generateLink', link.error?.code, link.error?.message)
    return json(500, { error: 'ログインの準備ができませんでした' })
  }
  // 先生か生徒かが変わっていたら（TEACHER_EMAILS に足した・消した）、直す。ログインの前に直すので、すぐ効く
  const user = link.data.user
  const meta = (user?.app_metadata ?? {}) as { school?: string; school_role?: string }
  if (user && (meta.school !== dom || meta.school_role !== role)) {
    const updated = await admin.auth.admin.updateUserById(user.id, { app_metadata: { school: dom, school_role: role } })
    if (updated.error) {
      console.error('updateUserById', updated.error.code, updated.error.message)
      return json(500, { error: 'ログインの準備ができませんでした' })
    }
  }
  // 表示名（先生が一覧で見る）。はじめての人だけ、仮の名前を入れる（あとから本人が変える）
  if (user) {
    const profile = await admin.from('profiles').upsert(
      { user_id: user.id, display_name: defaultName, school: dom },
      { onConflict: 'user_id', ignoreDuplicates: true },
    )
    if (profile.error) console.error('profiles', profile.error.code, profile.error.message)
  }

  return json(200, {
    token_hash: link.data.properties.hashed_token,
    type: link.data.properties.verification_type ?? 'magiclink',
  })
})
