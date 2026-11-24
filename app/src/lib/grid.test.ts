import { describe, expect, it } from 'vitest'
import { CENTER_INDEX, POSITIONS, indexToPosition, nextPosition, positionToIndex } from './grid'

describe('セル番号と画面の並び', () => {
  it('左上が1で、時計回りに番号がつく', () => {
    expect(POSITIONS.map(positionToIndex)).toEqual([0, 1, 2, 5, 8, 7, 6, 3])
  })

  it('中央にはセル番号がない', () => {
    expect(indexToPosition(CENTER_INDEX)).toBeNull()
  })

  it('番号 → 位置 → 番号 で元に戻る', () => {
    for (const p of POSITIONS) {
      expect(indexToPosition(positionToIndex(p))).toBe(p)
    }
  })

  it('8 の次は 1 に戻る', () => {
    expect(nextPosition(1)).toBe(2)
    expect(nextPosition(8)).toBe(1)
  })
})
