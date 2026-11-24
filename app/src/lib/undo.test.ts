import { describe, expect, it } from 'vitest'
import { createMandala, getRootUnit, setCellText } from './mandala'
import { MAX_UNDO, describeEntry, emptyStacks, popRedo, popUndo, pushRedo, pushUndo, recordEdit, type UndoEntry } from './undo'

const e = (n: number): UndoEntry => ({ kind: 'cell', unitId: 'u1', position: 1, before: `前${n}`, after: `後${n}` })

describe('取り消し・やり直しの記録', () => {
  it('書いた順に積み、新しいものから取り消す', () => {
    let s = recordEdit(emptyStacks, e(1))
    s = recordEdit(s, e(2))
    const [top, rest] = popUndo(s)
    expect(top).toEqual(e(2))
    expect(rest.undo).toEqual([e(1)])
  })

  it('取り消したらやり直しに積み、やり直したら取り消しに戻る', () => {
    let s = recordEdit(emptyStacks, e(1))
    let entry: UndoEntry | undefined
    ;[entry, s] = popUndo(s)
    s = pushRedo(s, entry!)
    expect(s).toEqual({ undo: [], redo: [e(1)] })
    ;[entry, s] = popRedo(s)
    s = pushUndo(s, entry!)
    expect(s).toEqual({ undo: [e(1)], redo: [] })
  })

  it('新しく書くと、やり直しは消える', () => {
    let s = recordEdit(emptyStacks, e(1))
    const [entry, rest] = popUndo(s)
    s = pushRedo(rest, entry!)
    s = recordEdit(s, e(2))
    expect(s.redo).toEqual([])
  })

  it(`記録は ${MAX_UNDO} 件まで（古いものから消える）`, () => {
    let s = emptyStacks
    for (let i = 0; i < MAX_UNDO + 5; i++) s = recordEdit(s, e(i))
    expect(s.undo).toHaveLength(MAX_UNDO)
    expect(s.undo[0]).toEqual(e(5))
  })

  it('空のときは何も取り出さない', () => {
    expect(popUndo(emptyStacks)[0]).toBeUndefined()
    expect(popRedo(emptyStacks)[0]).toBeUndefined()
  })
})

describe('何をしたかの文', () => {
  const s0 = createMandala('ダミーのテーマ')
  const root = getRootUnit(s0)
  const s = setCellText(s0, root.id, 3, 'ダミーC')
  const cell: UndoEntry = { kind: 'cell', unitId: root.id, position: 3, before: '', after: 'ダミーC' }

  it('取り消しは「今 → 戻した先」を、ユニットの名前とセル番号つきで書く', () => {
    expect(describeEntry(s, cell, 'undo')).toBe('取り消し：「ダミーのテーマ」のセル3 「ダミーC」 → （空）')
  })

  it('やり直しは逆向き', () => {
    expect(describeEntry(s, cell, 'redo')).toBe('やり直し：「ダミーのテーマ」のセル3 （空） → 「ダミーC」')
  })

  it('テーマの書きかえ', () => {
    expect(describeEntry(s, { kind: 'title', before: 'ダミー旧', after: 'ダミー新' }, 'undo')).toBe('取り消し：テーマ 「ダミー新」 → 「ダミー旧」')
  })

  it('長い文字は20文字で切る', () => {
    const long: UndoEntry = { ...cell, after: 'あ'.repeat(30) }
    expect(describeEntry(s, long, 'undo')).toContain(`「${'あ'.repeat(20)}…」`)
  })
})
