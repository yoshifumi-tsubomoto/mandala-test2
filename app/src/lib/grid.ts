// 3×3 のマスと、セル番号（左上を1として時計回りに1〜8）の対応
//
//   画面の並び（左上から行ごとに 0〜8）   セル番号
//     0 1 2                               1 2 3
//     3 4 5                               8 中 4
//     6 7 8                               7 6 5

/** 周りのセルの番号（1〜8） */
export type CellPosition = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

/** 中央のマスの、画面の並びでの位置 */
export const CENTER_INDEX = 4

/** セル番号 1〜8 を、時計回りの順に並べたもの */
export const POSITIONS: readonly CellPosition[] = [1, 2, 3, 4, 5, 6, 7, 8]

// セル番号 → 画面の並びでの位置
const POSITION_TO_INDEX: Record<CellPosition, number> = {
  1: 0, 2: 1, 3: 2, 4: 5, 5: 8, 6: 7, 7: 6, 8: 3,
}

/** セル番号（1〜8）から、画面の並びでの位置（0〜8）を求める */
export function positionToIndex(position: CellPosition): number {
  return POSITION_TO_INDEX[position]
}

/** 画面の並びでの位置（0〜8）から、セル番号を求める。中央なら null */
export function indexToPosition(index: number): CellPosition | null {
  for (const p of POSITIONS) {
    if (POSITION_TO_INDEX[p] === index) return p
  }
  return null
}

/** 時計回りで次のセル番号（8 の次は 1） */
export function nextPosition(position: CellPosition): CellPosition {
  return (position === 8 ? 1 : position + 1) as CellPosition
}
