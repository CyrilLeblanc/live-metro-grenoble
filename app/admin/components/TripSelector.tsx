/**
 * TripSelector — Step 1 sidebar panel.
 *
 * Displays GTFS trips grouped by line (route_short_name), sorted
 * alphabetically. Clicking a row advances the workflow to Step 2.
 */

import type { TripEntry } from '../types'
import { hexColor } from '../lib/geo'

interface Props {
  tripEntries: TripEntry[]
  onSelect: (entry: TripEntry) => void
}

export default function TripSelector({ tripEntries, onSelect }: Props) {
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
            {entries.map((e) => (
              <div
                key={e.key}
                onClick={() => onSelect(e)}
                style={{ padding: '5px 8px', cursor: 'pointer', borderRadius: 4, marginBottom: 3, background: '#1e2d50' }}
                onMouseEnter={(ev) => (ev.currentTarget.style.background = '#2a3f6f')}
                onMouseLeave={(ev) => (ev.currentTarget.style.background = '#1e2d50')}
              >
                <span style={{ color: '#aaa', fontSize: 11 }}>Sens {e.direction_id} → </span>
                <span>{e.trip_headsign || '(sans terminus)'}</span>
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}
