import { CENTER_INDEX, indexToPosition } from '../lib/grid'
import {
  getCell,
  getCenterText,
  getChildUnit,
  isUnitHidden,
  contentLevelsBelow,
  countFilledCells,
  type MandalaState,
  type Unit,
} from '../lib/mandala'

/** 曼荼羅ビューで選べる段の数の上限（これより深いと文字が小さくなりすぎる） */
export const NESTED_MAX_LEVELS = 4

interface Props {
  state: MandalaState
  /** いちばん外側に置くユニット */
  unit: Unit
  levels: number
  onLevelsChange: (levels: number) => void
  /** 内側のユニットを押したとき（そのユニットを外側にして見直す） */
  onOpenUnit: (unitId: string) => void
}

const CELL_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 8]

// 曼荼羅ビュー：9つのマスの中に、それぞれの子ユニットを入れ子で表示する
export function NestedView({ state, unit, levels, onLevelsChange, onOpenUnit }: Props) {
  const available = Math.min(NESTED_MAX_LEVELS, contentLevelsBelow(state, unit))
  const shown = Math.min(levels, available)

  return (
    <section className="nested-view" aria-label="曼荼羅ビュー">
      <div className="nested-controls" role="group" aria-label="表示する深さ">
        <span>表示する深さ</span>
        {Array.from({ length: NESTED_MAX_LEVELS }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className={n === shown ? 'seg seg-on' : 'seg'}
            aria-pressed={n === shown}
            disabled={n > available}
            onClick={() => onLevelsChange(n)}
          >
            {n}段
          </button>
        ))}
      </div>
      <div className={`nested-root nested-levels-${shown}`}>
        <NestedUnit state={state} unit={unit} remaining={shown} level={1} onOpenUnit={onOpenUnit} />
      </div>
    </section>
  )
}

interface NestedUnitProps {
  state: MandalaState
  unit: Unit
  /** あと何段、内側に表示するか */
  remaining: number
  level: number
  onOpenUnit: (unitId: string) => void
}

function NestedUnit({ state, unit, remaining, level, onOpenUnit }: NestedUnitProps) {
  return (
    <div className={`nested-unit nested-level-${level}`}>
      {CELL_INDEXES.map((index) => {
        if (index === CENTER_INDEX) {
          return (
            <div key={index} className="nested-cell nested-center">
              <span>{getCenterText(state, unit)}</span>
            </div>
          )
        }
        const position = indexToPosition(index)
        if (!position) return null
        const text = getCell(state, unit.id, position)?.text ?? ''
        const child = getChildUnit(state, unit.id, position)
        // 内側に入れ子で出すか。いちばん外側のまわり（2段目）はいつも出す（9×9 の形になる）。
        // それより内側は、何か書いてあるユニットだけ出す（空のマスが小さく並ぶと読めないため）
        const showChild =
          remaining > 1 && child && text.trim() !== '' && !isUnitHidden(state, child) &&
          (level === 1 || countFilledCells(state, child.id) > 0)

        if (showChild) {
          return (
            <div key={index} className="nested-slot">
              <NestedUnit
                state={state}
                unit={child}
                remaining={remaining - 1}
                level={level + 1}
                onOpenUnit={onOpenUnit}
              />
              <button
                type="button"
                className="nested-open"
                aria-label={`「${text}」のユニット ${child.number} を外側にして見る`}
                onClick={() => onOpenUnit(child.id)}
              />
            </div>
          )
        }
        return (
          <div key={index} className={text.trim() ? 'nested-cell' : 'nested-cell nested-empty'}>
            <span>{text}</span>
          </div>
        )
      })}
    </div>
  )
}
