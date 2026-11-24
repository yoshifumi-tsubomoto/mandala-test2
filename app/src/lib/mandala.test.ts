import { describe, expect, it } from 'vitest'
import {
  MAX_DEPTH,
  MAX_TEXT_LENGTH,
  countFilledCells,
  createMandala,
  getCell,
  getCenterText,
  getChildUnit,
  getPath,
  getRootUnit,
  isUnitHidden,
  listUnits,
  contentLevelsBelow,
  firstEmptyPosition,
  getNextPage,
  getPages,
  getVisiblePages,
  pageOf,
  unitLabel,
  setCellText,
  setTitle,
  type IdFactory,
  type MandalaState,
} from './mandala'

// 決まった順に id を返す（テストの結果を毎回同じにするため）
function counterIds(): IdFactory {
  let n = 0
  return () => `id-${++n}`
}

describe('マンダラを作る', () => {
  it('最初のユニット（1番）と空の8セルができる', () => {
    const s = createMandala('ダミーのテーマ', counterIds())
    const root = getRootUnit(s)
    expect(root.number).toBe(1)
    expect(root.depth).toBe(1)
    expect(Object.keys(s.cells)).toHaveLength(8)
    expect(getCenterText(s, root)).toBe('ダミーのテーマ')
    expect(s.operations).toHaveLength(0)
  })
})

describe('セルに書く', () => {
  it('文字を入れると、そのセルを中央にした子ユニットができる', () => {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    s = setCellText(s, root.id, 1, 'ダミーA', ids)

    const child = getChildUnit(s, root.id, 1)
    expect(child).toBeDefined()
    expect(child!.number).toBe(2)
    expect(child!.depth).toBe(2)
    expect(getCenterText(s, child!)).toBe('ダミーA')
    expect(Object.keys(s.cells)).toHaveLength(16)
  })

  it('通し番号は作った順に増える', () => {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    s = setCellText(s, root.id, 3, 'ダミーC', ids)
    s = setCellText(s, root.id, 1, 'ダミーA', ids)
    expect(getChildUnit(s, root.id, 3)!.number).toBe(2)
    expect(getChildUnit(s, root.id, 1)!.number).toBe(3)
  })

  it('親のセルを書き換えると、子の中央も変わる', () => {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    s = setCellText(s, root.id, 1, 'ダミーA', ids)
    s = setCellText(s, root.id, 1, 'ダミーB', ids)
    expect(getCenterText(s, getChildUnit(s, root.id, 1)!)).toBe('ダミーB')
    expect(Object.keys(s.units)).toHaveLength(2) // 子ユニットは増えない
  })

  it('空白だけのときは、子ユニットを作らない', () => {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    s = setCellText(s, root.id, 1, '   ', ids)
    expect(getChildUnit(s, root.id, 1)).toBeUndefined()
  })

  it('文字を消しても子ユニットは残り、隠れる。戻すとまた現れる', () => {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    s = setCellText(s, root.id, 1, 'ダミーA', ids)
    const child = getChildUnit(s, root.id, 1)!
    s = setCellText(s, child.id, 5, 'ダミーA-5', ids)
    const grandchild = getChildUnit(s, child.id, 5)!

    s = setCellText(s, root.id, 1, '', ids)
    expect(getChildUnit(s, root.id, 1)).toBeDefined()
    expect(isUnitHidden(s, child)).toBe(true)
    expect(isUnitHidden(s, grandchild)).toBe(true) // 下の段もまとめて隠れる
    expect(getCell(s, child.id, 5)!.text).toBe('ダミーA-5') // 中身は残っている

    s = setCellText(s, root.id, 1, 'ダミーA', ids)
    expect(isUnitHidden(s, child)).toBe(false)
    expect(getChildUnit(s, root.id, 1)!.id).toBe(child.id) // 同じユニットが戻る
  })

  it('同じ文字を書いたときは何も変えない', () => {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    s = setCellText(s, root.id, 1, 'ダミーA', ids)
    const again = setCellText(s, root.id, 1, 'ダミーA', ids)
    expect(again).toBe(s)
  })

  it('長すぎる文字は切りつめる', () => {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    s = setCellText(s, root.id, 2, 'あ'.repeat(MAX_TEXT_LENGTH + 10), ids)
    expect(getCell(s, root.id, 2)!.text).toHaveLength(MAX_TEXT_LENGTH)
  })

  it(`${MAX_DEPTH}段目には、それより下の子ユニットを作らない`, () => {
    const ids = counterIds()
    let s: MandalaState = createMandala('ダミーのテーマ', ids)
    let unit = getRootUnit(s)
    for (let d = 1; d < MAX_DEPTH; d++) {
      s = setCellText(s, unit.id, 1, `ダミー${d}`, ids)
      unit = getChildUnit(s, unit.id, 1)!
    }
    expect(unit.depth).toBe(MAX_DEPTH)
    s = setCellText(s, unit.id, 1, 'ダミー最後', ids)
    expect(getChildUnit(s, unit.id, 1)).toBeUndefined()
  })
})

