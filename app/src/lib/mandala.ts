// マンダラのデータと、書き換えのきまり
//
// Supabase の表（supabase/migrations/001_init.sql）と同じ形にしてある。
//   mandalas → Mandala / units → Unit / cells → Cell / operations → Operation
// 書き換えは必ずこのファイルの関数を通す。関数は「新しい状態」を返し、元の状態は変えない。
// SQL の関数（create_mandala・set_cell_text・set_title）と同じ動きをする。

import { POSITIONS, type CellPosition } from './grid'

/** 続きの枚を何枚目まで作るか（SQL と同じ） */
export const MAX_PAGES = 99

/** 何段まで子ユニットを作るか（SQL と同じ） */
export const MAX_DEPTH = 256
/** セル1つに書ける文字数（SQL と同じ） */
export const MAX_TEXT_LENGTH = 500
/** 題名に書ける文字数（SQL と同じ） */
export const MAX_TITLE_LENGTH = 200

export interface Mandala {
  id: string
  title: string
  /** 基本色（lib/colors.ts の8色。古い保存データにはないことがある） */
  color?: string
  /** 打っている途中の文字を見せ合うか（Supabase のときだけ使う。管理者が決める） */
  showDrafts?: boolean
  nextUnitNumber: number
  createdAt: string
  updatedAt: string
}

export interface Unit {
  id: string
  number: number
  parentUnitId: string | null
  parentCell: CellPosition | null
  depth: number
  /** 2枚目以降のとき、1枚目のユニット（1枚目は null。古い保存データにはないことがある） */
  continuesUnitId?: string | null
  /** 何枚目か（1枚目は 1。古い保存データにはないことがある） */
  page?: number
}

export interface Cell {
  unitId: string
  position: CellPosition
  text: string
  version: number
}

export type OperationKind = 'set_text' | 'set_title'

export interface Operation {
  seq: number
  kind: OperationKind
  unitId: string | null
  position: CellPosition | null
  before: string
  after: string
  createdAt: string
}

export interface MandalaState {
  mandala: Mandala
  units: Record<string, Unit>
  cells: Record<string, Cell>
  operations: Operation[]
}

/** 新しい id を作る関数（テストでは決まった値を返すものに差し替える） */
export type IdFactory = () => string

const defaultId: IdFactory = () => crypto.randomUUID()
const now = () => new Date().toISOString()

/** cells の中で、1つのセルを探すための名前 */
export function cellKey(unitId: string, position: CellPosition): string {
  return `${unitId}:${position}`
}

function addUnit(
  state: MandalaState,
  unit: Unit,
): MandalaState {
  const cells = { ...state.cells }
  for (const position of POSITIONS) {
    cells[cellKey(unit.id, position)] = { unitId: unit.id, position, text: '', version: 0 }
  }
  return { ...state, units: { ...state.units, [unit.id]: unit }, cells }
}

/** 新しいマンダラを作る。最初のユニット（1番）と空の8セルもできる */
export function createMandala(title: string, newId: IdFactory = defaultId): MandalaState {
  const t = now()
  const empty: MandalaState = {
    mandala: { id: newId(), title: clampTitle(title), nextUnitNumber: 2, createdAt: t, updatedAt: t },
    units: {},
    cells: {},
    operations: [],
  }
  return addUnit(empty, { id: newId(), number: 1, parentUnitId: null, parentCell: null, depth: 1 })
}

function clampTitle(title: string): string {
  return title.slice(0, MAX_TITLE_LENGTH)
}

function nextSeq(state: MandalaState): number {
  const last = state.operations[state.operations.length - 1]
  return last ? last.seq + 1 : 1
}

/** 何枚目か（1枚目は 1） */
export function pageOf(unit: Unit): number {
  return unit.page ?? 1
}

/** 続きの枚（2枚目以降）なら、その1枚目。1枚目ならそのまま */
export function baseUnit(state: MandalaState, unit: Unit): Unit {
  return (unit.continuesUnitId && state.units[unit.continuesUnitId]) || unit
}

/** 同じテーマの枚を、1枚目から順に並べる */
export function getPages(state: MandalaState, unit: Unit): Unit[] {
  const base = baseUnit(state, unit)
  const rest = Object.values(state.units)
    .filter((u) => u.continuesUnitId === base.id)
    .sort((a, b) => pageOf(a) - pageOf(b))
  return [base, ...rest]
}

