import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square, Trash2 } from 'lucide-react';
import type { TraceEvent, TraceType } from '@pulso/core';
import { timeTextUs, useLive } from '../state/live';
import { useMonitor } from './store';

/* ----------------------------------------------------------------------------
 * Event log viewer (SPEC 7.4). Every event of the runtime, filterable. A row
 * click moves the waveform cursor to that instant and highlights the state on
 * the plan. Only the visible rows are drawn, so long logs stay fast.
 * -------------------------------------------------------------------------- */

const TYPES: { id: TraceType; label: string; chip: string }[] = [
  { id: 'ACTION', label: 'Actions', chip: 'ev-action' },
  { id: 'TRANS', label: 'Trans', chip: 'ev-trans' },
  { id: 'COND', label: 'Cond', chip: 'ev-cond' },
  { id: 'LOGIC', label: 'LB', chip: 'ev-logic' },
  { id: 'INJECT', label: 'Inject', chip: 'ev-inject' },
  { id: 'BUS', label: 'Bus', chip: 'ev-bus' },
  { id: 'SET', label: 'Set', chip: 'ev-set' },
  { id: 'FAULT', label: 'Fault', chip: 'ev-fault' },
];
const CHIP = Object.fromEntries(TYPES.map((t) => [t.id, t.chip])) as Record<TraceType, string>;
const REFRESH = [
  { ms: 100, label: '0.1 s' },
  { ms: 250, label: '0.25 s' },
  { ms: 1000, label: '1 s' },
] as const;
const ROW = 22;
const ICON = { size: 14, strokeWidth: 1.5 } as const;

