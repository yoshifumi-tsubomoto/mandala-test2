// Supabase との通信。
// 表を直接書き換えることはできない（RLS と権限で禁止している）。書き換えは必ず rpc で「係」の関数を呼ぶ。
// 関数の中身は supabase/migrations/001_init.sql を参照。

import type { RealtimeChannel, Session, SupabaseClient } from '@supabase/supabase-js'
import type { CellPosition } from './grid'
import { supabase } from './supabase'
import type { CellRow, MandalaRow, UnitRow } from './cloudState'
import { SCHOOL_LOGIN_URL } from './config'
import { SCHOOL_STATE_KEY, newSchoolState, schoolLoginUrl, teacherSchoolOf } from './schoolLogin'
import { mergeOthers, parseWhere, type PresenceInfo, type WhereInfo } from './presence'

export type Role = 'admin' | 'editor' | 'viewer'

export interface MandalaSummary {
  id: string
  title: string
  color?: string
  updatedAt: string
  role: Role
  isOwner: boolean
  /** 学校の生徒が作ったマンダラで、自分がその学校の先生のとき */
  fromStudent?: boolean
  /** 生徒のマンダラのとき、作った生徒の表示名 */
  ownerName?: string
}

/** 画面に出すための、わかりやすいエラー */
export class CloudError extends Error {
  /** 同時に書いて、ほかの人が先に書き換えていた */
  readonly conflict: boolean
  constructor(message: string, conflict = false) {
    super(message)
    this.conflict = conflict
  }
}

function client(): SupabaseClient {
  if (!supabase) throw new CloudError('接続先が設定されていません')
  return supabase
}

function toCloudError(error: { message?: string; code?: string } | null, fallback: string): CloudError {
  if (!error) return new CloudError(fallback)
  // ぶつかった：SQL 007 から PT409（HTTP 409）。それより前の 40001 も受け付ける
  if (error.code === 'PT409' || error.code === '40001') return new CloudError(error.message || 'ほかの人が先に書き換えました', true)
  if (error.code === '42501') return new CloudError(error.message || 'この操作をする権限がありません')
  return new CloudError(error.message ? `${fallback}（${error.message}）` : fallback)
}

// ---------------------------------------------------------------------
// ログイン
// ---------------------------------------------------------------------

export async function getSession(): Promise<Session | null> {
  const { data } = await client().auth.getSession()
  return data.session
}

export function onAuthChange(callback: (session: Session | null) => void): () => void {
  const { data } = client().auth.onAuthStateChange((_event, session) => callback(session))
  return () => data.subscription.unsubscribe()
}

/** Google でログインする。ログインのあと、いま開いているアドレスに戻ってくる */
export async function signInWithGoogle(): Promise<void> {
  const { error } = await client().auth.signInWithOAuth({
    provider: 'google',
    // 毎回アカウントを選ぶ画面を出す（同じ名前の個人と学校のアカウントを、まちがえて使わないように）
    options: { redirectTo: window.location.href, queryParams: { prompt: 'select_account' } },
  })
  if (error) throw toCloudError(error, 'ログインを始められませんでした')
}

/** 部屋の合言葉で入った生徒（匿名ログイン）かどうか */
export function isStudentSession(session: Session | null): boolean {
  return session?.user.is_anonymous === true
}

/**
 * 生徒が部屋の合言葉で入る。ログインしていなければ、匿名ログインで仮のアカウントを作ってから入る。
 * 入れたらマンダラの番号を返す
 */
export async function joinRoom(code: string, name: string): Promise<string> {
  const db = client()
  const { data: current } = await db.auth.getSession()
  if (!current.session) {
    const { error } = await db.auth.signInAnonymously({ options: { data: { full_name: name } } })
    if (error) {
      if (/anonymous/i.test(error.message ?? '') && /disabled/i.test(error.message ?? '')) {
        throw new CloudError('生徒の入り方が、まだ使えるようになっていません（先生へ：Supabase の匿名ログインをオンにしてください）')
      }
      if (error.status === 429) {
        throw new CloudError('いま入る人が多すぎます。少し待ってから、もう一度「入る」を押してください')
      }
      throw toCloudError(error, '部屋に入れませんでした')
    }
  }
  const { data, error } = await db.rpc('join_room', { p_code: code, p_name: name })
  if (error) {
    if (error.code === '54000' || error.code === '42501' || error.code === '22023') throw new CloudError(error.message)
    throw toCloudError(error, '部屋に入れませんでした')
  }
  if (!data) throw new CloudError('合言葉がちがいます。もう一度たしかめてください（部屋が閉じていることもあります）')
  return data as string
}