describe('操作ログ', () => {
  it('書き換えのたびに、前と後の文字が記録される', () => {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    s = setCellText(s, root.id, 1, 'ダミーA', ids)
    s = setCellText(s, root.id, 1, 'ダミーB', ids)
    s = setTitle(s, 'ダミーの新しいテーマ')
    expect(s.operations.map((o) => [o.seq, o.kind, o.before, o.after])).toEqual([
      [1, 'set_text', '', 'ダミーA'],
      [2, 'set_text', 'ダミーA', 'ダミーB'],
      [3, 'set_title', 'ダミーのテーマ', 'ダミーの新しいテーマ'],
    ])
  })
})

describe('道順と数', () => {
  it('最初のユニットから順に並ぶ', () => {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    s = setCellText(s, root.id, 2, 'ダミーB', ids)
    const child = getChildUnit(s, root.id, 2)!
    s = setCellText(s, child.id, 4, 'ダミーB-4', ids)
    const grandchild = getChildUnit(s, child.id, 4)!
    expect(getPath(s, grandchild).map((u) => u.number)).toEqual([1, 2, 3])
  })

  it('文字が入っているセルの数を数える', () => {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    s = setCellText(s, root.id, 1, 'ダミーA', ids)
    s = setCellText(s, root.id, 8, 'ダミーH', ids)
    s = setCellText(s, root.id, 3, ' ', ids)
    expect(countFilledCells(s, root.id)).toBe(2)
  })
})

describe('一覧と深さ', () => {
  function sample() {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    s = setCellText(s, root.id, 1, 'ダミーA', ids) // ユニット2（空）
    s = setCellText(s, root.id, 2, 'ダミーB', ids) // ユニット3
    const b = getChildUnit(s, root.id, 2)!
    s = setCellText(s, b.id, 1, 'ダミーB-1', ids) // ユニット4（空）
    return { s, root, b }
  }

  it('空のユニットを省いて、通し番号の順に並ぶ', () => {
    const { s } = sample()
    expect(listUnits(s, false).map((u) => u.number)).toEqual([1, 3])
    expect(listUnits(s, true).map((u) => u.number)).toEqual([1, 2, 3, 4])
  })

  it('曼荼羅ビューで選べる段の数（書いてある深さまで。隠れたユニットは数えない）', () => {
    const { s, root } = sample()
    expect(contentLevelsBelow(s, root)).toBe(2) // ユニット3（2段目）に書いてある → 2段で見える
    const unit4 = Object.values(s.units).find((u) => u.number === 4)!
    const deeper = setCellText(s, unit4.id, 1, 'ダミーB-1-1')
    expect(contentLevelsBelow(deeper, root)).toBe(3) // 3段目に書いてある → 3段
    const cleared = setCellText(s, root.id, 2, '')
    expect(contentLevelsBelow(cleared, root)).toBe(2) // 最初のユニットにだけ書いてある → 2段
    const empty = createMandala('ダミー')
    expect(contentLevelsBelow(empty, getRootUnit(empty))).toBe(1)
  })
})

describe('開いたときに書き始めるセル', () => {
  it('何も書いていないセルのうち、いちばん若い番号', () => {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    expect(firstEmptyPosition(s, root.id)).toBe(1)
    s = setCellText(s, root.id, 1, 'ダミーA', ids)
    s = setCellText(s, root.id, 2, 'ダミーB', ids)
    s = setCellText(s, root.id, 4, 'ダミーD', ids)
    expect(firstEmptyPosition(s, root.id)).toBe(3)
    s = setCellText(s, root.id, 3, ' ', ids) // 空白だけは「書いていない」
    expect(firstEmptyPosition(s, root.id)).toBe(3)
  })

  it('全部書いてあれば null', () => {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    for (const p of [1, 2, 3, 4, 5, 6, 7, 8] as const) s = setCellText(s, root.id, p, `ダミー${p}`, ids)
    expect(firstEmptyPosition(s, root.id)).toBeNull()
  })
})

