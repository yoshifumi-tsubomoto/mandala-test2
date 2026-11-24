import { describe, expect, it } from 'vitest'
import {
  applyCellRow,
  applyMandalaRow,
  applyUnitRow,
  setCellTextLocal,
  setCellVersion,
  toState,
  type CellRow,
  type MandalaRow,
  type UnitRow,
} from './cloudState'
import { getCell, getCenterText, getChildUnit, getRootUnit } from './mandala'

const M = 'mandala-1'
const mandalaRow: MandalaRow = {
  id: M,
  title: 'ダミーのテーマ',
  owner_id: 'user-a',
  group_id: null,
  next_unit_number: 3,
  created_at: '2026-11-02T00:00:00Z',
  updated_at: '2026-11-02T00:00:00Z',
}
const root: UnitRow = { id: 'u1', mandala_id: M, number: 1, parent_unit_id: null, parent_cell: null, depth: 1 }
const child: UnitRow = { id: 'u2', mandala_id: M, number: 2, parent_unit_id: 'u1', parent_cell: 1, depth: 2 }

function cells(unitId: string, texts: Record<number, string> = {}): CellRow[] {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((p) => ({
    unit_id: unitId,
    position: p,
    mandala_id: M,
    text: texts[p] ?? '',
    version: texts[p] ? 1 : 0,
  }))
}

describe('表の行から状態を作る', () => {
  it('ユニット・セル・題名がそろう', () => {
    const s = toState(mandalaRow, [root, child], [...cells('u1', { 1: 'ダミーA' }), ...cells('u2')])
    const r = getRootUnit(s)
    expect(r.id).toBe('u1')
    expect(getCenterText(s, r)).toBe('ダミーのテーマ')
    const c = getChildUnit(s, 'u1', 1)!
    expect(c.number).toBe(2)
    expect(getCenterText(s, c)).toBe('ダミーA')
    expect(Object.keys(s.cells)).toHaveLength(16)
  })

  it('おかしなセル番号の行は捨てる', () => {
    const bad: CellRow = { unit_id: 'u1', position: 9, mandala_id: M, text: 'x', version: 1 }
    const s = toState(mandalaRow, [root], [...cells('u1'), bad])
    expect(Object.keys(s.cells)).toHaveLength(8)
  })
})

describe('サーバーからの知らせを反映する', () => {
  const base = () => toState(mandalaRow, [root], cells('u1'))

  it('新しい版のセルは反映する', () => {
    const s = applyCellRow(base(), { unit_id: 'u1', position: 2, mandala_id: M, text: 'ダミーB', version: 1 })
    expect(getCell(s, 'u1', 2)!.text).toBe('ダミーB')
  })

  it('手元より古い版の知らせは無視する', () => {
    let s = applyCellRow(base(), { unit_id: 'u1', position: 2, mandala_id: M, text: 'ダミー新', version: 3 })
    s = applyCellRow(s, { unit_id: 'u1', position: 2, mandala_id: M, text: 'ダミー古', version: 2 })
    expect(getCell(s, 'u1', 2)!.text).toBe('ダミー新')
  })

  it('同じ内容の知らせでは、状態を作り直さない', () => {
    const s = applyCellRow(base(), { unit_id: 'u1', position: 2, mandala_id: M, text: 'ダミーB', version: 1 })
    const again = applyCellRow(s, { unit_id: 'u1', position: 2, mandala_id: M, text: 'ダミーB', version: 1 })
    expect(again).toBe(s)
  })

  it('新しいユニットを足す（すでにあれば何もしない）', () => {
    const s = applyUnitRow(base(), child)
    expect(s.units.u2.depth).toBe(2)
    expect(applyUnitRow(s, child)).toBe(s)
  })

  it('題名の変更を反映する（別のマンダラの知らせは無視する）', () => {
    const s = applyMandalaRow(base(), { ...mandalaRow, title: 'ダミーの新しいテーマ' })
    expect(s.mandala.title).toBe('ダミーの新しいテーマ')
    expect(applyMandalaRow(s, { ...mandalaRow, id: 'other', title: 'ちがう' })).toBe(s)
  })
})

describe('画面だけ先に書き換える', () => {
  it('文字だけ変えて、版の番号と子ユニットはそのまま', () => {
    const s0 = toState(mandalaRow, [root], cells('u1'))
    const s = setCellTextLocal(s0, 'u1', 3, 'ダミーC')
    expect(getCell(s, 'u1', 3)).toEqual({ unitId: 'u1', position: 3, text: 'ダミーC', version: 0 })
    expect(getChildUnit(s, 'u1', 3)).toBeUndefined()
  })

  it('保存のあと、返ってきた版の番号を記録する（小さい番号では戻さない）', () => {
    let s = toState(mandalaRow, [root], cells('u1'))
    s = setCellVersion(s, 'u1', 3, 2)
    expect(getCell(s, 'u1', 3)!.version).toBe(2)
    s = setCellVersion(s, 'u1', 3, 1)
    expect(getCell(s, 'u1', 3)!.version).toBe(2)
  })
})
