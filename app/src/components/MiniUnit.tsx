import { CENTER_INDEX, indexToPosition } from '../lib/grid'
import { getCell, getCenterText, type MandalaState, type Unit } from '../lib/mandala'

interface Props {
  state: MandalaState
  unit: Unit
}

const CELL_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 8]

// 見るだけの小さな 3×3（一覧ビューで使う）
export function MiniUnit({ state, unit }: Props) {
  return (
    <div className="mini-unit" aria-hidden="true">
      {CELL_INDEXES.map((index) => {
        if (index === CENTER_INDEX) {
          return (
            <div key={index} className="mini-cell mini-center">
              {getCenterText(state, unit)}
            </div>
          )
        }
        const position = indexToPosition(index)
        const text = position ? getCell(state, unit.id, position)?.text ?? '' : ''
        return (
          <div key={index} className={text.trim() ? 'mini-cell' : 'mini-cell mini-empty'}>
            {text}
          </div>
        )
      })}
    </div>
  )
}
