import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { createMandala, deleteMandala, listMandalas, type MandalaSummary, type Role } from '../lib/cloud'
import { colorOf } from '../lib/colors'
import { MAX_TITLE_LENGTH } from '../lib/mandala'
import { DisplayNameBox } from './DisplayNameBox'
import { RoomJoinForm } from './RoomJoinForm'

interface Props {
  userId: string
  /** 部屋の合言葉で入った生徒（マンダラは作れない。ほかの部屋に入れる） */
  student: boolean
  /** 部屋の合言葉で入るところを出すか（合言葉の生徒と、学校のアカウントの生徒） */
  canJoinRoom: boolean
  /** 学校のアカウントで入った生徒の、今の表示名（表示名を変えるところを出す） */
  schoolName?: string
  /** 学校のアカウントの先生（生徒のマンダラを分けて出す） */
  schoolTeacher?: boolean
  roomForm: Parameters<typeof RoomJoinForm>[0]
  onOpen: (mandalaId: string) => void
}

const ROLE_LABEL: Record<Role, string> = { admin: '管理者', editor: '編集できる', viewer: '見るだけ' }

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ログインしたあとの最初の画面：自分が見られるマンダラの一覧と、新しく作るところ
export function MandalaListScreen({ userId, student, canJoinRoom, schoolName, schoolTeacher = false, roomForm, onOpen }: Props) {
  const [items, setItems] = useState<MandalaSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      const list = await listMandalas(userId)
      setItems(list)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '一覧を読み込めませんでした')
    }
  }, [userId])

  useEffect(() => {
    let alive = true
    listMandalas(userId)
      .then((list) => {
        if (alive) setItems(list)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : '一覧を読み込めませんでした')
      })
    return () => {
      alive = false
    }
  }, [userId])

  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    setBusy(true)
    try {
      const id = await createMandala(t)
      onOpen(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'マンダラを作れませんでした')
      setBusy(false)
    }
  }

  async function handleDelete(item: MandalaSummary) {
    if (!window.confirm(`「${item.title}」を削除しますか？\n書いた内容と、参加している人の記録もすべて消えます。元に戻せません。`)) return
    try {
      await deleteMandala(item.id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除できませんでした')
    }
  }

  return (
    <main className="app-main">
      <h2 className="screen-title">マンダラの一覧</h2>

      {schoolName !== undefined && <DisplayNameBox name={schoolName} teacher={schoolTeacher} />}

      {student ? (
        <section className="login-box" aria-labelledby="join-other">
          <h3 id="join-other" className="login-box-title">
            ほかの部屋に入る
          </h3>
          <RoomJoinForm {...roomForm} />
        </section>
      ) : (
        <form className="create-form" onSubmit={handleCreate}>
          <label htmlFor="new-title" className="create-label">
            新しいマンダラのテーマ
          </label>
          <div className="create-row">
            <input
              id="new-title"
              className="text-input"
              value={title}
              maxLength={MAX_TITLE_LENGTH}
              placeholder="考えたいテーマ"
              onChange={(e) => setTitle(e.target.value)}
            />
            <button type="submit" className="primary-button" disabled={busy || title.trim() === ''}>
              作る
            </button>
          </div>
        </form>
      )}

      {canJoinRoom && !student && (
        <section className="login-box room-box" aria-labelledby="join-room">
          <h3 id="join-room" className="login-box-title">
            先生が開いた部屋に入る
          </h3>
          <RoomJoinForm {...roomForm} />
        </section>
      )}

      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}

      {items === null && !error && <p className="muted">読み込んでいます…</p>}
      {items !== null && items.length === 0 && (
        <p className="muted">
          {student
            ? 'まだ入っている部屋がありません。上で合言葉を入れてください。'
            : 'まだマンダラがありません。上でテーマを書いて「作る」を押してください。'}
        </p>
      )}

      {items !== null && items.length > 0 && (
        <>
          {[
            { key: 'own', title: schoolTeacher ? '自分のマンダラ' : '', list: items.filter((i) => !i.fromStudent) },
            { key: 'student', title: '生徒のマンダラ', list: items.filter((i) => i.fromStudent) },
          ]
            .filter((g) => g.list.length > 0)
            .map((g) => (
              <section key={g.key} aria-label={g.title || 'マンダラ'}>
                {g.title && <h3 className="list-section-title">{g.title}（{g.list.length}）</h3>}
                <ul className="mandala-list">
                  {g.list.map((item) => (
                    <li key={item.id} className="mandala-item" data-color={colorOf(item.color)}>
                      <button type="button" className="mandala-open" onClick={() => onOpen(item.id)}>
                        <span className="mandala-title">{item.title}</span>
                        <span className="mandala-meta">
                          {item.fromStudent ? `${item.ownerName ?? ''}・` : ''}
                          {ROLE_LABEL[item.role]}
                          {!item.isOwner && !student && !item.fromStudent && '（招待）'}・{formatDate(item.updatedAt)}
                        </span>
                      </button>
                      {item.isOwner && (
                        <button type="button" className="text-button" onClick={() => handleDelete(item)}>
                          削除
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </>
      )}
    </main>
  )
}
