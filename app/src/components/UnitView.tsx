import { useEffect, useState } from 'react'
import { CENTER_INDEX, POSITIONS, indexToPosition, type CellPosition } from '../lib/grid'
import {
  MAX_TEXT_LENGTH,
  MAX_TITLE_LENGTH,
  countFilledCells,
  firstEmptyPosition,
  getCell,
  getCenterText,
  getChildUnit,
  isRootUnit,
  isUnitHidden,
  type MandalaState,
  type Unit,
} from '../lib/mandala'
import { editorsByPosition, type PresenceInfo } from '../lib/presence'
import { EditableCell } from './EditableCell'

interface Props {
  state: MandalaState
  unit: Unit
  /** 見るだけ（閲覧者）なら true。書く状態にしない */
  readOnly?: boolean
  onSetCellText: (position: CellPosition, text: string) => void
  onSetTitle: (title: string) => void
  /** セル8で Enter を押したとき（続きの枚へ進むため） */
  onFinishLast?: () => void
  /** 取り消し・やり直しで変わったマスを、少しのあいだ光らせる（id が変わるたびに光る） */
  flash?: { position: CellPosition | 'center'; id: number } | null
  /** origin：押したマス（ズームの動きの出発点に使う） */
  onOpenUnit: (unitId: string, origin?: HTMLElement) => void
  /** ほかの人たち（Supabase のときだけ。体験モードでは空） */
  others?: PresenceInfo[]
  /** ほかの人の、打っている途中の文字を出すか */
  showOthersDrafts?: boolean
  /** 自分が書いているマスが変わったとき（ほかの人に知らせるため） */
  onEditingChange?: (position: CellPosition | 'center' | null) => void
  /** 自分が打っている途中の文字が変わったとき */
  onDraftChange?: (draft: string) => void
}

const CELL_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 8]

/** いま書いているマス。'center' は中央（最初のユニットの題名） */
type Editing = CellPosition | 'center' | null

