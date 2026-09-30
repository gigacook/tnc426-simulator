import type { Report } from '../lib/types';
import { duration, mm } from '../lib/format';

interface Props {
  report: Report | null | undefined;
  checking?: boolean;
  onLine?: (line: number) => void;
}

export function StatusBadge({ ok, errors }: { ok: boolean | null | undefined; errors?: number | null }) {
  if (ok == null) return <span className="badge muted" title="not checked (interpreter unavailable)">unchecked</span>;
  if (ok) return <span className="badge ok">OK</span>;
  return <span className="badge bad">{errors ? `${errors} error${errors === 1 ? '' : 's'}` : 'crash'}</span>;
}

/** The interpreter's verdict: errors, crashes/warnings from the simulation, and the run's numbers. */
export function ReportPanel({ report, checking, onLine }: Props) {
  if (!report) return <div className="panel-empty">{checking ? 'Checking…' : 'No check yet (the interpreter may be off on this server).'}</div>;
  const s = report.stats;
  return (
    <div className="report">
      <div className="report-head">
        <StatusBadge ok={report.ok} errors={report.errors.length} />
        {checking && <span className="muted small">re-checking…</span>}
        <span className="muted small" title="interpreter build">{report.interpreter}</span>
      </div>

      {report.errors.length > 0 && (
        <ul className="diag">
          {report.errors.map((e, i) => (
            <li key={'e' + i} className="err" onClick={() => onLine?.(e.line)}>
              <span className="ln">{e.line}</span>
              <span>
                {e.msg}
                <code>{e.raw}</code>
              </span>
            </li>
          ))}
        </ul>
      )}
      {report.events.length > 0 && (
        <ul className="diag">
          {report.events.map((e, i) => (
            <li key={'v' + i} className={e.sev === 'crash' ? 'err' : 'warn'} onClick={() => onLine?.(e.line)}>
              <span className="ln">{e.line}</span>
              <span>
                <b>{e.sev.toUpperCase()}</b> {e.msg}
              </span>
            </li>
          ))}
        </ul>
      )}

      <dl className="stats">
        <dt>Cycle time</dt>
        <dd>{duration(s.cycle_time)}</dd>
        <dt>Blocks</dt>
        <dd>{report.blocks}</dd>
        <dt>Moves</dt>
        <dd>{s.move_count}</dd>
        <dt>Feed path</dt>
        <dd>{mm(s.path_feed)}</dd>
        <dt>Rapid path</dt>
        <dd>{mm(s.path_rapid)}</dd>
        <dt>Z range</dt>
        <dd>
          {mm(s.min_z)} … {mm(s.max_z)}
        </dd>
        {report.stock && (
          <>
            <dt>Blank</dt>
            <dd>
              {Math.round(report.stock.x1 - report.stock.x0)} × {Math.round(report.stock.y1 - report.stock.y0)} ×{' '}
              {Math.round(report.stock.z1 - report.stock.z0)} mm
            </dd>
          </>
        )}
        {s.removed_volume > 0 && (
          <>
            <dt>Removed</dt>
            <dd>{(s.removed_volume / 1000).toFixed(1)} cm³</dd>
          </>
        )}
      </dl>

      {s.tools_used.length > 0 && (
        <table className="grid small">
          <thead>
            <tr>
              <th>T</th>
              <th>Name</th>
              <th>R</th>
              <th>Moves</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {s.tools_used.map((t) => (
              <tr key={t.t}>
                <td>{t.t}</td>
                <td>{t.name ?? '—'}</td>
                <td>{t.r}</td>
                <td>{t.moves}</td>
                <td>{duration(t.time)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
