import { useState, type FormEvent } from 'react'
import { updateDisplayName } from '../lib/cloud'
import { ROOM_NAME_MAX, normalizeRoomName } from '../lib/room'

interface Props {
  /** 今の表示名 */
  name: string
  /** 学校のアカウントの先生 */
  teacher?: boolean
}

// 学校のアカウントで入った生徒が、自分の表示名（出席番号やニックネーム）を決めるところ
export function DisplayNameBox({ name, teacher = false }: Props) {
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const isDefault = /^学校の(生徒|先生) [0-9a-f]{4}$/.test(name)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const n = normalizeRoomName(value)
    if (!n) {
      setMessage({ ok: false, text: `表示名は1〜${ROOM_NAME_MAX}文字で入れてください` })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      await updateDisplayName(n)
      setMessage({ ok: true, text: '表示名を変えました' })
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : '表示名を変えられませんでした' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="login-box room-box" onSubmit={handleSubmit} aria-labelledby="display-name-title">
      <h3 id="display-name-title" className="login-box-title">
        あなたの表示名
      </h3>
      {teacher && <p className="muted room-note">先生として入っています。この学校の生徒が作ったマンダラは、下の「生徒のマンダラ」に全部出ます。</p>}
      {isDefault && !teacher && <p className="muted room-note">はじめに、先生の言うとおりに、出席番号やニックネームにしましょう。</p>}
      <div className="create-row">
        <input
          className="text-input"
          aria-label="表示名"
          value={value}
          maxLength={ROOM_NAME_MAX}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
        />
        <button type="submit" className="primary-button" disabled={busy || value.trim() === name}>
          {busy ? '保存しています…' : '変える'}
        </button>
      </div>
      <p className="muted room-note">
        {teacher ? 'ほかの人の画面（入力中・ここに〇人）に出ます。' : 'ほかの人の画面（入力中・ここに〇人）と、先生の一覧に出ます。本名は入れないようにしましょう。'}
      </p>
      {message && (
        <p className={message.ok ? 'muted' : 'error-text'} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
    </form>
  )
}
