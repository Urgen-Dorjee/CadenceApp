export default function ProgressBar({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div
      className="h-1.5 w-full rounded-full bg-raised overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
    </div>
  )
}
