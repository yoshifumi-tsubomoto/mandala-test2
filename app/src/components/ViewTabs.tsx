import { VIEW_MODES, type ViewMode } from '../lib/views'

interface Props {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

// 見え方（ビュー）の切りかえ
export function ViewTabs({ mode, onChange }: Props) {
  return (
    <div className="view-tabs" role="tablist" aria-label="見え方">
      {VIEW_MODES.map((v) => (
        <button
          key={v.mode}
          type="button"
          role="tab"
          aria-selected={v.mode === mode}
          title={v.description}
          className={v.mode === mode ? 'view-tab view-tab-on' : 'view-tab'}
          onClick={() => onChange(v.mode)}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}