/** 学校のアカウントで入る：画面の番号を覚えて、学校の GAS「マンダラ通行証」へ移る */
export function startSchoolLogin(): void {
  const state = newSchoolState()
  sessionStorage.setItem(SCHOOL_STATE_KEY, state)
  window.location.href = schoolLoginUrl(SCHOOL_LOGIN_URL, `${window.location.origin}/`, state)
}

/** 同じ通行証で2回呼ばれても（画面の作り直しなど）、確かめるのは1回だけにする */
const schoolLogins = new Map<string, Promise<void>>()

/** 学校の GAS から戻ってきたとき：通行証を Supabase の係に確かめてもらい、ログインする */
export function finishSchoolLogin(ticket: string): Promise<void> {
  let p = schoolLogins.get(ticket)
  if (!p) {
    p = doFinishSchoolLogin(ticket)
    schoolLogins.set(ticket, p)
  }
  return p
}

async function doFinishSchoolLogin(ticket: string): Promise<void> {
  const state = sessionStorage.getItem(SCHOOL_STATE_KEY)
  sessionStorage.removeItem(SCHOOL_STATE_KEY)
  if (!state) throw new CloudError('この画面で始めたログインではありません。もう一度「学校のアカウントで入る」を押してください')
  const db = client()
  const { data, error } = await db.functions.invoke('school-login', { body: { ticket, state } })
  if (error) {
    let message = ''
    const ctx = (error as { context?: unknown }).context
    if (ctx instanceof Response) {
      try {
        message = ((await ctx.json()) as { error?: string }).error ?? ''
      } catch {
        message = ''
      }
    }
    throw new CloudError(message || '学校のアカウントで入れませんでした。少し待ってから、もう一度ためしてください')
  }
  const r = data as { token_hash?: string; type?: string }
  if (!r?.token_hash) throw new CloudError('学校のアカウントで入れませんでした')
  const verified = await db.auth.verifyOtp({ token_hash: r.token_hash, type: (r.type ?? 'magiclink') as 'magiclink' })
  if (verified.error) throw toCloudError(verified.error, '学校のアカウントで入れませんでした')
}

/** 自分の表示名を変える（学校の生徒が、出席番号やニックネームにする） */
export async function updateDisplayName(name: string): Promise<void> {
  const db = client()
  // 先生の一覧に出す表示名（SQL 009）
  const saved = await db.rpc('set_display_name', { p_name: name })
  if (saved.error) throw toCloudError(saved.error, '表示名を変えられませんでした')
  // 自分の画面（右上・入力中）に出す表示名
  const { error } = await db.auth.updateUser({ data: { full_name: name } })
  if (error) throw toCloudError(error, '表示名を変えられませんでした')
}

export async function signOut(): Promise<void> {
  await client().auth.signOut()
}

// ---------------------------------------------------------------------
// 読み込み
// ---------------------------------------------------------------------

/** 1回に読める行の数には上限があるので、分けて全部読む */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw toCloudError(error, '読み込めませんでした')
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
  }
}

