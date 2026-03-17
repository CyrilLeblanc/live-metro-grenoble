/**
 * ClustersPanel — sidebar content for Clusters mode.
 *
 * Displays the list of clusters currently loaded in state.
 * Markers are managed imperatively by Leaflet in AdminMap; this panel is
 * purely informational (names, coordinates, stop counts).
 */

import type { Cluster } from '../../../lib/gtfs'

interface Props {
  clusters: Cluster[]
}

export default function ClustersPanel({ clusters }: Props) {
  return (
    <div>
      <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Clusters ({clusters.length})</div>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
        Déplacez les marqueurs sur la carte pour corriger les positions.
      </div>
      <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        {clusters.map((c) => (
          <div key={c.id} style={{ padding: '4px 0', borderBottom: '1px solid #2a2a4a', fontSize: 12 }}>
            <div style={{ color: '#eee' }}>{c.name}</div>
            <div style={{ color: '#888', fontSize: 11 }}>
              {c.lat.toFixed(5)}, {c.lng.toFixed(5)} — {c.stopIds.length} stop(s)
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