describe('続きの枚（2枚目・3枚目…）', () => {
  function fill(s: MandalaState, unitId: string, prefix: string, ids: IdFactory) {
    for (const p of [1, 2, 3, 4, 5, 6, 7, 8] as const) s = setCellText(s, unitId, p, `${prefix}${p}`, ids)
    return s
  }

  it('8マスがすべて埋まると、同じテーマの2枚目ができる', () => {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    s = fill(s, root.id, 'ダミー', ids)
    const pages = getPages(s, root)
    expect(pages.map(pageOf)).toEqual([1, 2])
    const p2 = pages[1]
    expect(p2.continuesUnitId).toBe(root.id)
    expect(p2.depth).toBe(1)
    expect(getCenterText(s, p2)).toBe('ダミーのテーマ') // 中央は1枚目と同じ
    expect(getRootUnit(s).id).toBe(root.id) // 2枚目は「最初のユニット」にならない
    expect(listUnits(s, false).map((u) => u.number)).not.toContain(p2.number) // 空の2枚目は一覧に出さない
    expect(unitLabel(s, p2)).toBe('ダミーのテーマ（2枚目）')
    expect(getNextPage(s, root)!.id).toBe(p2.id)
  })

  it('7マスまでは2枚目を作らない', () => {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    for (const p of [1, 2, 3, 4, 5, 6, 7] as const) s = setCellText(s, root.id, p, `ダミー${p}`, ids)
    expect(getPages(s, root)).toHaveLength(1)
  })

  it('2枚目を埋めると3枚目。2枚目のマスにも子ユニットができる', () => {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    s = fill(s, root.id, 'ダミーA', ids)
    const p2 = getPages(s, root)[1]
    s = fill(s, p2.id, 'ダミーB', ids)
    expect(getPages(s, root).map(pageOf)).toEqual([1, 2, 3])
    const child = getChildUnit(s, p2.id, 1)!
    expect(getCenterText(s, child)).toBe('ダミーB1')
    expect(getPath(s, child).map((u) => pageOf(u))).toEqual([2, 1]) // 2枚目 → その子
  })

  it('子ユニットの2枚目も、親のセルの文字を中央にする。親の文字を消すと一緒に隠れる', () => {
    const ids = counterIds()
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    s = setCellText(s, root.id, 1, 'ダミーA', ids)
    const a = getChildUnit(s, root.id, 1)!
    s = fill(s, a.id, 'ダミーA-', ids)
    const a2 = getPages(s, a)[1]
    expect(getCenterText(s, a2)).toBe('ダミーA')
    expect(a2.depth).toBe(2)
    s = setCellText(s, root.id, 1, '', ids)
    expect(isUnitHidden(s, a2)).toBe(true)
  })

  it('古い保存データ（page がない）でも1枚目として扱う', () => {
    const ids = counterIds()
    const s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    const old = { ...s, units: { [root.id]: { id: root.id, number: 1, parentUnitId: null, parentCell: null, depth: 1 } } }
    expect(pageOf(getRootUnit(old))).toBe(1)
    expect(getPages(old, getRootUnit(old))).toHaveLength(1)
  })
})

describe('画面に出す枚', () => {
  function full(prefix: string, ids: IdFactory) {
    let s = createMandala('ダミーのテーマ', ids)
    const root = getRootUnit(s)
    for (const p of [1, 2, 3, 4, 5, 6, 7, 8] as const) s = setCellText(s, root.id, p, `${prefix}${p}`, ids)
    return { s, root }
  }

  it('8マス埋まっているあいだは、空の2枚目も出す', () => {
    const { s, root } = full('ダミー', counterIds())
    expect(getVisiblePages(s, root).map(pageOf)).toEqual([1, 2])
  })

  it('取り消しなどで1枚目に空きができると、空の2枚目は隠れる（データは残る）', () => {
    const ids = counterIds()
    const { s: s0, root } = full('ダミー', ids)
    const s = setCellText(s0, root.id, 8, '', ids)
    expect(getVisiblePages(s, root).map(pageOf)).toEqual([1])
    expect(getPages(s, root)).toHaveLength(2)
    // また8マス埋まると、同じ2枚目が現れる（作り直さない）
    const again = setCellText(s, root.id, 8, 'ダミー8', ids)
    expect(getVisiblePages(again, root).map((u) => u.id)).toEqual(getPages(s, root).map((u) => u.id))
  })

  it('2枚目に書いてあれば、1枚目に空きができても2枚目は出す', () => {
    const ids = counterIds()
    const { s: s0, root } = full('ダミー', ids)
    const p2 = getPages(s0, root)[1]
    let s = setCellText(s0, p2.id, 1, 'ダミー2枚目', ids)
    s = setCellText(s, root.id, 8, '', ids)
    expect(getVisiblePages(s, root).map(pageOf)).toEqual([1, 2])
  })
})
