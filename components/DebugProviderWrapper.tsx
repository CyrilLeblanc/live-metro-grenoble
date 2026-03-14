'use client'

import { Suspense } from 'react'
import { DebugProvider } from '../contexts/DebugContext'
import TramMapLoader from './TramMapLoader'
import DebugBadge from './DebugBadge'

function Inner() {
  return (
    <DebugProvider>
      <TramMapLoader />
      <DebugBadge />
    </DebugProvider>
  )
}

export default function DebugProviderWrapper() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  )
}