// 1つのユニット（3×3）を表示して、書けるようにする
export function UnitView({
  state,
  unit,
  readOnly = false,
  onSetCellText,
  onSetTitle,
  onFinishLast,
  flash,
  onOpenUnit,
  others = [],
  showOthersDrafts = false,
  onEditingChange,
  onDraftChange,
}: Props) {
  const flashClass = (p: CellPosition | 'center') => (flash && flash.position === p ? `cell-flash flash-${flash.id % 2}` : '')
  const isRoot = isRootUnit(unit)
  const centerText = getCenterText(state, unit)
  // 開いたときに、すぐ書けるようにする
  //   最初のユニットでテーマが空なら、中央（テーマ）から
  //   それ以外は、何も書いていないセルのうち、いちばん若い番号から（全部書いてあれば書く状態にしない）
  //   隠れているユニットは、書く状態にしない
  // ほかの人が書いているマス
  const busyMap = editorsByPosition(others, unit.id)
  const isBusy = (p: CellPosition | 'center') => busyMap.has(p)
  /** 何も書いていなくて、ほかの人も書いていないマス（from の次から時計回り。from がなければ1から） */
  const freeCell = (from?: CellPosition): CellPosition | null => {
    const order = from ? [...POSITIONS.slice(from), ...POSITIONS.slice(0, from - 1)] : POSITIONS
    return order.find((p) => (getCell(state, unit.id, p)?.text ?? '').trim() === '' && !isBusy(p)) ?? null
  }

  const [editing, setEditingState] = useState<Editing>(() => {
    if (readOnly) return null
    if (isRoot && centerText.trim() === '' && !isBusy('center')) return 'center'
    if (isUnitHidden(state, unit)) return null
    const first = firstEmptyPosition(state, unit.id)
    return first && isBusy(first) ? freeCell() : first
  })
  // ほかの人が書いているマスを押したときの、たずねる画面
  const [ask, setAsk] = useState<CellPosition | 'center' | null>(null)

  // 見るだけのときは、どのマスも書く状態にしない
  function setEditing(next: Editing) {
    setEditingState(readOnly ? null : next)
  }

  // 書き始めるとき：ほかの人が書いているマスなら、先にたずねる（ゆるい予約）
  function startEdit(p: CellPosition | 'center') {
    if (isBusy(p)) setAsk(p)
    else setEditing(p)
  }

  // 自分が書いているマスを、ほかの人に知らせる
  useEffect(() => {
    onEditingChange?.(editing)
  }, [editing, onEditingChange])
  // ユニットを閉じたとき（ほかのユニットへ移る・別の見え方にする）は、書いているマスはなし
  useEffect(() => () => onEditingChange?.(null), [onEditingChange])

  function renderAsk(p: CellPosition | 'center') {
    const names = (busyMap.get(p) ?? []).map((o) => o.name).join('・')
    const target = p === 'center' ? freeCell() : freeCell(p)
    return (
      <div key={p} className={p === 'center' ? 'cell cell-ask cell-center-ask' : 'cell cell-ask'} role="alertdialog" aria-label="ほかの人が入力中です">
        <p className="ask-text">{names}さんが入力中です</p>
        {target && (
          <button type="button" className="ask-button ask-primary" onClick={() => { setAsk(null); setEditing(target) }}>
            空いたマス（{target}番）に書く
          </button>
        )}
        <button type="button" className="ask-button" onClick={() => { setAsk(null); setEditing(p) }}>
          このマスに書く
        </button>
        <button type="button" className="ask-button" onClick={() => setAsk(null)}>
          やめる
        </button>
      </div>
    )
  }

  function renderCenter() {
    if (isRoot && ask === 'center') return renderAsk('center')
    if (isRoot) {
      return (
        <EditableCell
          key="center"
          className={`cell-center ${flashClass('center')}`}
          label="テーマ（中央）"
          value={centerText}
          placeholder="考えたいテーマを書く"
          maxLength={MAX_TITLE_LENGTH}
          readOnly={readOnly}
          editing={editing === 'center'}
          others={busyMap.get('center')}
          showOthersDrafts={showOthersDrafts}
          onDraftChange={onDraftChange}
          onStartEdit={() => startEdit('center')}
          onCommit={onSetTitle}
          onCancel={() => setEditing(null)}
          onNext={() => setEditing(1)}
        />
      )
    }
    const parentId = unit.parentUnitId
    return (
      <div key="center" className="cell cell-center">
        <button
          type="button"
          className="cell-body"
          aria-label={`中央：${centerText}。押すと上のユニットに戻ります`}
          onClick={() => parentId && onOpenUnit(parentId)}
        >
          <span className="cell-text">{centerText}</span>
          <span className="cell-hint">↑ 上へ戻る</span>
        </button>
      </div>
    )
  }

  function renderOuter(position: CellPosition) {
    const text = getCell(state, unit.id, position)?.text ?? ''
    const child = getChildUnit(state, unit.id, position)
    const hasText = text.trim() !== ''
    const childFilled = child ? countFilledCells(state, child.id) : 0

    let footer = null
    if (child && hasText) {
      footer = (
        <button
          type="button"
          className="open-child"
          aria-label={`「${text}」のユニット ${child.number} を開く`}
          onClick={(e) => onOpenUnit(child.id, e.currentTarget.closest<HTMLElement>('.cell') ?? undefined)}
        >
          開く ›{childFilled > 0 && <span className="open-child-count">{childFilled}</span>}
        </button>
      )
    } else if (child && childFilled > 0) {
      footer = <span className="hidden-note">下の段が隠れています</span>
    }

    return (
      <EditableCell
        key={position}
        className={flashClass(position)}
        label={`セル ${position}`}
        value={text}
        placeholder={String(position)}
        maxLength={MAX_TEXT_LENGTH}
        readOnly={readOnly}
        editing={editing === position}
        others={busyMap.get(position)}
        showOthersDrafts={showOthersDrafts}
        onDraftChange={onDraftChange}
        onStartEdit={() => startEdit(position)}
        onCommit={(t) => onSetCellText(position, t)}
        onCancel={() => setEditing(null)}
        onNext={() => {
          // 時計回りで次へ。ほかの人が書いているマスは飛ばす
          const next = POSITIONS.slice(position).find((q) => !isBusy(q))
          if (position === 8) {
            setEditing(null)
            onFinishLast?.()
          } else {
            setEditing(next ?? null)
          }
        }}
        footer={footer}
      />
    )
  }

  return (
    <div className="unit" role="group" aria-label={`ユニット ${unit.number}`}>
      {CELL_INDEXES.map((index) => {
        if (index === CENTER_INDEX) return renderCenter()
        const position = indexToPosition(index)
        if (position && ask === position) return renderAsk(position)
        return position ? renderOuter(position) : null
      })}
    </div>
  )
}
