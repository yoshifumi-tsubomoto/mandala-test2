import { useCallback, useEffect, useState } from 'react'
import {
  closeRoom,
  getOpenRoom,
  listRoomMembers,
  openRoom,
  removeRoomMember,
  type OpenRoom,
  type RoomMember,
} from '../lib/cloud'
import { formatRoomCode } from '../lib/room'

interface Props {
  mandalaId: string
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 入った人の一覧を読み直す間隔（パネルを開いているあいだだけ） */
const RELOAD_MS = 10000

// 生徒の部屋（管理者だけ）：合言葉を開く・閉じる・大きく見せる、入った生徒の一覧と「外す」
export function RoomPanel({ mandalaId }: Props) {
  const [room, setRoom] = useState<OpenRoom | null | undefined>(undefined)
  const [members, setMembers] = useState<RoomMember[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [big, setBig] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([getOpenRoom(mandalaId), listRoomMembers(mandalaId)])
      setRoom(r)
      setMembers(m)
    } catch (e) {
      setError(e instanceof Error ? e.message : '部屋を読み込めませんでした')
    }
  }, [mandalaId])

  useEffect(() => {
    let alive = true
    const load = () => {
      Promise.all([getOpenRoom(mandalaId), listRoomMembers(mandalaId)])
        .then(([r, m]) => {
          if (!alive) return
          setRoom(r)
          setMembers(m)
        })
        .catch((e: unknown) => {
          if (alive) setError(e instanceof Error ? e.message : '部屋を読み込めませんでした')
        })
    }
    load()
    const timer = setInterval(load, RELOAD_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [mandalaId])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'うまくいきませんでした')
    } finally {
      setBusy(false)
    }
  }

  function handleRemove(m: RoomMember) {
    if (!window.confirm(`「${m.name}」をこのマンダラから外しますか？\n外した人は、このマンダラの部屋にもう入れません。書いた内容は残ります。`)) return
    void run(() => removeRoomMember(mandalaId, m.userId))
  }

  const roomUrl = room ? `${window.location.origin}/?room=${room.code}` : ''

  return (
    <section className="room-panel" aria-label="生徒の部屋">
      <strong>生徒の部屋</strong>
      <p className="muted">
        生徒は、ログインの画面で合言葉と名前を入れると、このマンダラに入れます（Google ログインはいりません）。部屋は開いてから24時間で自動で閉じます。
      </p>

      {room === undefined && <p className="muted">読み込んでいます…</p>}

      {room === null && (
        <div className="share-buttons">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => run(() => openRoom(mandalaId, 'editor'))}>
            書ける部屋を開く
          </button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => run(() => openRoom(mandalaId, 'viewer'))}>
            見るだけの部屋を開く
          </button>
        </div>
      )}

      {room && (
        <div className="room-open">
          <p className="room-code" aria-label="部屋の合言葉">
            {formatRoomCode(room.code)}
          </p>
          <p className="muted">
            {room.role === 'editor' ? '書ける部屋' : '見るだけの部屋'}・{formatTime(room.expiresAt)} まで
          </p>
          <div className="share-buttons">
            <button type="button" className="primary-button" onClick={() => setBig(true)}>
              大きく見せる
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => run(() => openRoom(mandalaId, room.role))}>
              新しい合言葉にする
            </button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => run(() => closeRoom(mandalaId))}>
              部屋を閉じる
            </button>
          </div>
        </div>
      )}

      <div className="room-members">
        <strong>部屋から入った人（{members.length}人）</strong>
        {members.length === 0 ? (
          <p className="muted">まだいません。</p>
        ) : (
          <ul className="room-member-list">
            {members.map((m) => (
              <li key={m.userId}>
                <span>
                  {m.name}
                  <span className="muted">（{m.role === 'viewer' ? '見るだけ' : '書ける'}）</span>
                </span>
                <button type="button" className="text-button" disabled={busy} onClick={() => handleRemove(m)}>
                  外す
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      {big && room && (
        <div className="room-big" role="dialog" aria-modal="true" aria-label="部屋の合言葉を大きく表示">
          <p className="room-big-lead">ログインの画面で「部屋の合言葉」に入れてください</p>
          <p className="room-big-code">{formatRoomCode(room.code)}</p>
          <p className="room-big-url">{roomUrl}</p>
          <button type="button" className="primary-button" autoFocus onClick={() => setBig(false)}>
            閉じる
          </button>
        </div>
      )}
    </section>
  )
}