/**
 * 画面に出す枚。データは消さずに、次のときだけ隠す：
 * 空の枚で、前の枚が8マス埋まっていない（取り消しなどで空きができた）とき。
 * 何か書いてある枚は、前の枚に空きができても出す（書いた内容が見えなくならないように）
 */
export function getVisiblePages(state: MandalaState, unit: Unit): Unit[] {
  const pages = getPages(state, unit)
  const visible: Unit[] = [pages[0]]
  for (let i = 1; i < pages.length; i++) {
    const prev = pages[i - 1]
    const prevShown = visible.includes(prev)
    if (countFilledCells(state, pages[i].id) > 0 || (prevShown && countFilledCells(state, prev.id) === 8)) {
      visible.push(pages[i])
    }
  }
  return visible
}

/** 最初のユニット（1番）か。2枚目以降の枚も親がないが、最初のユニットではない */
export function isRootUnit(unit: Unit): boolean {
  return unit.parentUnitId === null && !unit.continuesUnitId
}

/** 最初のユニット（1番） */
export function getRootUnit(state: MandalaState): Unit {
  const root = Object.values(state.units).find(isRootUnit)
  if (!root) throw new Error('最初のユニットが見つかりません')
  return root
}

export function getCell(state: MandalaState, unitId: string, position: CellPosition): Cell | undefined {
  return state.cells[cellKey(unitId, position)]
}

/** そのセルを中央にした子ユニット（まだなければ undefined） */
export function getChildUnit(state: MandalaState, unitId: string, position: CellPosition): Unit | undefined {
  return Object.values(state.units).find(
    (u) => u.parentUnitId === unitId && u.parentCell === position,
  )
}

/** ユニットの中央に表示する文字。最初のユニットは題名、それ以外は親のセルの文字（2枚目以降は1枚目と同じ） */
export function getCenterText(state: MandalaState, unit: Unit): string {
  const b = baseUnit(state, unit)
  if (b.parentUnitId === null || b.parentCell === null) return state.mandala.title
  return getCell(state, b.parentUnitId, b.parentCell)?.text ?? ''
}

/**
 * 最初のユニットから、そのユニットまでの道順（最初のユニットが先頭）。
 * 2枚目以降の枚は、1枚目と同じ親につながる
 */
export function getPath(state: MandalaState, unit: Unit): Unit[] {
  const path: Unit[] = []
  let current: Unit | undefined = unit
  while (current && !path.includes(current)) {
    path.unshift(current)
    const parentId: string | null = baseUnit(state, current).parentUnitId
    current = parentId ? state.units[parentId] : undefined
  }
  return path
}

/**
 * そのユニットが隠れているか。
 * 上の段のどこかで、もとのセルの文字が消されていたら隠れている（データは消さずに残す）
 */
export function isUnitHidden(state: MandalaState, unit: Unit): boolean {
  return getPath(state, unit).some((u) => {
    const b = baseUnit(state, u)
    return b.parentUnitId !== null && b.parentCell !== null &&
      (getCell(state, b.parentUnitId, b.parentCell)?.text ?? '').trim() === ''
  })
}

/** ユニットの中で、文字が入っている周りのセルの数 */
export function countFilledCells(state: MandalaState, unitId: string): number {
  return POSITIONS.filter((p) => (getCell(state, unitId, p)?.text ?? '').trim() !== '').length
}

/** 題名（最初のユニットの中央）を書き換える */
export function setTitle(state: MandalaState, title: string): MandalaState {
  const next = clampTitle(title)
  const before = state.mandala.title
  if (before === next) return state
  const t = now()
  return {
    ...state,
    mandala: { ...state.mandala, title: next, updatedAt: t },
    operations: [
      ...state.operations,
      { seq: nextSeq(state), kind: 'set_title', unitId: null, position: null, before, after: next, createdAt: t },
    ],
  }
}

/**
 * セルの文字を書き換える。
 * 文字が入ったら、そのセルを中央にした子ユニットを用意する（256段まで）。
 * 文字を消しても、子ユニットは消さない。
 */
