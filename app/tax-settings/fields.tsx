export function Field({
  label,
  name,
  defaultValue,
  suffix,
  type = 'number',
  hint,
}: {
  label: string
  name: string
  defaultValue: string | number | null
  suffix?: string
  type?: 'number' | 'text'
  hint?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-label font-medium uppercase tracking-[0.08em] text-ink-3">{label}</span>
      <span className="flex items-center overflow-hidden rounded-md border border-line bg-card">
        <input
          name={name}
          type={type}
          defaultValue={defaultValue ?? ''}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-body text-ink outline-none"
        />
        {suffix && <span className="border-l border-line-subtle px-2 text-label text-ink-3">{suffix}</span>}
      </span>
      {hint && <span className="mt-1 block text-label leading-snug text-ink-3">{hint}</span>}
    </label>
  )
}

export function CheckField({ label, name, defaultChecked }: { label: string; name: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-line-subtle bg-surface px-3 py-2 text-caption text-ink-2">
      <span>{label}</span>
      <input name={name} type="checkbox" defaultChecked={defaultChecked} className="h-4 w-4 accent-[color:var(--accent-info)]" />
    </label>
  )
}

export function CompactCheck({ name, defaultChecked, label }: { name: string; defaultChecked: boolean; label: string }) {
  return (
    <label className="inline-flex items-center justify-center">
      <span className="sr-only">{label}</span>
      <input name={name} type="checkbox" defaultChecked={defaultChecked} className="h-4 w-4 accent-[color:var(--accent-info)]" />
    </label>
  )
}
