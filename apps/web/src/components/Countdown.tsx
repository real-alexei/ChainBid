import { useEffect, useState } from 'react'
import { countdown } from '../format'

export function Countdown({ endTime }: { endTime: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return <span className="font-mono tabular-nums">{countdown(endTime, now)}</span>
}