/** 自分が見られるマンダラの一覧（新しく変わった順） */
export async function listMandalas(userId: string): Promise<MandalaSummary[]> {
  const db = client()
  const teacherSchool = teacherSchoolOf((await db.auth.getSession()).data.session)
  const mandalas = await fetchAll<
    Pick<MandalaRow, 'id' | 'title' | 'owner_id' | 'group_id' | 'updated_at' | 'color' | 'school'>
  >((from, to) =>
    db.from('mandalas').select('id, title, owner_id, group_id, updated_at, color, school')
      .order('updated_at', { ascending: false }).range(from, to),
  )
  const members = await fetchAll<{ mandala_id: string; role: Role }>((from, to) =>
    db.from('mandala_members').select('mandala_id, role').eq('user_id', userId).range(from, to),
  )
  const teacherGroups = await fetchAll<{ group_id: string }>((from, to) =>
    db.from('group_members').select('group_id').eq('user_id', userId).eq('role', 'teacher').range(from, to),
  )
  const roleOf = new Map(members.map((m) => [m.mandala_id, m.role]))
  const teaches = new Set(teacherGroups.map((g) => g.group_id))
  const isStudentMandala = (m: { owner_id: string; school?: string | null }) =>
    teacherSchool !== null && m.owner_id !== userId && !!m.school && m.school === teacherSchool

  // 先生のとき：生徒のマンダラを作った生徒の表示名（SQL 009 の profiles。その学校の先生だけが読める）
  const nameOf = new Map<string, string>()
  const studentOwners = [...new Set(mandalas.filter(isStudentMandala).map((m) => m.owner_id))]
  if (studentOwners.length > 0) {
    const profiles = await fetchAll<{ user_id: string; display_name: string }>((from, to) =>
      db.from('profiles').select('user_id, display_name').in('user_id', studentOwners).range(from, to),
    )
    for (const p of profiles) nameOf.set(p.user_id, p.display_name)
  }

  return mandalas.map((m) => {
    const isOwner = m.owner_id === userId
    const fromStudent = isStudentMandala(m)
    const role: Role =
      isOwner || fromStudent || (m.group_id !== null && teaches.has(m.group_id)) ? 'admin' : roleOf.get(m.id) ?? 'viewer'
    return {
      id: m.id, title: m.title, color: m.color, updatedAt: m.updated_at, role, isOwner,
      fromStudent, ownerName: fromStudent ? nameOf.get(m.owner_id) ?? '（名前なし）' : undefined,
    }
  })
}

export interface LoadedMandala {
  mandala: MandalaRow
  units: UnitRow[]
  cells: CellRow[]
}

/** マンダラ1枚を、ユニットとセルごと読み込む */
export async function loadMandala(mandalaId: string): Promise<LoadedMandala> {
  const db = client()
  const { data: mandala, error } = await db
    .from('mandalas')
    .select('id, title, owner_id, group_id, next_unit_number, created_at, updated_at, color, show_drafts, school')
    .eq('id', mandalaId)
    .maybeSingle<MandalaRow>()
  if (error) throw toCloudError(error, 'マンダラを読み込めませんでした')
  if (!mandala) throw new CloudError('マンダラが見つかりません（見る権限がないか、削除されています）')

  const units = await fetchAll<UnitRow>((from, to) =>
    db.from('units').select('id, mandala_id, number, parent_unit_id, parent_cell, depth, continues_unit_id, page')
      .eq('mandala_id', mandalaId).order('number').range(from, to),
  )
  const cells = await fetchAll<CellRow>((from, to) =>
    db.from('cells').select('unit_id, position, mandala_id, text, version')
      .eq('mandala_id', mandalaId).order('unit_id').order('position').range(from, to),
  )
  return { mandala, units, cells }
}

/** ユニット1つと、その8つのセルを読み込む（子ユニットができたとき、すぐ表示するため） */
export async function loadUnit(unitId: string): Promise<{ unit: UnitRow; cells: CellRow[] } | null> {
  const db = client()
  const { data: unit, error } = await db
    .from('units')
    .select('id, mandala_id, number, parent_unit_id, parent_cell, depth, continues_unit_id, page')
    .eq('id', unitId)
    .maybeSingle<UnitRow>()
  if (error || !unit) return null
  const { data: cells } = await db
    .from('cells')
    .select('unit_id, position, mandala_id, text, version')
    .eq('unit_id', unitId)
  return { unit, cells: (cells ?? []) as CellRow[] }
}

/** ある1枚目に続く枚（2枚目以降）のユニット */
export async function loadContinuations(baseUnitId: string): Promise<UnitRow[]> {
  const { data } = await client()
    .from('units')
    .select('id, mandala_id, number, parent_unit_id, parent_cell, depth, continues_unit_id, page')
    .eq('continues_unit_id', baseUnitId)
  return (data ?? []) as UnitRow[]
}

/** セル1つを読み直す（同時に書いてぶつかったとき、最新を表示するため） */
export async function loadCell(unitId: string, position: CellPosition): Promise<CellRow | null> {
  const { data } = await client()
    .from('cells')
    .select('unit_id, position, mandala_id, text, version')
    .eq('unit_id', unitId)
    .eq('position', position)
    .maybeSingle<CellRow>()
  return data ?? null
}

