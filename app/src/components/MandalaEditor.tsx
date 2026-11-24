import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { positionToIndex, type CellPosition } from '../lib/grid'
import { baseUnit, countFilledCells, getNextPage, getRootUnit, getVisiblePages, isUnitHidden, pageOf, type MandalaState } from '../lib/mandala'
import { colorOf, type ColorKey } from '../lib/colors'
import { describeEntry, type UndoEntry } from '../lib/undo'
import { colorForUser, initialOf, type PresenceInfo } from '../lib/presence'
import { VIEW_MODES, loadViewMode, saveViewMode, type ViewMode } from '../lib/views'
import { Breadcrumb } from './Breadcrumb'
import { ColorPicker } from './ColorPicker'
import { ListView } from './ListView'
import { NestedView } from './NestedView'
import { UnitView } from './UnitView'
import { ViewTabs } from './ViewTabs'

// マンダラ1枚を表示して、書けるようにする画面。
// 体験モード（ブラウザの中だけ）と、ログインして使うとき（Supabase に保存）の両方で使う。
// 保存のしかたは、呼び出す側が onSetCellText・onSetTitle で決める。

interface Props {
  state: MandalaState
  /** 見るだけ（閲覧者）なら true */
  readOnly?: boolean
  onSetCellText: (unitId: string, position: CellPosition, text: string) => void
  onSetTitle: (title: string) => void
  /** 自分の書き込みを取り消す・やり直す（書ける人のときだけ渡す） */
  /** 取り消した（やり直した）ものを返す。何もなければ undefined */
  onUndo?: () => UndoEntry | undefined
  onRedo?: () => UndoEntry | undefined
  /** 次に取り消される・やり直されるもの（ボタンの説明に出す） */
  nextUndo?: UndoEntry
  nextRedo?: UndoEntry
  /** 基本色を変える（変えられる人のときだけ渡す） */
  onSetColor?: (color: ColorKey) => void
  /** ほかの人たち（Supabase のときだけ） */
  others?: PresenceInfo[]
  /** ほかの人の、打っている途中の文字を出すか */
  showOthersDrafts?: boolean
  /** 自分がどのユニットのどのマスにいるか・打っている途中の文字が変わったとき */
  onPresenceChange?: (patch: Partial<Pick<PresenceInfo, 'unitId' | 'position' | 'draft'>>) => void
  /** マスの上に出すもの（題名・共有ボタンなど） */
  header?: ReactNode
  /** 使い方の下に出すもの */
  footer?: ReactNode
}

/** 次に表示するユニットを、どう出すか（ズームの後半の動き） */
type PendingAppear = 'appear' | null

// ズームは、自分で「ズーム」を選んだときだけ動かす見え方なので、
// パソコンで「動きを減らす」設定にしていても動かす（「1つずつ」は動かさない）
// 前半：今のユニットのまま、押したマスへ寄っていく（戻るときは、上の段のマスの大きさへ縮む）
// 後半：切りかわった次のユニットが、ふわっと現れる
const ZOOM_IN_MS = 420
const ZOOM_OUT_MS = 360
const APPEAR_MS = 220
const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

