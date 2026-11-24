// 体験モードの保存先：このブラウザの中（localStorage）だけ。どこにも送らない。
// 開き直しても内容が残るようにするためのもの。プライベートウィンドウなどでは保存できないことがある。

import type { MandalaState } from './mandala'

const STORAGE_KEY = 'mandala-app:demo:v1'

function looksLikeState(value: unknown): value is MandalaState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<MandalaState>
  return (
    typeof v.mandala === 'object' && v.mandala !== null &&
    typeof v.units === 'object' && v.units !== null &&
    typeof v.cells === 'object' && v.cells !== null &&
    Array.isArray(v.operations)
  )
}

export function loadDemo(): MandalaState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return looksLikeState(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveDemo(state: MandalaState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 保存できなくても、画面はそのまま使える
  }
}

export function clearDemo(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 何もしない
  }
}