/** 自分のこのマンダラでの権限 */
export async function getMyRole(mandala: MandalaRow, userId: string): Promise<Role | null> {
  if (mandala.owner_id === userId) return 'admin'
  const db = client()
  // 学校の先生は、その学校の生徒が作ったマンダラの管理者（SQL 009）
  const teacherSchool = teacherSchoolOf((await db.auth.getSession()).data.session)
  if (teacherSchool && mandala.school === teacherSchool) return 'admin'
  if (mandala.group_id) {
    const { data } = await db
      .from('group_members')
      .select('role')
      .eq('group_id', mandala.group_id)
      .eq('user_id', userId)
      .maybeSingle<{ role: string }>()
    if (data?.role === 'teacher') return 'admin'
  }
  const { data } = await db
    .from('mandala_members')
    .select('role')
    .eq('mandala_id', mandala.id)
    .eq('user_id', userId)
    .maybeSingle<{ role: Role }>()
  return data?.role ?? null
}

// ---------------------------------------------------------------------
// 書き換え（rpc で「係」の関数を呼ぶ）
// ---------------------------------------------------------------------

export async function createMandala(title: string): Promise<string> {
  const { data, error } = await client().rpc('create_mandala', { p_title: title })
  if (error) throw toCloudError(error, 'マンダラを作れませんでした')
  return data as string
}

export interface SetCellResult {
  version: number
  changed: boolean
  childUnitId: string | null
  /** 実際に入れたユニットとマス（ぶつかって次の空いたマスへ移したときは、頼んだ場所とちがう） */
  unitId: string
  position: CellPosition
  /** ほかの人が先に書いていたので、次の空いたマスへ移した */
  moved: boolean
}

export async function setCellText(
  unitId: string,
  position: CellPosition,
  text: string,
  expectedVersion: number,
): Promise<SetCellResult> {
  const { data, error } = await client().rpc('set_cell_text', {
    p_unit_id: unitId,
    p_position: position,
    p_text: text,
    p_expected_version: expectedVersion,
  })
  if (error) throw toCloudError(error, '保存できませんでした')
  const r = data as {
    version: number
    changed: boolean
    child_unit_id?: string | null
    unit_id?: string
    position?: number
    moved?: boolean
  }
  return {
    version: r.version,
    changed: r.changed,
    childUnitId: r.child_unit_id ?? null,
    unitId: r.unit_id ?? unitId,
    position: (r.position ?? position) as CellPosition,
    moved: r.moved ?? false,
  }
}

/**
 * 取り消し・やり直し用の書き込み。expectedVersion のあとにほかの人が書き換えていたら、
 * 次の空いたマスへは移さずに、ぶつかったエラー（conflict）で止まる（SQL 004）
 */
export async function undoCellText(
  unitId: string,
  position: CellPosition,
  text: string,
  expectedVersion: number,
): Promise<number> {
  const { data, error } = await client().rpc('undo_cell_text', {
    p_unit_id: unitId,
    p_position: position,
    p_text: text,
    p_expected_version: expectedVersion,
  })
  if (error) throw toCloudError(error, '取り消せませんでした')
  return (data as { version: number }).version
}

export async function setTitle(mandalaId: string, title: string): Promise<void> {
  const { error } = await client().rpc('set_title', { p_mandala_id: mandalaId, p_title: title })
  if (error) throw toCloudError(error, '題名を保存できませんでした')
}

export async function setColor(mandalaId: string, color: string): Promise<void> {
  const { error } = await client().rpc('set_color', { p_mandala_id: mandalaId, p_color: color })
  if (error) throw toCloudError(error, '色を変えられませんでした')
}

export async function setShowDrafts(mandalaId: string, value: boolean): Promise<void> {
  const { error } = await client().rpc('set_show_drafts', { p_mandala_id: mandalaId, p_value: value })
  if (error) throw toCloudError(error, '設定を変えられませんでした')
}

export async function createShareLink(mandalaId: string, role: 'editor' | 'viewer'): Promise<string> {
  const { data, error } = await client().rpc('create_share_link', { p_mandala_id: mandalaId, p_role: role })
  if (error) throw toCloudError(error, '招待リンクを作れませんでした')
  return data as string
}