/** The driver a BUS event crossed ("sim → path" or "path → sim"). */
function busOf(e: TraceEvent): string | null {
  if (e.type !== 'BUS') return null;
  const m = /^(\w+) →|→ (\w+) =/.exec(e.text);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

export function EventLog() {
  const live = useLive((s) => s.events);
  const machines = useLive((s) => s.machines);
  const replay = useLive((s) => s.replay);
  const [refreshMs, setRefreshMs] = useState(250);
  const [capturing, setCapturing] = useState(true);
  const [shown, setShown] = useState<Record<TraceType, boolean>>({
    ACTION: true,
    TRANS: true,
    COND: true,
    LOGIC: true,
    INJECT: true,
    BUS: false,
    SET: false,
    FAULT: true,
  });
  const [machine, setMachine] = useState('');
  const [bus, setBus] = useState('');
  const [text, setText] = useState('');
  // Clear hides everything up to this event (the runtime keeps them in the session file).
  const [clearedAt, setClearedAt] = useState<TraceEvent | null>(null);
  const [events, setEvents] = useState<TraceEvent[]>(live);
  const [selected, setSelected] = useState<TraceEvent | null>(null);

  // Refresh on the chosen interval while capturing; Stop freezes the list.
  const liveRef = useRef(live);
  liveRef.current = live;
  useEffect(() => {
    if (!capturing) return;
    setEvents(liveRef.current);
    const h = window.setInterval(() => setEvents(liveRef.current), refreshMs);
    return () => window.clearInterval(h);
  }, [capturing, refreshMs]);
  useEffect(() => {
    if (replay) setEvents(live); // a recorded session is shown in full at once
  }, [replay, live]);

  const rows = useMemo(() => {
    const from = clearedAt ? events.lastIndexOf(clearedAt) + 1 : 0;
    const needle = text.trim().toLowerCase();
    const out: TraceEvent[] = [];
    for (let i = from; i < events.length; i++) {
      const e = events[i]!;
      if (!shown[e.type]) continue;
      if (machine && e.machine !== machine) continue;
      if (bus && busOf(e) !== bus) continue;
      if (needle && !`${e.text} ${e.machine ?? ''} ${e.state ?? ''}`.toLowerCase().includes(needle))
        continue;
      out.push(e);
    }
    return out;
  }, [events, clearedAt, shown, machine, bus, text]);

  // Windowed table: draw only the rows in view; follow the end while capturing.
  const body = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(300);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = body.current;
    if (el && follow && capturing) el.scrollTop = el.scrollHeight;
  }, [rows, follow, capturing]);
  const first = Math.max(0, Math.floor(scroll / ROW) - 5);
  const last = Math.min(rows.length, Math.ceil((scroll + height) / ROW) + 5);

  const pick = (e: TraceEvent) => {
    setSelected(e);
    useMonitor.getState().pointAt(e.machine, e.state, e.timeUs);
  };

  return (
    <section className="evlog" data-testid="event-log">
      <div className="evlog-bar">
        <label className="evlog-field" title="How often the list refreshes while running">
          <select
            className="input"
            value={refreshMs}
            data-testid="log-refresh"
            onChange={(e) => setRefreshMs(Number(e.target.value))}
          >
            {REFRESH.map((r) => (
              <option key={r.ms} value={r.ms}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`tool log-start ${capturing ? 'on' : ''}`}
          data-testid="log-start"
          disabled={capturing}
          onClick={() => setCapturing(true)}
        >
          <Play {...ICON} /> Start
        </button>
        <button
          type="button"
          className="tool"
          data-testid="log-stop"
          disabled={!capturing}
          onClick={() => setCapturing(false)}
        >
          <Square {...ICON} /> Stop
        </button>
        <button
          type="button"
          className="tool"
          data-testid="log-clear"
          title="Clear the list (the session file keeps everything)"
          onClick={() => setClearedAt(events[events.length - 1] ?? null)}
        >
          <Trash2 {...ICON} /> Clear
        </button>
        <span className="evlog-types">
          {TYPES.map((t) => (
            <label key={t.id} className="checkline" title={t.id}>
              <input
                type="checkbox"
                checked={shown[t.id]}
                data-testid={`log-type-${t.id}`}
                onChange={(e) => setShown({ ...shown, [t.id]: e.target.checked })}
              />
              {t.label}
            </label>
          ))}
        </span>
        <label className="evlog-field">
          Machine:
          <select
            className="input"
            value={machine}
            data-testid="log-machine"
            onChange={(e) => setMachine(e.target.value)}
          >
            <option value="">all</option>
            {machines.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="evlog-field">
          Bus:
          <select
            className="input"
            value={bus}
            data-testid="log-bus"
            onChange={(e) => setBus(e.target.value)}
          >
            <option value="">all</option>
            <option value="sim">Sim</option>
            <option value="twin">Twin</option>
            <option value="panel">Panel</option>
          </select>
        </label>
        <input
          className="input mono evlog-filter"
          placeholder="Filter text…"
          value={text}
          data-testid="log-filter"
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <div className="evlog-cols mono">
        <span>Time</span>
        <span>Type</span>
        <span>Machine</span>
        <span>State</span>
        <span>Details</span>
      </div>
      <div
        className="evlog-body mono"
        ref={body}
        onScroll={(e) => {
          const el = e.currentTarget;
          setScroll(el.scrollTop);
          setFollow(el.scrollTop + el.clientHeight >= el.scrollHeight - ROW * 2);
        }}
      >
        <div style={{ height: rows.length * ROW, position: 'relative' }}>
          {rows.slice(first, last).map((e, i) => (
            <div
              key={`${first + i}-${e.tick}-${e.type}`}
              className={`evlog-row ${e === selected ? 'selected' : ''}`}
              style={{ top: (first + i) * ROW }}
              data-testid="log-row"
              role="button"
              tabIndex={0}
              onClick={() => pick(e)}
              onKeyDown={(k) => k.key === 'Enter' && pick(e)}
              title={e.text}
            >
              <span>{timeTextUs(e.timeUs)}</span>
              <span>
                <span className={`ev-chip ${CHIP[e.type]}`}>{e.type}</span>
              </span>
              <span>{e.machine ?? '—'}</span>
              <span>{e.state ?? '—'}</span>
              <span className="evlog-text">{e.text}</span>
            </div>
          ))}
        </div>
        {rows.length === 0 && (
          <div className="panel-empty">
            {events.length ? 'No events match the filters.' : 'No events yet. Deploy and Start.'}
          </div>
        )}
      </div>
      <div className="evlog-foot mono" data-testid="log-footer">
        <span className={capturing ? 'ok-text' : 'muted'}>
          {capturing ? '● running' : '■ stopped'}
        </span>
        <span>Entries: {rows.length}</span>
      </div>
    </section>
  );
}
