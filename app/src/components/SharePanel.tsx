import { useState } from 'react'
import { createShareLink } from '../lib/cloud'
import { RoomPanel } from './RoomPanel'

interface Props {
  mandalaId: string
  onClose: () => void
}

// 招待リンクを作って、コピーできるようにする（管理者だけ）
export function SharePanel({ mandalaId, onClose }: Props) {
  const [link, setLink] = useState<{ url: string; role: 'editor' | 'viewer' } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  async function make(role: 'editor' | 'viewer') {
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const token = await createShareLink(mandalaId, role)
      setLink({ url: `${window.location.origin}/?join=${token}`, role })
    } catch (e) {
      setError(e instanceof Error ? e.message : '招待リンクを作れませんでした')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="share-panel" aria-label="招待リンク">
      <div className="share-head">
        <strong>招待リンクを作る</strong>
        <button type="button" className="text-button" onClick={onClose}>
          閉じる
        </button>
      </div>
      <p className="muted">リンクを開いて Google でログインした人が、このマンダラに参加できます。</p>
      <div className="share-buttons">
        <button type="button" className="secondary-button" disabled={busy} onClick={() => make('editor')}>
          書ける人を招待
        </button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => make('viewer')}>
          見るだけの人を招待
        </button>
      </div>
      {link && (
        <div className="share-result">
          <p className="muted">{link.role === 'editor' ? '書ける人' : '見るだけの人'}を招待するリンク：</p>
          <div className="create-row">
            <input className="text-input" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="primary-button" onClick={copy}>
              {copied ? 'コピーしました' : 'コピー'}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <RoomPanel mandalaId={mandalaId} />
    </section>
  )
}