export async function joinByLink(token: string): Promise<string> {
  const { data, error } = await client().rpc('join_by_link', { p_token: token })
  if (error) throw toCloudError(error, 'このリンクでは参加できませんでした')
  return data as string
}

// ---------------------------------------------------------------------
// 生徒の部屋（SQL 008）
// ---------------------------------------------------------------------

export interface OpenRoom {
  code: string
  role: 'editor' | 'viewer'
  expiresAt: string
}

export interface RoomMember {
  userId: string
  name: string
  role: Role
  joinedAt: string
}

/** 開いている部屋（なければ null）。管理者だけが見られる */
export async function getOpenRoom(mandalaId: string): Promise<OpenRoom | null> {
  const { data, error } = await client()
    .from('rooms').select('code, role, expires_at')
    .eq('mandala_id', mandalaId).eq('closed', false).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1)
  if (error) throw toCloudError(error, '部屋を読み込めませんでした')
  const r = (data ?? [])[0] as { code: string; role: 'editor' | 'viewer'; expires_at: string } | undefined
  return r ? { code: r.code, role: r.role, expiresAt: r.expires_at } : null
}

export async function openRoom(mandalaId: string, role: 'editor' | 'viewer'): Promise<OpenRoom> {
  const { data, error } = await client().rpc('open_room', { p_mandala_id: mandalaId, p_role: role })
  if (error) throw toCloudError(error, '部屋を開けませんでした')
  const r = data as { code: string; role: 'editor' | 'viewer'; expires_at: string }
  return { code: r.code, role: r.role, expiresAt: r.expires_at }
}

export async function closeRoom(mandalaId: string): Promise<void> {
  const { error } = await client().rpc('close_room', { p_mandala_id: mandalaId })
  if (error) throw toCloudError(error, '部屋を閉じられませんでした')
}

/** 部屋から入った人の一覧（入った順） */
export async function listRoomMembers(mandalaId: string): Promise<RoomMember[]> {
  const { data, error } = await client()
    .from('mandala_members').select('user_id, display_name, role, joined_at')
    .eq('mandala_id', mandalaId).not('display_name', 'is', null)
    .order('joined_at', { ascending: true })
  if (error) throw toCloudError(error, '入った人の一覧を読み込めませんでした')
  return ((data ?? []) as { user_id: string; display_name: string; role: Role; joined_at: string }[]).map((r) => ({
    userId: r.user_id,
    name: r.display_name,
    role: r.role,
    joinedAt: r.joined_at,
  }))
}

export async function removeRoomMember(mandalaId: string, userId: string): Promise<void> {
  const { error } = await client().rpc('remove_room_member', { p_mandala_id: mandalaId, p_user_id: userId })
  if (error) throw toCloudError(error, '外せませんでした')
}

export async function deleteMandala(mandalaId: string): Promise<void> {
  const { error } = await client().from('mandalas').delete().eq('id', mandalaId)
  if (error) throw toCloudError(error, '削除できませんでした')
}

// ---------------------------------------------------------------------
// リアルタイム（ほかの人の変更をすぐ受け取る）
// ---------------------------------------------------------------------

export interface MandalaListeners {
  onCell: (row: CellRow) => void
  onUnit: (row: UnitRow) => void
  onMandala: (row: MandalaRow) => void
}

