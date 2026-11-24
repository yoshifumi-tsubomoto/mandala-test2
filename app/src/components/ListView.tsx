import { useState } from 'react'
import { isUnitHidden, listUnits, pageOf, unitLabel, type MandalaState } from '../lib/mandala'
import { colorForUser, type PresenceInfo } from '../lib/presence'
import { MiniUnit } from './MiniUnit'

interface Props {
  state: MandalaState
  /** ユニットを押したとき（そのユニットを「1つずつ」ビューで開く） */
  onOpenUnit: (unitId: string) => void
  /** ほかの人たち（いるユニットに印を出す） */
  others?: PresenceInfo[]
}

// 一覧ビュー：ユニットを通し番号の順に、すべて並べる
export function ListView({ state, onOpenUnit, others = [] }: Props) {
  const [includeEmpty, setIncludeEmpty] = useState(false)
  const units = listUnits(state, includeEmpty)

  return (
    <section className="list-view" aria-label="ユニットの一覧">
      <label className="list-option">
        <input
          type="checkbox"
          checked={includeEmpty}
          onChange={(e) => setIncludeEmpty(e.target.checked)}
        />
        まだ何も書いていないユニットも表示する
      </label>

      <ol className="list-grid">
        {units.map((u) => {
          const hidden = isUnitHidden(state, u)
          const title = unitLabel(state, u)
          return (
            <li key={u.id}>
              <button
                type="button"
                className={hidden ? 'list-card list-card-hidden' : 'list-card'}
                aria-label={`ユニット ${u.number}「${title}」を開く${hidden ? '（隠れています）' : ''}`}
                onClick={() => onOpenUnit(u.id)}
              >
                <span className="list-card-head">
                  <span className="unit-number">ユニット {u.number}</span>
                  <span className="unit-depth">{u.depth}段目</span>
                  {pageOf(u) > 1 && <span className="unit-depth">{pageOf(u)}枚目</span>}
                  {hidden && <span className="list-hidden-tag">隠れています</span>}
                  {others.filter((o) => o.unitId === u.id).map((o) => (
                    <span key={o.tabId} className="list-person" style={{ background: colorForUser(o.userId) }} title={`${o.name}さんが見ています`} />
                  ))}
                </span>
                <MiniUnit state={state} unit={u} />
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
