// Supabase の表の行（スネークケース）と、画面で使う MandalaState のあいだの変換。
// 通信はしない（テストできるように、ここは計算だけ）。

import { POSITIONS, type CellPosition } from './grid'
import { cellKey, type Cell, type MandalaState, type Unit } from './mandala'

export interface MandalaRow {
  id: string
  title: string
  owner_id: string
  group_id: string | null
  next_unit_number: number
  created_at: string
  updated_at: string
  color?: string
  show_drafts?: boolean
  /** 学校の生徒が作ったマンダラの学校（その学校の先生が見られる。SQL 009） */
  school?: string | null
}

export interface UnitRow {
  id: string
  mandala_id: string
  number: number
  parent_unit_id: string | null
  parent_cell: number | null
  depth: number
  continues_unit_id?: string | null
  page?: number
}

export interface CellRow {
  unit_id: string
  position: number
  mandala_id: string
  text: string
  version: number
}

function isPosition(n: number | null): n is CellPosition {
  return n !== null && POSITIONS.includes(n as CellPosition)
}

export function rowToUnit(row: UnitRow): Unit {
  return {
    id: row.id,
    number: row.number,
    parentUnitId: row.parent_unit_id,
    parentCell: isPosition(row.parent_cell) ? row.parent_cell : null,
    depth: row.depth,
    continuesUnitId: row.continues_unit_id ?? null,
    page: row.page ?? 1,
  }
}

export function rowToCell(row: CellRow): Cell | null {
  if (!isPosition(row.position)) return null
  return { unitId: row.unit_id, position: row.position, text: row.text, version: row.version }
}

/** 読み込んだ行から、画面で使う状態を作る（操作ログはここでは読まない） */
export function toState(mandala: MandalaRow, units: UnitRow[], cells: CellRow[]): MandalaState {
  const state: MandalaState = {
    mandala: {
      id: mandala.id,
      title: mandala.title,
      color: mandala.color,
      showDrafts: mandala.show_drafts ?? false,
      nextUnitNumber: mandala.next_unit_number,
      createdAt: mandala.created_at,
      updatedAt: mandala.updated_at,
    },
    units: {},
    cells: {},
    operations: [],
  }
  for (const u of units) state.units[u.id] = rowToUnit(u)
  for (const c of cells) {
    const cell = rowToCell(c)
    if (cell) state.cells[cellKey(cell.unitId, cell.position)] = cell
  }
  return state
}

/**
 * サーバーから届いたセルを反映する。
 * 手元のほうが新しい版（version が大きい）なら、古い知らせなので無視する。
 */
export function applyCellRow(state: MandalaState, row: CellRow): MandalaState {
  const cell = rowToCell(row)
  if (!cell) return state
  const key = cellKey(cell.unitId, cell.position)
  const current = state.cells[key]
  if (current && current.version > cell.version) return state
  if (current && current.version === cell.version && current.text === cell.text) return state
  return { ...state, cells: { ...state.cells, [key]: cell } }
}

/** サーバーから届いたユニットを反映する */
export function applyUnitRow(state: MandalaState, row: UnitRow): MandalaState {
  if (state.units[row.id]) return state
  return { ...state, units: { ...state.units, [row.id]: rowToUnit(row) } }
}

/** サーバーから届いたマンダラ（題名など）を反映する */
export function applyMandalaRow(state: MandalaState, row: MandalaRow): MandalaState {
  if (row.id !== state.mandala.id) return state
  return {
    ...state,
    mandala: {
      ...state.mandala,
      title: row.title,
      color: row.color ?? state.mandala.color,
      showDrafts: row.show_drafts ?? state.mandala.showDrafts,
      nextUnitNumber: row.next_unit_number,
      updatedAt: row.updated_at,
    },
  }
}

/**
 * 保存が終わる前に、画面だけ先に書き換える（すぐ反映されたように見せる）。
 * 子ユニットはサーバーが作るので、ここでは作らない。版の番号も変えない。
 */
export function setCellTextLocal(
  state: MandalaState,
  unitId: string,
  position: CellPosition,
  text: string,
): MandalaState {
  const key = cellKey(unitId, position)
  const current = state.cells[key]
  if (!current || current.text === text) return state
  return { ...state, cells: { ...state.cells, [key]: { ...current, text } } }
}

/** 保存が終わったあと、サーバーが返した版の番号を記録する */
export function setCellVersion(
  state: MandalaState,
  unitId: string,
  position: CellPosition,
  version: number,
): MandalaState {
  const key = cellKey(unitId, position)
  const current = state.cells[key]
  if (!current || current.version >= version) return state
  return { ...state, cells: { ...state.cells, [key]: { ...current, version } } }
}
