import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  CloudError,
  getMyRole,
  loadCell,
  loadContinuations,
  loadMandala,
  loadUnit,
  setCellText as saveCellText,
  setColor as saveColor,
  setShowDrafts as saveShowDrafts,
  joinPresence,
  type PresenceHandle,
  setTitle as saveTitle,
  undoCellText,
  subscribeMandala,
  type Role,
} from '../lib/cloud'
import {
  applyCellRow,
  applyMandalaRow,
  applyUnitRow,
  setCellTextLocal,
  setCellVersion,
  toState,
} from '../lib/cloudState'
import type { CellPosition } from '../lib/grid'
import { baseUnit, cellKey, countFilledCells, getCell, pageOf, type MandalaState } from '../lib/mandala'
import type { PresenceInfo } from '../lib/presence'
import { emptyStacks, popRedo, popUndo, pushRedo, pushUndo, recordEdit, type UndoEntry, type UndoStacks } from '../lib/undo'
import { MandalaEditor } from './MandalaEditor'
import { SharePanel } from './SharePanel'

interface Props {
  mandalaId: string
  userId: string
  /** ほかの人に見せる名前 */
  userName: string
  /** 生徒（学校の生徒・部屋の合言葉の生徒）は、招待リンクを作る・部屋を開く、ができない（SQL 008・009） */
  student?: boolean
  onBack: () => void
}

const HIDE_DRAFTS_KEY = 'mandala-app:hide-others-drafts'

/** 「ほかの人の途中の文字を表示しない」（このブラウザに覚えておくだけ） */
function loadHideDrafts(): boolean {
  try {
    return window.localStorage.getItem(HIDE_DRAFTS_KEY) === '1'
  } catch {
    return false
  }
}