export function setCellText(
  state: MandalaState,
  unitId: string,
  position: CellPosition,
  text: string,
  newId: IdFactory = defaultId,
): MandalaState {
  const unit = state.units[unitId]
  const cell = getCell(state, unitId, position)
  if (!unit || !cell) throw new Error('ユニットが見つかりません')

  const next = text.slice(0, MAX_TEXT_LENGTH)
  if (cell.text === next) return state

  const t = now()
  let result: MandalaState = {
    ...state,
    mandala: { ...state.mandala, updatedAt: t },
    cells: {
      ...state.cells,
      [cellKey(unitId, position)]: { ...cell, text: next, version: cell.version + 1 },
    },
    operations: [
      ...state.operations,
      { seq: nextSeq(state), kind: 'set_text', unitId, position, before: cell.text, after: next, createdAt: t },
    ],
  }

  if (next.trim() !== '' && unit.depth < MAX_DEPTH && !getChildUnit(result, unitId, position)) {
    const number = result.mandala.nextUnitNumber
    result = {
      ...result,
      mandala: { ...result.mandala, nextUnitNumber: number + 1 },
    }
    result = addUnit(result, {
      id: newId(),
      number,
      parentUnitId: unitId,
      parentCell: position,
      depth: unit.depth + 1,
    })
  }
  if (next.trim() !== '') result = ensureNextPage(result, unitId, newId)
  return result
}

/**
 * ユニットを通し番号の順に並べる（一覧ビュー用）。
 * includeEmpty が false のときは、周りに何も書いていないユニットを省く（最初のユニットは必ず入れる）。
 * 隠れているユニットも入れる（画面で薄く表示する）。
 */
export function listUnits(state: MandalaState, includeEmpty: boolean): Unit[] {
  return Object.values(state.units)
    .filter((u) => includeEmpty || isRootUnit(u) || countFilledCells(state, u.id) > 0)
    .sort((a, b) => a.number - b.number)
}

/**
 * 曼荼羅ビューで選べる段の数。
 * 何か書いてあるユニットのうち、いちばん深いものまで（最初のユニットに書いてあれば、少なくとも2段）。
 * 隠れているユニットは数えない。
 */
export function contentLevelsBelow(state: MandalaState, unit: Unit): number {
  let deepest = 1
  const walk = (u: Unit, level: number) => {
    if (countFilledCells(state, u.id) > 0) deepest = Math.max(deepest, level === 1 ? 2 : level)
    for (const child of Object.values(state.units)) {
      if (child.parentUnitId === u.id && !isUnitHidden(state, child)) walk(child, level + 1)
    }
  }
  walk(unit, 1)
  return deepest
}

/** 何も書いていないセルのうち、いちばん若い番号（全部書いてあれば null） */
export function firstEmptyPosition(state: MandalaState, unitId: string): CellPosition | null {
  return POSITIONS.find((p) => (getCell(state, unitId, p)?.text ?? '').trim() === '') ?? null
}

/** 8マスがすべて埋まっていて、次の枚がまだなければ作る（SQL の ensure_next_page と同じ） */
function ensureNextPage(state: MandalaState, unitId: string, newId: IdFactory): MandalaState {
  const unit = state.units[unitId]
  if (!unit || pageOf(unit) >= MAX_PAGES || countFilledCells(state, unitId) < 8) return state
  const base = baseUnit(state, unit)
  const nextPage = pageOf(unit) + 1
  if (Object.values(state.units).some((u) => u.continuesUnitId === base.id && pageOf(u) === nextPage)) {
    return state
  }
  const number = state.mandala.nextUnitNumber
  const withNumber = { ...state, mandala: { ...state.mandala, nextUnitNumber: number + 1 } }
  return addUnit(withNumber, {
    id: newId(),
    number,
    parentUnitId: null,
    parentCell: null,
    depth: base.depth,
    continuesUnitId: base.id,
    page: nextPage,
  })
}

/** 同じテーマの次の枚（なければ undefined） */
export function getNextPage(state: MandalaState, unit: Unit): Unit | undefined {
  const pages = getPages(state, unit)
  return pages[pages.indexOf(pages.find((u) => u.id === unit.id) ?? unit) + 1]
}

/** 画面に出すユニットの名前。2枚目以降は「（2枚目）」をつける */
export function unitLabel(state: MandalaState, unit: Unit): string {
  const center = getCenterText(state, unit).trim() || '（テーマ未入力）'
  return pageOf(unit) > 1 ? `${center}（${pageOf(unit)}枚目）` : center
}

/** 基本色を変える */
export function setMandalaColor(state: MandalaState, color: string): MandalaState {
  if (state.mandala.color === color) return state
  return { ...state, mandala: { ...state.mandala, color, updatedAt: now() } }
}
