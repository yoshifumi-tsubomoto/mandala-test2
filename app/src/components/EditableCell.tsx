import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { colorForUser, type PresenceInfo } from '../lib/presence'

interface Props {
  /** 今の文字 */
  value: string
  /** 書いているところか */
  editing: boolean
  /** 何も書いていないときの薄い文字 */
  placeholder: string
  maxLength: number
  /** 見出し（読み上げ用） */
  label: string
  className?: string
  /** 見るだけなら true（押しても書けない） */
  readOnly?: boolean
  onStartEdit: () => void
  /** 書き終えた文字を保存する */
  onCommit: (text: string) => void
  /** 書くのをやめる（Esc のときは保存しない。ほかの場所を押したときは保存してから呼ぶ） */
  onCancel: () => void
  /** Enter で次のセルへ進む */
  onNext: () => void
  /** 書いていないときに、文字の下に出すもの（「開く」ボタンなど） */
  footer?: ReactNode
  /** このマスを書いている、ほかの人たち */
  others?: PresenceInfo[]
  /** ほかの人の、打っている途中の文字を出すか */
  showOthersDrafts?: boolean
  /** 打っている途中の文字が変わったとき（ほかの人に知らせるため） */
  onDraftChange?: (draft: string) => void
}

/** ほかの人が書いているときの、名前の札（「ダミーA 入力中」「ダミーA ほか1人 入力中」） */
function OthersBadge({ others }: { others: PresenceInfo[] }) {
  const first = others[0]
  const more = others.length > 1 ? ` ほか${others.length - 1}人` : ''
  return (
    <span className="busy-badge" style={{ background: colorForUser(first.userId) }}>
      {first.name}
      {more} 入力中
    </span>
  )
}

function busyStyle(others: PresenceInfo[] | undefined): CSSProperties | undefined {
  if (!others || others.length === 0) return undefined
  return { ['--busy-color' as string]: colorForUser(others[0].userId) }
}

// 1つのマス。押すと書けるようになる。
//   Enter：保存して、時計回りで次のマスへ
//   Shift + Enter：改行
//   Esc：書くのをやめる（保存しない）
//   ほかの場所を押す：保存する
export function EditableCell(props: Props) {
  if (props.editing && !props.readOnly) return <CellEditor {...props} />

  const isEmpty = props.value.trim() === ''
  const hint = props.readOnly ? '' : '。押すと書けます'
  const others = props.others ?? []
  const busy = others.length > 0
  const draft = props.showOthersDrafts ? others.find((o) => o.draft && o.draft.trim() !== '')?.draft : undefined
  const busyLabel = busy ? `。${others.map((o) => o.name).join('・')}が入力中` : ''
  return (
    <div className={`cell ${busy ? 'cell-busy' : ''} ${props.className ?? ''}`} style={busyStyle(others)}>
      {busy && <OthersBadge others={others} />}
      <button
        type="button"
        className={props.readOnly ? 'cell-body cell-body-readonly' : 'cell-body'}
        aria-label={`${props.label}${isEmpty ? '（未入力）' : `：${props.value}`}${busyLabel}${hint}`}
        aria-readonly={props.readOnly || undefined}
        onClick={props.readOnly ? undefined : props.onStartEdit}
      >
        {isEmpty && !draft ? (
          <span className="cell-placeholder">{props.placeholder}</span>
        ) : isEmpty ? null : (
          <span className="cell-text">{props.value}</span>
        )}
        {draft && <span className="cell-draft" title="ほかの人が打っている途中の文字（まだ確定していません）">{draft}</span>}
      </button>
      {props.footer}
    </div>
  )
}

function CellEditor({ value, maxLength, label, className, onCommit, onCancel, onNext, others, onDraftChange }: Props) {
  const [draft, setDraft] = useState(value)
  // 書き始めたときの文字。変えていなければ保存しない
  // （取り消しなどでマスの文字が外から変わったあと、古い文字で上書きしないため）
  const [initial] = useState(value)
  const changed = draft !== initial
  // Enter や Esc で閉じたあとに、ほかの場所を押したときの保存が二重にならないようにする
  const done = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 書いている文字を、マスの上下の真ん中に出す。
  // 入力欄の高さを文字の量に合わせて、マスの中で上下中央に置く（マスより長くなったら中でスクロール）
  useLayoutEffect(() => {
    const el = inputRef.current
    const box = el?.parentElement
    if (!el || !box) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, box.clientHeight)}px`
  }, [draft])

  function finish(action: () => void) {
    if (done.current) return
    done.current = true
    action()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // 日本語の変換中の Enter は、確定のためのものなので何もしない
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      finish(() => {
        if (changed) onCommit(draft)
        onNext()
      })
    } else if (e.key === 'Escape') {
      e.preventDefault()
      finish(onCancel)
    }
  }

  return (
    <div className={`cell cell-editing ${others?.length ? 'cell-busy' : ''} ${className ?? ''}`} style={busyStyle(others)}>
      {others && others.length > 0 && <OthersBadge others={others} />}
      <textarea
        ref={inputRef}
        rows={1}
        className="cell-input"
        aria-label={label}
        value={draft}
        maxLength={maxLength}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setDraft(e.target.value)
          onDraftChange?.(e.target.value)
        }}
        onKeyDown={handleKeyDown}
        // まだ何も変えていない入力欄では、Ctrl + Z / Ctrl + Y を画面全体の取り消し・やり直しに使う（MandalaEditor）
        data-unchanged={changed ? undefined : 'true'}
        onBlur={() =>
          finish(() => {
            if (changed) onCommit(draft)
            onCancel()
          })
        }
      />
    </div>
  )
}
