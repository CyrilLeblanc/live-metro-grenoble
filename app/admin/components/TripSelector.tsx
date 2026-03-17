/**
 * TripSelector — Step 1 sidebar panel.
 *
 * Displays GTFS trips grouped by line (route_short_name), sorted
 * alphabetically. Clicking a row advances the workflow to Step 2.
 */

import type { LatLng } from '../../../lib/geo'
import type { TripEntry } from '../types'
import { hexColor } from '../lib/geo' // used for line group header colour

interface Props {
  tripEntries: TripEntry[]
  /** Keys present in line-paths.json — used to flag routes that already have a saved path. */
  existingKeys: Record<string, LatLng[]>
  onSelect: (entry: TripEntry) => void
  onHover?: (entry: TripEntry | null) => void
}

export default function TripSelector({ tripEntries, existingKeys, onSelect, onHover }: Props) {
  // Group trips by line name and sort groups alphabetically
  const grouped = tripEntries.reduce<Map<string, TripEntry[]>>((acc, t) => {
    if (!acc.has(t.route_short_name)) acc.set(t.route_short_name, [])
    acc.get(t.route_short_name)!.push(t)
    return acc
  }, new Map())

  return (
    <div>
      <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Sélectionner un trajet</div>
      {[...grouped.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([line, entries]) => (
          <div key={line} style={{ marginBottom: 10 }}>
            <div style={{ color: hexColor(entries[0].route_color), fontWeight: 'bold', marginBottom: 4 }}>
              Ligne {line}
            </div>
            {entries.map((e) => {
              const key = `${e.route_short_name}|${e.direction_id}`
              const hasSavedPath = key in existingKeys
              const bgDefault = hasSavedPath ? '#1a3a28' : '#1e2d50'
              const bgHover   = hasSavedPath ? '#1f4d33' : '#2a3f6f'
              return (
                <div
                  key={e.key}
                  onClick={() => onSelect(e)}
                  style={{
                    padding: '5px 8px',
                    cursor: 'pointer',
                    borderRadius: 4,
                    marginBottom: 3,
                    background: bgDefault,
                    borderLeft: hasSavedPath ? '3px solid #27ae60' : '3px solid transparent',
                  }}
                  onMouseEnter={(ev) => { ev.currentTarget.style.background = bgHover; onHover?.(e) }}
                  onMouseLeave={(ev) => { ev.currentTarget.style.background = bgDefault; onHover?.(null) }}
                >
                  <span style={{ color: '#aaa', fontSize: 11 }}>Sens {e.direction_id} → </span>
                  <span>{e.trip_headsign || '(sans terminus)'}</span>
                  {hasSavedPath && <span style={{ color: '#27ae60', fontSize: 10, marginLeft: 6 }}>✓</span>}
                </div>
              )
            })}
          </div>
        ))}
    </div>
  )
}
