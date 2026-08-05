const STYLES: Record<string, string> = {
  live: 'bg-emerald-500/15 text-emerald-400',
  settled: 'bg-zinc-500/15 text-zinc-400',
  cancelled: 'bg-red-500/15 text-red-400',
  created: 'bg-sky-500/15 text-sky-400',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STYLES[status] ?? ''}`}>
      {status}
    </span>
  )
}
