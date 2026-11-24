import type { ReactNode } from 'react'
import { APP_NAME, APP_VERSION } from '../lib/config'

interface Props {
  /** 右側に出すもの（体験モードの印、ログイン中の人の名前など） */
  right?: ReactNode
  /** アプリ名を押したとき（一覧へ戻るなど）。なければ押せない */
  onHome?: () => void
}

export function AppHeader({ right, onHome }: Props) {
  return (
    <header className="app-header">
      <h1 className="app-title">
        {onHome ? (
          <button type="button" className="app-title-button" onClick={onHome}>
            {APP_NAME}
          </button>
        ) : (
          APP_NAME
        )}
      </h1>
      <span className="app-version">v{APP_VERSION}</span>
      <div className="app-header-right">{right}</div>
    </header>
  )
}