export function subscribeMandala(mandalaId: string, listeners: MandalaListeners): () => void {
  const db = client()
  const channel: RealtimeChannel = db
    .channel(`mandala:${mandalaId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'cells', filter: `mandala_id=eq.${mandalaId}` },
      (payload) => {
        if (payload.new && 'unit_id' in payload.new) listeners.onCell(payload.new as CellRow)
      })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'units', filter: `mandala_id=eq.${mandalaId}` },
      (payload) => listeners.onUnit(payload.new as UnitRow))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mandalas', filter: `id=eq.${mandalaId}` },
      (payload) => listeners.onMandala(payload.new as MandalaRow))
    .subscribe()
  return () => {
    void db.removeChannel(channel)
  }
}

// ---------------------------------------------------------------------
// 誰がどこを触っているか（Presence ＋ Broadcast）
// 通信路の名前は 'presence-mandala:<マンダラの番号>'。非公開の通信路にして、
// SQL 005・006 の許可で、そのマンダラのメンバーだけが入れる。
// Presence は1人あたり30秒に5回までなので、入るときに名前を1回知らせるだけにする。
// どこを触っているかは Broadcast の 'where' で送る（0.4秒に1回まで）
// ---------------------------------------------------------------------

export interface PresenceHandle {
  /** 自分の様子を知らせ直す（変わったところだけ渡せばよい） */
  update: (patch: Partial<Pick<PresenceInfo, 'unitId' | 'position' | 'draft'>>) => void
  leave: () => void
}

/** 'where' を送る間隔の下限（ミリ秒） */
const WHERE_INTERVAL_MS = 400

export function joinPresence(
  mandalaId: string,
  me: { tabId: string; userId: string; name: string },
  onChange: (others: PresenceInfo[]) => void,
): PresenceHandle {
  const db = client()
  let where: WhereInfo = { tabId: me.tabId, unitId: null, position: null, at: Date.now() }
  const whereByTab = new Map<string, WhereInfo>()
  let channel: RealtimeChannel | null = null
  let joined = false
  let left = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryDelay = 5000
  let lastSent = 0

  const refresh = () => {
    if (channel) onChange(mergeOthers(channel.presenceState(), whereByTab, me.tabId))
  }

  const sendWhere = () => {
    timer = null
    if (!joined || !channel) return
    lastSent = Date.now()
    where = { ...where, at: lastSent }
    void channel.send({ type: 'broadcast', event: 'where', payload: where })
  }

  // 知らせすぎないように、0.4秒に1回まで（途中の文字を打つたびに送らない）
  const scheduleWhere = () => {
    if (timer) return
    timer = setTimeout(sendWhere, Math.max(0, WHERE_INTERVAL_MS - (Date.now() - lastSent)))
  }

  const connect = () => {
    const ch = db.channel(`presence-mandala:${mandalaId}`, {
      config: { private: true, presence: { key: me.userId }, broadcast: { self: false } },
    })
    channel = ch
    ch.on('presence', { event: 'sync' }, () => {
      // いなくなった画面の 'where' を捨てる
      const present = new Set(
        Object.values(ch.presenceState()).flatMap((list) =>
          (list as { tabId?: unknown }[]).map((p) => p.tabId).filter((t): t is string => typeof t === 'string'),
        ),
      )
      for (const tab of whereByTab.keys()) if (!present.has(tab)) whereByTab.delete(tab)
      refresh()
    })
      // あとから来た人にも、自分がどこにいるかが分かるよう、知らせ直す
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        if (newPresences.some((p) => (p as { tabId?: unknown }).tabId !== me.tabId)) scheduleWhere()
      })
      .on('broadcast', { event: 'where' }, ({ payload }) => {
        const w = parseWhere(payload)
        if (!w || w.tabId === me.tabId) return
        const prev = whereByTab.get(w.tabId)
        if (prev && prev.at > w.at) return
        whereByTab.set(w.tabId, w)
        refresh()
      })
      .subscribe((status) => {
        if (channel !== ch || left) return
        if (status === 'SUBSCRIBED') {
          joined = true
          retryDelay = 5000
          // 在席（名前）は入るときに1回だけ知らせる
          void ch.track({ tabId: me.tabId, userId: me.userId, name: me.name, at: Date.now() })
          scheduleWhere()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          // 通信が切れた・閉じられたときは、少し待ってから入り直す（待ち時間は少しずつ長く）
          joined = false
          channel = null
          whereByTab.clear()
          onChange([])
          void db.removeChannel(ch)
          if (!retryTimer) {
            retryTimer = setTimeout(() => {
              retryTimer = null
              if (!left) connect()
            }, retryDelay)
            retryDelay = Math.min(retryDelay * 2, 60000)
          }
        }
      })
  }

  connect()
  void db.realtime.setAuth()

  return {
    update(patch) {
      where = { ...where, ...patch }
      scheduleWhere()
    },
    leave() {
      left = true
      if (timer) clearTimeout(timer)
      if (retryTimer) clearTimeout(retryTimer)
      if (channel) {
        void channel.untrack()
        void db.removeChannel(channel)
      }
      channel = null
    },
  }
}
