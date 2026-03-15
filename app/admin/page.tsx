'use client'

import dynamic from 'next/dynamic'

const AdminMap = dynamic(() => import('./AdminMap'), { ssr: false })

export default function AdminPage() {
  return <AdminMap />
}
