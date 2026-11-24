// マンダラごとの基本色。SQL（003）の check と同じ8色にそろえる。
// 実際の色は index.css の [data-color="…"] で決める（明るい表示・暗い表示の両方）。

export const COLORS = [
  { key: 'green', label: '緑' },
  { key: 'blue', label: '青' },
  { key: 'indigo', label: '藍' },
  { key: 'purple', label: '紫' },
  { key: 'pink', label: 'ピンク' },
  { key: 'red', label: '赤' },
  { key: 'orange', label: 'オレンジ' },
  { key: 'brown', label: '茶' },
] as const

export type ColorKey = (typeof COLORS)[number]['key']

export const DEFAULT_COLOR: ColorKey = 'green'

export function isColorKey(value: unknown): value is ColorKey {
  return COLORS.some((c) => c.key === value)
}

/** 知らない値や空のときは、いつもの緑にする */
export function colorOf(value: unknown): ColorKey {
  return isColorKey(value) ? value : DEFAULT_COLOR
}
