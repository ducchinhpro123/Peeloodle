/**
 * Document theme controls (P32). The theme is the default for new slides and
 * text, never a retroactive restyle: changing it leaves existing elements exactly
 * as they are. Each editing session groups into one undo entry.
 */

import { PRESENTATION_FONT_FAMILIES } from '../rendering/fonts'
import { usePresentationStore } from './store'
import type { Theme } from '../model/types'

const COLOR_FIELDS = [
  { key: 'text', label: 'Text' },
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Background' },
] as const

export function ThemeControls({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) {
  const endGroup = () => usePresentationStore.getState().endHistoryGroup()
  const update = (patch: Partial<Theme> & { colors?: Record<string, string> }) => {
    onChange({ ...theme, ...patch, colors: { ...theme.colors, ...patch.colors } })
  }

  return (
    <div className="presentation-theme-fields">
      <label>
        Heading font
        <select aria-label="Heading font" value={theme.headingFontId} onChange={(event) => update({ headingFontId: event.target.value })} onBlur={endGroup}>
          {PRESENTATION_FONT_FAMILIES.map((family) => (
            <option key={family.id} value={family.id}>{family.displayName}</option>
          ))}
        </select>
      </label>
      <label>
        Body font
        <select aria-label="Body font" value={theme.bodyFontId} onChange={(event) => update({ bodyFontId: event.target.value })} onBlur={endGroup}>
          {PRESENTATION_FONT_FAMILIES.map((family) => (
            <option key={family.id} value={family.id}>{family.displayName}</option>
          ))}
        </select>
      </label>
      {COLOR_FIELDS.map(({ key, label }) => (
        <label key={key}>
          {label}
          <input
            type="color"
            aria-label={`${label} color`}
            value={theme.colors[key] ?? '#ffffff'}
            onChange={(event) => update({ colors: { [key]: event.target.value } })}
            onBlur={endGroup}
          />
        </label>
      ))}
      <p className="muted">These are defaults for new slides and text. Existing elements keep their own styles.</p>
    </div>
  )
}
