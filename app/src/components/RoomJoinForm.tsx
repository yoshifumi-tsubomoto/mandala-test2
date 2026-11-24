import { useState, type FormEvent } from 'react'
import { ROOM_NAME_MAX, formatRoomCode, isRoomCode, normalizeRoomCode, normalizeRoomName } from '../lib/room'

interface Props {
  /** アドレスの ?room= から来た合言葉 */
  initialCode?: string
  /** 前に入れた名前（匿名ログインのとき） */
  initialName?: string
  busy: boolean
  error: string | null
  submitLabel?: string
  onSubmit: (code: string, name: string) => void
}

// 生徒が部屋の合言葉と名前を入れて入るところ（ログインの画面と、生徒の一覧の画面で使う）
export function RoomJoinForm({ initialCode = '', initialName = '', busy, error, submitLabel = '入る', onSubmit }: Props) {
  const [code, setCode] = useState(formatRoomCode(initialCode))
  const [name, setName] = useState(initialName)
  const [hint, setHint] = useState<string | null>(null)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const c = normalizeRoomCode(code)
    const n = normalizeRoomName(name)
    if (!isRoomCode(c)) {
      setHint('合言葉は6文字です（例：K7P-4MX）。先生が見せている文字を、そのまま入れてください')
      return
    }
    if (!n) {
      setHint(`名前を1〜${ROOM_NAME_MAX}文字で入れてください`)
      return
    }
    setHint(null)
    onSubmit(c, n)
  }

  return (
    <form className="room-form" onSubmit={handleSubmit}>
      <label className="room-label" htmlFor="room-code">
        部屋の合言葉
      </label>
      <input
        id="room-code"
        className="text-input room-code-input"
        value={code}
        maxLength={9}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="K7P-4MX"
        onChange={(e) => setCode(formatRoomCode(e.target.value).slice(0, 7))}
      />
      <label className="room-label" htmlFor="room-name">
        名前（ほかの人の画面に出ます）
      </label>
      <input
        id="room-name"
        className="text-input"
        value={name}
        maxLength={ROOM_NAME_MAX}
        autoComplete="off"
        placeholder="例：3番、ニックネーム"
        onChange={(e) => setName(e.target.value)}
      />
      <p className="muted room-note">授業では、先生の言うとおりに、出席番号やニックネームを入れましょう。</p>
      <button type="submit" className="primary-button" disabled={busy}>
        {busy ? '入っています…' : submitLabel}
      </button>
      {(hint || error) && (
        <p className="error-text" role="alert">
          {hint ?? error}
        </p>
      )}
    </form>
  )
}
