'use client'

import dynamic from 'next/dynamic'

const TramMap = dynamic(() => import('./TramMap'), { ssr: false })

export default function TramMapLoader() {
  return <TramMap />
}
