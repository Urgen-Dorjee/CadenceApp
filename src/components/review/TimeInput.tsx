import { KeyboardEvent, useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { formatTime, parseTime } from '../../lib/time'

interface Props {
  value: number
  onChange: (seconds: number) => void
  label: string
}

/** Time field: type "3:41.5", or use ↑/↓ to nudge by 0.1 s (Shift for 1 s). */
export default function TimeInput({ value, onChange, label }: Props) {
  const [text, setText] = useState(formatTime(value))
  const [invalid, setInvalid] = useState(false)

  useEffect(() => setText(formatTime(value)), [value])

  const commit = () => {
    const parsed = parseTime(text)
    if (parsed === null) {
      setInvalid(true)
      setText(formatTime(value))
      setTimeout(() => setInvalid(false), 1200)
      return
    }
    if (Math.abs(parsed - value) > 0.0005) onChange(parsed)
    else setText(formatTime(value))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.currentTarget.blur()
    if (e.key === 'Escape') {
      setText(formatTime(value))
      e.currentTarget.blur()
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowUp' ? 1 : -1)
      onChange(Math.max(0, value + step))
    }
  }

  return (
    <input
      aria-label={label}
      title="Type a time, or use ↑/↓ to nudge (Shift for 1 s)"
      className={clsx('field-inline w-[84px] font-mono text-[13px] tnum text-right', invalid && 'border-danger')}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      spellCheck={false}
    />
  )
}