export function MandalaEditor({
  state,
  readOnly = false,
  onSetCellText,
  onSetTitle,
  onUndo,
  onRedo,
  nextUndo,
  nextRedo,
  onSetColor,
  others = [],
  showOthersDrafts = false,
  onPresenceChange,
  header,
  footer,
}: Props) {
  const [currentUnitId, setCurrentUnitId] = useState<string>(() => getRootUnit(state).id)
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode)
  const [nestedLevels, setNestedLevels] = useState(2)
  // セル8で Enter を押したユニット。8マスがすべて埋まって続きの枚ができたら、そこへ進む
  const [advanceFrom, setAdvanceFrom] = useState<string | null>(null)
  // 取り消し・やり直しのお知らせと、光らせるマス
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null)
  const [flash, setFlash] = useState<{ unitId: string; position: CellPosition | 'center'; id: number } | null>(null)
  const unitAreaRef = useRef<HTMLDivElement>(null)
  const pendingAppear = useRef<PendingAppear>(null)
  const zooming = useRef(false)

  useEffect(() => {
    saveViewMode(viewMode)
  }, [viewMode])

  // Ctrl + Z で取り消し、Ctrl + Y（または Ctrl + Shift + Z）でやり直し。
  // マスに書いている途中は、入力欄の中の取り消しが働くので、ここでは何もしない
  const undoRef = useRef({ undo: () => {}, redo: () => {} })
  useLayoutEffect(() => {
    undoRef.current = { undo: () => runUndo('undo'), redo: () => runUndo('redo') }
  })

  // お知らせは4秒で消す
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      // 書いている途中（文字を変えた入力欄）では、入力欄の中の取り消しにまかせる。
      // まだ何も変えていない入力欄（開いたときに自動で書ける状態になったマスなど）では、画面全体の取り消しにする
      const t = e.target as HTMLElement | null
      const typing =
        t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable) &&
        t.dataset.unchanged !== 'true'
      if (typing) return
      // キーを押したままにしても、1回だけ取り消す
      if (e.repeat) {
        const k = e.key.toLowerCase()
        if (k === 'z' || k === 'y') e.preventDefault()
        return
      }
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undoRef.current.undo()
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault()
        undoRef.current.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const selected = state.units[currentUnitId] ?? getRootUnit(state)
  const advanceTo =
    advanceFrom === selected.id && countFilledCells(state, selected.id) === 8
      ? getNextPage(state, selected)
      : undefined
  const unit = advanceTo ?? selected
  const hidden = isUnitHidden(state, unit)
  const pages = getVisiblePages(state, unit)

  // いま開いているユニットを、ほかの人に知らせる。
  // 書いているマスは、UnitView が知らせる（開いたときに自動で書き始めるマスも含む）。
  // ここで position を null にすると、子の UnitView が先に知らせたマスを上書きして消してしまう
  // （React では子の useEffect が親より先に動くため）
  useEffect(() => {
    onPresenceChange?.({ unitId: unit.id })
  }, [unit.id, onPresenceChange])
  const reportEditing = useCallback(
    (position: CellPosition | 'center' | null) => onPresenceChange?.({ position, draft: '' }),
    [onPresenceChange],
  )
  const reportDraft = useCallback((draft: string) => onPresenceChange?.({ draft }), [onPresenceChange])
  const othersHere = others.filter((o) => o.unitId === unit.id)

  // ズームの後半：切りかわった次のユニットを、ふわっと出す
  useLayoutEffect(() => {
    const kind = pendingAppear.current
    pendingAppear.current = null
    const grid = unitAreaRef.current?.querySelector<HTMLElement>('.unit')
    if (!kind || !grid || typeof grid.animate !== 'function') return
    grid.animate(
      [
        { opacity: 0, transform: 'scale(0.96)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: APPEAR_MS, easing: EASE },
    )
  }, [unit.id])

  function openUnit(unitId: string, origin?: HTMLElement) {
    setAdvanceFrom(null)
    if (unitId === unit.id) {
      setCurrentUnitId(unitId)
      return
    }
    const grid = unitAreaRef.current?.querySelector<HTMLElement>('.unit')
    if (viewMode !== 'zoom' || !grid || typeof grid.animate !== 'function') {
      setCurrentUnitId(unitId)
      return
    }
    if (zooming.current) return

    const finish = () => {
      zooming.current = false
      pendingAppear.current = 'appear'
      setCurrentUnitId(unitId)
    }
    const g = grid.getBoundingClientRect()
    const base = baseUnit(state, unit)

    let keyframes: Keyframe[] | null = null
    let duration = ZOOM_IN_MS
    if (origin) {
      // 寄っていく：押したマスが、ユニット全体の大きさになるまで拡大する
      const c = origin.getBoundingClientRect()
      const scale = g.width / c.width
      const dx = (c.left - g.left) * scale
      const dy = (c.top - g.top) * scale
      keyframes = [
        { transform: 'none' },
        { transform: `translate(${-dx}px, ${-dy}px) scale(${scale})` },
      ]
    } else if (base.parentUnitId === unitId && base.parentCell) {
      // 戻る：今のユニットが、上の段のもとのマスの大きさへ縮む
      const index = positionToIndex(base.parentCell)
      const col = index % 3
      const row = Math.floor(index / 3)
      const gap = parseFloat(getComputedStyle(grid).columnGap) || 0
      const cell = (g.width - gap * 2) / 3
      keyframes = [
        { transform: 'none', opacity: 1 },
        { transform: `translate(${col * (cell + gap)}px, ${row * (cell + gap)}px) scale(${cell / g.width})`, opacity: 0.5 },
      ]
      duration = ZOOM_OUT_MS
    }

    if (!keyframes) {
      // 道順で遠くへ飛ぶときなどは、ふわっと切りかえるだけ
      pendingAppear.current = 'appear'
      setCurrentUnitId(unitId)
      return
    }
    zooming.current = true
    grid.style.transformOrigin = 'top left'
    const animation = grid.animate(keyframes, { duration, easing: EASE, fill: 'forwards' })
    animation.onfinish = finish
    animation.oncancel = finish
  }


  /** 取り消し・やり直しをして、何をしたかを知らせる。別のユニットのマスなら、そこを開いて光らせる */
  function runUndo(direction: 'undo' | 'redo') {
    const handler = direction === 'undo' ? onUndo : onRedo
    if (!handler) return
    // 書く状態のマスがあれば、先に閉じる（何も変えていなければ保存しない）。
    // 取り消しでそのマスの文字が変わっても、古い文字が残らないようにする
    const active = document.activeElement
    if (active instanceof HTMLTextAreaElement) active.blur()
    const entry = handler?.()
    if (!entry) return
    const id = Date.now()
    setToast({ text: describeEntry(state, entry, direction), id })
    if (entry.kind === 'cell') {
      const target = state.units[entry.unitId]
      if (target && target.id !== unit.id) {
        setAdvanceFrom(null)
        setCurrentUnitId(target.id)
        if (viewMode === 'list' || viewMode === 'nested') setViewMode('open')
      }
      setFlash({ unitId: entry.unitId, position: entry.position, id })
    } else {
      const root = getRootUnit(state)
      if (root.id !== unit.id) setCurrentUnitId(root.id)
      setFlash({ unitId: root.id, position: 'center', id })
    }
  }

  /** 一覧ビューでユニットを押したら、「1つずつ」ビューでそのユニットを開く */
  function openFromList(unitId: string) {
    setAdvanceFrom(null)
    setCurrentUnitId(unitId)
    setViewMode('open')
  }

  const showsCurrentUnit = viewMode !== 'list'

  return (
    <main
      className={viewMode === 'list' ? 'app-main app-main-wide' : 'app-main'}
      data-color={colorOf(state.mandala.color)}
    >
      {header}
      {onSetColor && (
        <details className="color-box">
          <summary>テーマの色</summary>
          <ColorPicker value={colorOf(state.mandala.color)} onChange={onSetColor} />
        </details>
      )}
      {(onUndo || onRedo) && (
        <div className="undo-bar">
          <button
            type="button"
            className="secondary-button small-button"
            onClick={() => runUndo('undo')}
            disabled={!nextUndo}
            title={nextUndo ? `${describeEntry(state, nextUndo, 'undo')}（Ctrl + Z）` : '取り消すものはありません'}
          >
            ↶ 取り消す
          </button>
          <button
            type="button"
            className="secondary-button small-button"
            onClick={() => runUndo('redo')}
            disabled={!nextRedo}
            title={nextRedo ? `${describeEntry(state, nextRedo, 'redo')}（Ctrl + Y）` : 'やり直すものはありません'}
          >
            ↷ やり直す
          </button>
        </div>
      )}
      <ViewTabs mode={viewMode} onChange={setViewMode} />
      <p className="view-description">{VIEW_MODES.find((v) => v.mode === viewMode)?.description}</p>

      {showsCurrentUnit && (
        <>
          <Breadcrumb state={state} unit={unit} onOpenUnit={(id) => openUnit(id)} />
          <div className="unit-heading">
            <span className="unit-number">ユニット {unit.number}</span>
            <span className="unit-depth">{unit.depth}段目</span>
            {othersHere.length > 0 && (
              <span className="people-here" title={othersHere.map((o) => o.name).join('・')}>
                {othersHere.slice(0, 5).map((o) => (
                  <span key={o.tabId} className="person-dot" style={{ background: colorForUser(o.userId) }} aria-hidden="true">
                    {initialOf(o.name)}
                  </span>
                ))}
                <span className="people-count">ここに{othersHere.length}人</span>
              </span>
            )}
            {readOnly && <span className="readonly-tag">見るだけ</span>}
          </div>
          {pages.length > 1 && (
            <div className="page-tabs" role="group" aria-label="同じテーマの枚">
              {pages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={p.id === unit.id ? 'seg seg-on' : 'seg'}
                  aria-pressed={p.id === unit.id}
                  onClick={() => openUnit(p.id)}
                >
                  {pageOf(p)}枚目
                </button>
              ))}
            </div>
          )}
          {hidden && (
            <p className="notice" role="status">
              このユニットは、上の段のマスの文字が消されているため隠れています。上の段で文字を戻すと、また表示されます。
            </p>
          )}
        </>
      )}

      {(viewMode === 'open' || viewMode === 'zoom') && (
        <div ref={unitAreaRef} className={viewMode === 'zoom' ? 'unit-area unit-area-zoom' : 'unit-area'}>
          <UnitView
            key={unit.id}
            state={state}
            unit={unit}
            readOnly={readOnly}
            onSetCellText={(position, text) => {
              // 続きの枚へ自動で進んだあとに書いたら、その枚を「いま開いているユニット」に決める
              if (unit.id !== currentUnitId) setCurrentUnitId(unit.id)
              if (position !== 8) setAdvanceFrom(null)
              onSetCellText(unit.id, position, text)
            }}
            onFinishLast={() => setAdvanceFrom(unit.id)}
            flash={flash && flash.unitId === unit.id ? { position: flash.position, id: flash.id } : null}
            others={others}
            showOthersDrafts={showOthersDrafts}
            onEditingChange={reportEditing}
            onDraftChange={reportDraft}
            onSetTitle={onSetTitle}
            onOpenUnit={openUnit}
          />
        </div>
      )}

      {viewMode === 'nested' && (
        <NestedView
          state={state}
          unit={unit}
          levels={nestedLevels}
          onLevelsChange={setNestedLevels}
          onOpenUnit={(id) => setCurrentUnitId(id)}
        />
      )}

      {viewMode === 'list' && <ListView state={state} onOpenUnit={openFromList} others={others} />}

      <details className="help">
        <summary>使い方</summary>
        <ul>
          <li>マスを押すと書けます。<kbd>Enter</kbd> で保存して、時計回りで次のマスへ進みます。</li>
          <li>改行は <kbd>Shift</kbd> + <kbd>Enter</kbd>、書くのをやめるときは <kbd>Esc</kbd> です。</li>
          <li>文字を入れたマスの「開く ›」で、そのマスを中央にした次のユニットへ進みます。</li>
          <li>中央のマスか、上の道順を押すと、上のユニットへ戻ります。</li>
          <li>マスの文字を消しても、その先のユニットは消えません。文字を戻すとまた現れます。</li>
          <li>上の「1つずつ・ズーム・曼荼羅・一覧」で、見え方を切りかえられます。書けるのは「1つずつ」と「ズーム」です。</li>
          <li>「曼荼羅」では、内側のユニットを押すと、そのユニットを外側にして見直せます。</li>
          <li>8マスがすべて埋まると、同じテーマの「2枚目」が自動でできます。セル8で <kbd>Enter</kbd> を押すと、そのまま2枚目に進みます。</li>
          <li>「↶ 取り消す」（<kbd>Ctrl</kbd> + <kbd>Z</kbd>）で自分の書き込みを取り消し、「↷ やり直す」（<kbd>Ctrl</kbd> + <kbd>Y</kbd>）で戻せます。あとからほかの人が同じマスを書き換えていたときは、取り消せません。</li>
          <li>ほかの人と同時に同じマスに書いたときは、先に確定したほうが入ります。あとのほうは、時計回りで次の空いているマスに自動で入ります。</li>
        </ul>
      </details>

      {footer}

      {toast && (
        <div key={toast.id} className="toast" role="status">
          {toast.text}
        </div>
      )}
    </main>
  )
}
