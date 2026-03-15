import { useEffect, useRef, useState } from 'react'
import { AveragedGraph } from '../lib/geo'

/**
 * Lazily fetches segment speed graphs from the API as new segment keys appear.
 * Caches previously fetched keys to avoid redundant requests.
 */
export function useFetchSegmentGraphs(segmentKeys: string[]): Map<string, AveragedGraph> {
  const [graphs, setGraphs] = useState<Map<string, AveragedGraph>>(new Map())
  const fetchedKeysRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (segmentKeys.length === 0) return
    const newKeys = segmentKeys.filter(k => !fetchedKeysRef.current.has(k))
    if (newKeys.length === 0) return

    const keysStr = newKeys.sort().join(',')
    fetch(`/api/segment-speeds?keys=${encodeURIComponent(keysStr)}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: Record<string, AveragedGraph> | null) => {
        if (!data) return
        for (const k of newKeys) fetchedKeysRef.current.add(k)
        setGraphs(prev => {
          const next = new Map(prev)
          for (const [k, v] of Object.entries(data)) next.set(k, v)
          return next
        })
      })
      .catch(() => { /* ignore */ })
  }, [segmentKeys])

  return graphs
}