function saveHideDrafts(value: boolean): void {
  try {
    window.localStorage.setItem(HIDE_DRAFTS_KEY, value ? '1' : '0')
  } catch {
    // 覚えられなくても使える
  }
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

// ログインして使うときの編集画面。書いた内容を Supabase に保存し、ほかの人の変更をすぐ反映する
// マンダラが変わるときは、呼び出す側で key を変えて作り直す
export function CloudEditor({ mandalaId, userId, userName, student = false, onBack }: Props) {
  const [state, setState] = useState<MandalaState | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [sharing, setSharing] = useState(false)
  // 誰がどこを触っているか
  const [others, setOthers] = useState<PresenceInfo[]>([])
  const [hideDrafts, setHideDrafts] = useState(loadHideDrafts)
  const presence = useRef<PresenceHandle | null>(null)
  const [tabId] = useState(() => crypto.randomUUID())

  // 最新の状態（保存の順番待ちの中から、いまの版の番号を読むため）
  const stateRef = useRef<MandalaState | null>(null)
  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])
  // セルごとの保存の順番待ち（同じセルを続けて書いたとき、順番どおりに送る）
  const queues = useRef(new Map<string, Promise<void>>())
  const pending = useRef(0)
  // 自分の保存がまだ終わっていないマス。その間に届いたリアルタイムの知らせは無視する
  // （古い知らせで画面が一瞬もどるのを防ぐ。保存が終わったときに、サーバーの版にそろう）
  const busyCells = useRef(new Map<string, number>())
  const markBusy = (key: string, delta: number) => {
    const n = (busyCells.current.get(key) ?? 0) + delta
    if (n <= 0) busyCells.current.delete(key)
    else busyCells.current.set(key, n)
  }
  // 自分の書き込みの取り消し・やり直し（この画面を開いているあいだだけ）
  const [stacks, setStacksState] = useState<UndoStacks>(emptyStacks)
  const stacksRef = useRef<UndoStacks>(emptyStacks)
  const setStacks = (next: UndoStacks) => {
    stacksRef.current = next
    setStacksState(next)
  }

  useEffect(() => {
    let alive = true
    let unsubscribe: (() => void) | null = null
    ;(async () => {
      try {
        const loaded = await loadMandala(mandalaId)
        const myRole = await getMyRole(loaded.mandala, userId)
        if (!alive) return
        const initial = toState(loaded.mandala, loaded.units, loaded.cells)
        stateRef.current = initial
        setState(initial)
        setRole(myRole)
        unsubscribe = subscribeMandala(mandalaId, {
          onCell: (row) => {
            if (busyCells.current.has(`${row.unit_id}:${row.position}`)) return
            setState((s) => (s ? applyCellRow(s, row) : s))
          },
          onUnit: (row) => setState((s) => (s ? applyUnitRow(s, row) : s)),
          onMandala: (row) => setState((s) => (s ? applyMandalaRow(s, row) : s)),
        })
        presence.current = joinPresence(mandalaId, { tabId, userId, name: userName }, setOthers)
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : '読み込めませんでした')
      }
    })()
    return () => {
      alive = false
      unsubscribe?.()
      presence.current?.leave()
      presence.current = null
    }
  }, [mandalaId, userId, userName, tabId])

  const begin = () => {
    pending.current += 1
    setSaveStatus('saving')
  }
  const end = (ok: boolean) => {
    pending.current -= 1
    if (!ok) setSaveStatus('error')
    else if (pending.current === 0) setSaveStatus('saved')
  }

  // 保存できなかった（または何も変わらなかった）書き込みを、取り消しの記録から外す
  const forget = (entry: UndoEntry) => {
    const st = stacksRef.current
    setStacks({ undo: st.undo.filter((e) => e !== entry), redo: st.redo.filter((e) => e !== entry) })
  }

  const handleSetCellText = useCallback((unitId: string, position: CellPosition, text: string) => {
    const current = stateRef.current
    if (!current || getCell(current, unitId, position)?.text === text) return
    const beforeText = getCell(current, unitId, position)?.text ?? ''
    setMessage(null)
    // 画面は先に書き換えて、保存はあとから順番に送る
    setState((s) => (s ? setCellTextLocal(s, unitId, position, text) : s))
    // 取り消しの記録は、書いたその時に作る（保存が終わる前に Ctrl+Z を押しても取り消せるように）。
    // 版の番号と、実際に入れた場所は、保存が終わったときに書き足す。取り消しは保存のあとに順番に行われる
    const entry: Extract<UndoEntry, { kind: 'cell' }> = { kind: 'cell', unitId, position, before: beforeText, after: text }
    setStacks(recordEdit(stacksRef.current, entry))

    const key = cellKey(unitId, position)
    markBusy(key, 1)
    const previous = queues.current.get(key) ?? Promise.resolve()
    const task = previous.then(async () => {
      begin()
      const expected = getCell(stateRef.current!, unitId, position)?.version ?? 0
      try {
        const result = await saveCellText(unitId, position, text, expected)

        // サーバーが作ったユニット（子ユニット・続きの枚）を、リアルタイムの知らせより先に読み込む
        const ensureUnit = async (id: string | null) => {
          if (!id || stateRef.current?.units[id]) return
          const loaded = await loadUnit(id)
          if (!loaded) return
          setState((s) => {
            if (!s) return s
            let next = applyUnitRow(s, loaded.unit)
            for (const c of loaded.cells) next = applyCellRow(next, c)
            stateRef.current = next
            return next
          })
        }

        if (result.moved) {
          // ほかの人が先に書いていた：頼んだマスは相手の文字に戻し、自分の文字は移した先に出す
          await ensureUnit(result.unitId)
          const [original, placed] = await Promise.all([
            loadCell(unitId, position),
            loadCell(result.unitId, result.position),
          ])
          setState((s) => {
            let next = s
            if (next && original) next = applyCellRow(next, original)
            if (next && placed) next = applyCellRow(next, placed)
            stateRef.current = next
            return next
          })
          const placedUnit = stateRef.current?.units[result.unitId]
          const where =
            placedUnit && result.unitId !== unitId
              ? `${pageOf(placedUnit)}枚目の${result.position}番`
              : `${result.position}番`
          setMessage(`${position}番には、ほかの人が先に書きました。あなたの「${text}」は ${where} に入れました。`)
        } else {
          setState((s) => {
            const next = s ? setCellVersion(s, unitId, position, result.version) : s
            stateRef.current = next
            return next
          })
        }
        await ensureUnit(result.childUnitId)

        // 取り消しの記録に、版の番号と実際に入れた場所を書き足す
        // （移した先に入れたときは、移した先のマスを「空に戻す」取り消しになる）
        if (result.changed) {
          entry.unitId = result.unitId
          entry.position = result.position
          entry.before = result.moved ? '' : beforeText
          entry.version = result.version
        } else {
          forget(entry)
        }

        // 8マスがすべて埋まったら、サーバーが続きの枚を作る。すぐ読み込む
        const now = stateRef.current
        const placedUnit = now?.units[result.unitId]
        if (now && placedUnit && countFilledCells(now, placedUnit.id) === 8) {
          const base = baseUnit(now, placedUnit)
          const pages = await loadContinuations(base.id)
          for (const row of pages) await ensureUnit(row.id)
        }
        end(true)
      } catch (e) {
        end(false)
        forget(entry)
        const conflict = e instanceof CloudError && e.conflict
        setMessage(
          conflict
            ? 'ほかの人が先にこのマスを書き換えました。最新の内容を表示しています。必要なら、もう一度書いてください。'
            : e instanceof Error ? e.message : '保存できませんでした',
        )
        // サーバーの最新の内容に戻す
        const row = await loadCell(unitId, position)
        if (row) setState((s) => (s ? applyCellRow(s, row) : s))
      }
    }).finally(() => markBusy(key, -1))
    queues.current.set(key, task)
  }, [])

  const handleSetTitle = useCallback((title: string) => {
    const current = stateRef.current
    if (!current) return
    const t = title.trim()
    if (t === current.mandala.title) return
    if (t === '') {
      setMessage('テーマ（中央）は空にできません。')
      return
    }
    setMessage(null)
    const before = current.mandala.title
    setState((s) => (s ? { ...s, mandala: { ...s.mandala, title: t } } : s))
    const entry: UndoEntry = { kind: 'title', before, after: t }
    setStacks(recordEdit(stacksRef.current, entry))
    const previous = queues.current.get('title') ?? Promise.resolve()
    const task = previous.then(async () => {
      begin()
      try {
        await saveTitle(current.mandala.id, t)
        end(true)
      } catch (e) {
        end(false)
        forget(entry)
        setMessage(e instanceof Error ? e.message : '題名を保存できませんでした')
        setState((s) => (s ? { ...s, mandala: { ...s.mandala, title: before } } : s))
      }
    })
    queues.current.set('title', task)
  }, [])

  // 取り消し（which='before'）・やり直し（which='after'）を1つ行う
  const replay = useCallback(async (entry: UndoEntry, which: 'before' | 'after'): Promise<UndoEntry | null> => {
    const current = stateRef.current
    if (!current) return null
    const text = entry[which]
    if (entry.kind === 'title') {
      await saveTitle(current.mandala.id, text)
      setState((s) => (s ? { ...s, mandala: { ...s.mandala, title: text } } : s))
      return entry
    }
    const version = await undoCellText(entry.unitId, entry.position, text, entry.version ?? 0)
    setState((s) => {
      if (!s) return s
      const next = setCellVersion(setCellTextLocal(s, entry.unitId, entry.position, text), entry.unitId, entry.position, version)
      stateRef.current = next
      return next
    })
    return { ...entry, version }
  }, [])

  const runReplay = useCallback(
    (direction: 'undo' | 'redo'): UndoEntry | undefined => {
      const [entry, rest] = direction === 'undo' ? popUndo(stacksRef.current) : popRedo(stacksRef.current)
      if (!entry) return undefined
      setStacks(rest)
      setMessage(null)
      // 画面は先に戻して、保存はそのマスの順番待ちのあとに送る
      const shown = entry[direction === 'undo' ? 'before' : 'after']
      setState((s) => {
        if (!s) return s
        const next =
          entry.kind === 'cell'
            ? setCellTextLocal(s, entry.unitId, entry.position, shown)
            : { ...s, mandala: { ...s.mandala, title: shown } }
        stateRef.current = next
        return next
      })
      const key = entry.kind === 'cell' ? cellKey(entry.unitId, entry.position) : 'title'
      markBusy(key, 1)
      const previous = queues.current.get(key) ?? Promise.resolve()
      const task = previous.then(async () => {
        begin()
        try {
          const done = await replay(entry, direction === 'undo' ? 'before' : 'after')
          if (done) setStacks(direction === 'undo' ? pushRedo(stacksRef.current, done) : pushUndo(stacksRef.current, done))
          end(true)
        } catch (e) {
          end(false)
          const conflict = e instanceof CloudError && e.conflict
          setMessage(
            conflict
              ? `このマスは、そのあとほかの人が書き換えたので、${direction === 'undo' ? '取り消せません' : 'やり直せません'}でした。`
              : e instanceof Error ? e.message : '取り消せませんでした',
          )
          if (entry.kind === 'cell') {
            const row = await loadCell(entry.unitId, entry.position)
            if (row) setState((s) => (s ? applyCellRow(s, row) : s))
          }
        }
      }).finally(() => markBusy(key, -1))
      queues.current.set(key, task)
      return entry
    },
    [replay],
  )

  // 自分の様子を知らせる。「途中の文字を見せ合う」がオフなら、途中の文字は送らない
  const showDrafts = state?.mandala.showDrafts ?? false
  const showDraftsRef = useRef(showDrafts)
  useLayoutEffect(() => {
    showDraftsRef.current = showDrafts
  }, [showDrafts])
  const handlePresence = useCallback(
    (patch: Partial<Pick<PresenceInfo, 'unitId' | 'position' | 'draft'>>) => {
      const { draft, ...rest } = patch
      presence.current?.update({ ...rest, draft: showDraftsRef.current && draft ? draft : undefined })
    },
    [],
  )

  const handleSetShowDrafts = useCallback((value: boolean) => {
    const current = stateRef.current
    if (!current) return
    setState((s) => (s ? { ...s, mandala: { ...s.mandala, showDrafts: value } } : s))
    begin()
    saveShowDrafts(current.mandala.id, value)
      .then(() => end(true))
      .catch((e: unknown) => {
        end(false)
        setMessage(e instanceof Error ? e.message : '設定を変えられませんでした')
        setState((s) => (s ? { ...s, mandala: { ...s.mandala, showDrafts: !value } } : s))
      })
  }, [])

  const handleSetColor = useCallback((color: string) => {
    const current = stateRef.current
    if (!current || current.mandala.color === color) return
    const before = current.mandala.color
    setState((s) => (s ? { ...s, mandala: { ...s.mandala, color } } : s))
    begin()
    saveColor(current.mandala.id, color)
      .then(() => end(true))
      .catch((e: unknown) => {
        end(false)
        setMessage(e instanceof Error ? e.message : '色を変えられませんでした')
        setState((s) => (s ? { ...s, mandala: { ...s.mandala, color: before } } : s))
      })
  }, [])

  if (loadError) {
    return (
      <main className="app-main">
        <p className="error-text" role="alert">
          {loadError}
        </p>
        <button type="button" className="secondary-button" onClick={onBack}>
          一覧へ戻る
        </button>
      </main>
    )
  }

  if (!state) {
    return (
      <main className="app-main">
        <p className="muted">読み込んでいます…</p>
      </main>
    )
  }

  const readOnly = role !== 'admin' && role !== 'editor'

  return (
    <MandalaEditor
      key={state.mandala.id}
      state={state}
      readOnly={readOnly}
      onSetCellText={handleSetCellText}
      onSetTitle={handleSetTitle}
      onUndo={readOnly ? undefined : () => runReplay('undo')}
      onRedo={readOnly ? undefined : () => runReplay('redo')}
      nextUndo={stacks.undo[stacks.undo.length - 1]}
      nextRedo={stacks.redo[stacks.redo.length - 1]}
      onSetColor={role === 'admin' ? handleSetColor : undefined}
      others={others}
      showOthersDrafts={showDrafts && !hideDrafts}
      onPresenceChange={handlePresence}
      header={
        <>
          <div className="editor-bar">
            <button type="button" className="text-button" onClick={onBack}>
              ‹ 一覧へ
            </button>
            <span className={`save-status save-${saveStatus}`} role="status">
              {saveStatus === 'saving' && '保存しています…'}
              {saveStatus === 'saved' && '保存しました'}
              {saveStatus === 'error' && '保存できなかった変更があります'}
            </span>
            {role === 'admin' && !student && (
              <button type="button" className="secondary-button" onClick={() => setSharing((v) => !v)}>
                共有
              </button>
            )}
          </div>
          {sharing && <SharePanel mandalaId={state.mandala.id} onClose={() => setSharing(false)} />}
          {(role === 'admin' || showDrafts) && (
            <details className="settings-box">
              <summary>途中の文字の表示</summary>
              {role === 'admin' && (
                <label className="setting-row">
                  <input type="checkbox" checked={showDrafts} onChange={(e) => handleSetShowDrafts(e.target.checked)} />
                  打っている途中の文字を見せ合う（このマンダラの全員）
                </label>
              )}
              {showDrafts && (
                <label className="setting-row">
                  <input
                    type="checkbox"
                    checked={hideDrafts}
                    onChange={(e) => {
                      setHideDrafts(e.target.checked)
                      saveHideDrafts(e.target.checked)
                    }}
                  />
                  ほかの人の途中の文字を、自分の画面に出さない
                </label>
              )}
            </details>
          )}
          {message && (
            <p className="notice" role="alert">
              {message}
            </p>
          )}
        </>
      }
    />
  )
}
