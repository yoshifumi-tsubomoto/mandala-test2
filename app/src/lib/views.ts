// 見え方（ビュー）の種類

export type ViewMode = 'open' | 'zoom' | 'nested' | 'list'

export const VIEW_MODES: { mode: ViewMode; label: string; description: string }[] = [
  { mode: 'open', label: '1つずつ', description: '「開く ›」を押すと、すぐに次のユニットに切りかわります（動きなし）' },
  { mode: 'zoom', label: 'ズーム', description: '「開く ›」を押すと、そのマスが大きく広がって次のユニットになります。戻るときは縮みます' },
  { mode: 'nested', label: '曼荼羅', description: '9つのマスの中に、それぞれのユニットを入れ子で表示します' },
  { mode: 'list', label: '一覧', description: 'ユニットを通し番号の順に、すべて並べます' },
]

export function isViewMode(value: unknown): value is ViewMode {
  return VIEW_MODES.some((v) => v.mode === value)
}

const VIEW_KEY = 'mandala-app:view'

/** 前に選んだ見え方（このブラウザに覚えておくだけ） */
export function loadViewMode(): ViewMode {
  try {
    const v = window.localStorage.getItem(VIEW_KEY)
    return isViewMode(v) ? v : 'open'
  } catch {
    return 'open'
  }
}

export function saveViewMode(mode: ViewMode): void {
  try {
    window.localStorage.setItem(VIEW_KEY, mode)
  } catch {
    // 覚えられなくても使える
  }
}
