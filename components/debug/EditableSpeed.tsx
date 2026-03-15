'use client'

import { useEffect, useRef, useState } from 'react'

interface EditableSpeedProps {
  value: number
  onSave: (v: number) => void
}

function EditableSpeed({ value, onSave }: EditableSpeedProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value.toFixed(2)))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function commit() {
    const v = parseFloat(draft)
    if (!isNaN(v) && v >= 0 && v <= 10) onSave(v)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        style={{
          width: 64, background: '#1a1a1a', border: '1px solid #fbbf24',
          color: '#fbbf24', fontFamily: 'monospace', fontSize: 12, padding: '1px 4px',
          borderRadius: 3, outline: 'none',
        }}
      />
    )
  }
  return (
    <span
      onClick={() => { setEditing(true); setDraft(String(value.toFixed(2))) }}
      title="Click to edit"
      style={{ cursor: 'text', color: '#fbbf24', fontFamily: 'monospace', fontSize: 12, borderBottom: '1px dashed rgba(251,191,36,0.4)' }}
    >
      {value.toFixed(2)}
    </span>
  )
}

export default EditableSpeed
