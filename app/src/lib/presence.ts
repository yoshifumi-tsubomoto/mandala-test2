// 「誰がどこを触っているか」の、通信しない部分。
// 通信は lib/cloud.ts の joinPresence。中身はデータベースに保存されない。
//
// Supabase の Presence（在席）は、1人あたり30秒に5回までしか知らせ直せない。
// そのため、Presence では「誰がこのマンダラを開いているか」（名前）だけを入るときに1回知らせ、
// 「どのユニット・どのマスか・途中の文字」は Broadcast（放送）の 'where' で送る。
// 2つを、画面ごとの番号（tabId）で突き合わせる。

import { POSITIONS, nextPosition, type CellPosition } from './grid'

/** 1人（1つの画面）が知らせる内容 */
export interface PresenceInfo {
  /** 画面ごとの番号（同じ人が2つの画面で開いていても見分ける） */
  tabId: string
  userId: string
  name: string
  /** いま開いているユニット */
  unitId: string | null
  /** いま書いているマス（書いていなければ null） */
  position: CellPosition | 'center' | null
  /** 打っている途中の文字（「途中の文字を見せ合う」がオンのときだけ） */
  draft?: string
  /** 最後に知らせた時刻（ミリ秒） */
  at: number
}

/** Presence の中身（key ごとに配列）を、自分の画面以外の一覧にする */
export function othersFrom(state: Record<string, unknown[]>, selfTabId: string): PresenceInfo[] {
  const list: PresenceInfo[] = []
  for (const entries of Object.values(state)) {
    for (const raw of entries) {
      const p = raw as Partial<PresenceInfo>
      if (!p || typeof p.tabId !== 'string' || p.tabId === selfTabId) continue
      if (typeof p.userId !== 'string' || typeof p.name !== 'string') continue
      list.push({
        tabId: p.tabId,
        userId: p.userId,
        name: p.name,
        unitId: typeof p.unitId === 'string' ? p.unitId : null,
        position: isPresencePosition(p.position) ? p.position : null,
        draft: typeof p.draft === 'string' ? p.draft.slice(0, 500) : undefined,
        at: typeof p.at === 'number' ? p.at : 0,
      })
    }
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, 'ja') || a.tabId.localeCompare(b.tabId))
}

/** Broadcast の 'where' で送る中身（どこを触っているか） */
export type WhereInfo = Pick<PresenceInfo, 'tabId' | 'unitId' | 'position' | 'draft' | 'at'>

/** 受け取った 'where' の中身を確かめる（形がおかしければ null） */
export function parseWhere(raw: unknown): WhereInfo | null {
  const w = raw as Partial<WhereInfo> | null
  if (!w || typeof w !== 'object' || typeof w.tabId !== 'string') return null
  return {
    tabId: w.tabId,
    unitId: typeof w.unitId === 'string' ? w.unitId : null,
    position: isPresencePosition(w.position) ? w.position : null,
    draft: typeof w.draft === 'string' && w.draft !== '' ? w.draft.slice(0, 500) : undefined,
    at: typeof w.at === 'number' ? w.at : 0,
  }
}

/**
 * Presence の一覧（いる人）に、'where'（どこを触っているか）を重ねる。
 * Presence にいない画面の 'where' は使わない（閉じた画面の枠が残らない）
 */
export function mergeOthers(
  state: Record<string, unknown[]>,
  whereByTab: ReadonlyMap<string, WhereInfo>,
  selfTabId: string,
): PresenceInfo[] {
  return othersFrom(state, selfTabId).map((o) => {
    const w = whereByTab.get(o.tabId)
    return w ? { ...o, unitId: w.unitId, position: w.position, draft: w.draft, at: Math.max(o.at, w.at) } : o
  })
}

function isPresencePosition(v: unknown): v is CellPosition | 'center' {
  return v === 'center' || POSITIONS.includes(v as CellPosition)
}

/** 人ごとの色。はっきり見分けられる10色（白い文字が読める濃さ） */
export const PERSON_COLORS = [
  '#c0392b', // 赤
  '#1565c0', // 青
  '#2e7d32', // 緑
  '#6a1b9a', // 紫
  '#b34000', // オレンジ
  '#00838f', // 青緑
  '#ad1457', // ピンク
  '#4e342e', // 茶
  '#283593', // 藍
  '#5d6d00', // 黄緑
] as const

/** 人ごとの色（userId から決める。同じ人はいつも同じ色）。枠と名前の札に使う */
export function colorForUser(userId: string): string {
  // FNV-1a（文字列から数を作るよく知られた方法）。似た名前でもばらばらの数になる
  let h = 0x811c9dc5
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return PERSON_COLORS[h % PERSON_COLORS.length]
}

/** 表示名の頭文字（1文字） */
export function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? '?'
}

/** そのユニットで、ほかの人が書いているマス → その人たち */
export function editorsByPosition(
  others: PresenceInfo[],
  unitId: string,
): Map<CellPosition | 'center', PresenceInfo[]> {
  const map = new Map<CellPosition | 'center', PresenceInfo[]>()
  for (const o of others) {
    if (o.unitId !== unitId || o.position === null) continue
    map.set(o.position, [...(map.get(o.position) ?? []), o])
  }
  return map
}

/**
 * 時計回りで次のマス。ほかの人が書いているマスは飛ばす（全部ふさがっていれば null）。
 * from の次から探す
 */
export function nextFreeAfter(from: CellPosition, busy: Set<CellPosition | 'center'>): CellPosition | null {
  let p = from
  for (let i = 0; i < 7; i++) {
    p = nextPosition(p)
    if (!busy.has(p)) return p
  }
  return null
}
