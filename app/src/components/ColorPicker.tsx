import { COLORS, type ColorKey } from '../lib/colors'

interface Props {
  value: ColorKey
  onChange: (color: ColorKey) => void
}

// マンダラの基本色を選ぶ（8色）
export function ColorPicker({ value, onChange }: Props) {
  return (
    <div className="color-picker" role="radiogroup" aria-label="テーマの色">
      {COLORS.map((c) => (
        <button
          key={c.key}
          type="button"
          role="radio"
          aria-checked={c.key === value}
          aria-label={c.label}
          title={c.label}
          data-color={c.key}
          className={c.key === value ? 'swatch swatch-on' : 'swatch'}
          onClick={() => onChange(c.key)}
        />
      ))}
    </div>
  )
}
