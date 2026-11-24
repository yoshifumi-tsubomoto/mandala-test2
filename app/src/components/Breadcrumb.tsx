import { getPath, unitLabel, type MandalaState, type Unit } from '../lib/mandala'

interface Props {
  state: MandalaState
  unit: Unit
  onOpenUnit: (unitId: string) => void
}

// 最初のユニットから、いま見ているユニットまでの道順。押すとそこへ戻れる
export function Breadcrumb({ state, unit, onOpenUnit }: Props) {
  const path = getPath(state, unit)
  return (
    <nav className="breadcrumb" aria-label="ユニットの道順">
      <ol>
        {path.map((u, i) => {
          const label = unitLabel(state, u)
          const isCurrent = i === path.length - 1
          return (
            <li key={u.id}>
              {isCurrent ? (
                <span className="crumb crumb-current" aria-current="page">{label}</span>
              ) : (
                <button type="button" className="crumb" onClick={() => onOpenUnit(u.id)}>
                  {label}
                </button>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
