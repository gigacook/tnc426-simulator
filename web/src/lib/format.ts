export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

export function when(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

/** Cycle time as the control shows it: h:mm:ss or m:ss. */
export function duration(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec)) return '—';
  const t = Math.round(sec);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1 << 20) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1 << 20)).toFixed(1)} MB`;
}

export const mm = (n: number) => `${Math.round(n * 10) / 10} mm`;
