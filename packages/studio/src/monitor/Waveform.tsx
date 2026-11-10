import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Pause,
  Play,
  Radio,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { focusedSignals, type Value } from '@pulso/core';
import { askText } from '../state/dialogs';
import { stateTrack, timeText, timerTrack, useLive, type Sample } from '../state/live';
import { useProject } from '../state/project';
import { backToLive, force, openSession } from '../state/runtime';
import { useMonitor } from './store';

/* ----------------------------------------------------------------------------
 * Waveform monitor (SPEC 7.2, 7.3). One shared time axis. Booleans are square
 * waves, numbers are traces, states and enums are labelled bands. The left
 * column shows each signal's value at the cursor and lets you force it.
 * The rows are the focused state's signals (click a state on the live plan)
 * plus any pinned by hand.
 * -------------------------------------------------------------------------- */

const ROW_H = 30;
const AXIS_H = 20;
const ICON = { size: 14, strokeWidth: 1.5 } as const;

interface Row {
  path: string;
  label: string;
  kind: 'bool' | 'num' | 'band';
  /** Can be forced from the chart (a real variable, not a state track or timer). */
  forcible: boolean;
  pinned: boolean;
}

function colors() {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  return {
    bg: v('--bg-0'),
    grid: v('--grid-line'),
    text: v('--text-2'),
    textStrong: v('--text-1'),
    high: v('--ok'),
    low: v('--text-3'),
    num: v('--info'),
    cursor: v('--accent'),
    bands: [
      v('--accent'),
      v('--info'),
      v('--ev-trans'),
      v('--ev-action'),
      v('--ev-logic'),
      v('--ev-inject'),
      v('--ok'),
      v('--warn'),
    ],
  };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Index of the last sample at or before t (or -1). */
function at(samples: Sample[], t: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid]!.t <= t) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

function show(v: Value | undefined): string {
  if (v === undefined) return '—';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export function Waveform() {
  const project = useProject((s) => s.project);
  const vars = useLive((s) => s.vars);
  const history = useLive((s) => s.history);
  const nowUs = useLive((s) => s.timeUs);
  const deployed = useLive((s) => s.deployed);
  const replay = useLive((s) => s.replay);
  const machines = useLive((s) => s.machines);
  const focus = useMonitor((s) => s.focus);
  const pinned = useMonitor((s) => s.pinned);
  const cursorUs = useMonitor((s) => s.cursorUs);
  const spanUs = useMonitor((s) => s.spanUs);
  const endUs = useMonitor((s) => s.endUs);
  const [sessions, setSessions] = useState<{ name: string; bytes: number }[] | null>(null);

  const typeOf = useMemo(() => new Map(vars.map((v) => [v.path, v.type])), [vars]);
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const seen = new Set<string>();
    const add = (path: string, label: string, isPinned: boolean) => {
      if (seen.has(path)) return;
      seen.add(path);
      const t = typeOf.get(path);
      const kind: Row['kind'] = path.includes('.@state')
        ? 'band'
        : path.includes('.@timer.')
          ? 'num'
          : t?.kind === 'bool'
            ? 'bool'
            : t && (t.kind === 'int' || t.kind === 'real' || t.kind === 'duration')
              ? 'num'
              : 'band';
      out.push({ path, label, kind, forcible: typeOf.has(path), pinned: isPinned });
    };
    if (focus && project) {
      add(stateTrack(focus.machineName), `${focus.machineName} state`, false);
      const f = focusedSignals(project, focus.machine, focus.node);
      f.paths.forEach((p) => add(p, p, false));
      f.timers.forEach((t) =>
        add(timerTrack(focus.machineName, t), `${focus.machineName} timer ${t} (ms)`, false),
      );
      f.machines.forEach((m) => add(stateTrack(m), `${m} state`, false));
    } else {
      // Nothing focused yet: each machine's state track.
      machines.forEach((m) => add(stateTrack(m.name), `${m.name} state`, false));
    }
    pinned.forEach((p) => add(p, p.includes('.@state') ? `${p.split('.')[0]} state` : p, true));
    return out;
  }, [focus, project, pinned, machines, typeOf]);

  const end = endUs ?? nowUs;
  const start = end - spanUs;
  const cursor = cursorUs ?? end;

  // Draw.
  const canvas = useRef<HTMLCanvasElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = plot.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const h = AXIS_H + rows.length * ROW_H;
    c.width = Math.round(width * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${width}px`;
    c.style.height = `${h}px`;
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = colors();
    g.fillStyle = k.bg;
    g.fillRect(0, 0, width, h);
    const x = (t: number) => ((t - start) / spanUs) * width;

    // Time axis with about eight labelled ticks.
    const raw = spanUs / 8;
    const pow = 10 ** Math.floor(Math.log10(raw));
    const stepUs = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
    g.font = '10px "JetBrains Mono", ui-monospace, monospace';
    g.textBaseline = 'middle';
    for (let t = Math.ceil(start / stepUs) * stepUs; t <= end; t += stepUs) {
      const px = Math.round(x(t)) + 0.5;
      g.strokeStyle = k.grid;
      g.beginPath();
      g.moveTo(px, AXIS_H);
      g.lineTo(px, h);
      g.stroke();
      g.fillStyle = k.text;
      g.fillText(`${(t / 1e6).toFixed(stepUs < 1e5 ? 2 : 1)}s`, px + 3, AXIS_H / 2);
    }

    rows.forEach((row, i) => {
      const top = AXIS_H + i * ROW_H;
      const samples = history[row.path] ?? [];
      g.strokeStyle = k.grid;
      g.beginPath();
      g.moveTo(0, top + ROW_H - 0.5);
      g.lineTo(width, top + ROW_H - 0.5);
      g.stroke();
      if (!samples.length) return;
      const from = Math.max(0, at(samples, start));
      // Segments [t0, t1) with a value, clipped to the window.
      const segs: { a: number; b: number; v: Value }[] = [];
      for (let j = from; j < samples.length; j++) {
        const s = samples[j]!;
        if (s.t > end) break;
        const next = samples[j + 1];
        const a = Math.max(start, s.t);
        const b = Math.min(end, next ? next.t : Math.min(end, nowUs));
        if (b > a || (b === a && j === samples.length - 1))
          segs.push({ a, b: Math.max(a, b), v: s.v });
      }
      if (row.kind === 'bool') {
        const hi = top + 5;
        const lo = top + ROW_H - 6;
        g.strokeStyle = k.high;
        g.lineWidth = 1.5;
        g.beginPath();
        segs.forEach((sg, n) => {
          const y = sg.v === true ? hi : lo;
          if (n === 0) g.moveTo(x(sg.a), y);
          else g.lineTo(x(sg.a), y);
          g.lineTo(x(sg.b), y);
          if (sg.v === true) {
            g.fillStyle = `${k.high}22`;
            g.fillRect(x(sg.a), hi, Math.max(1, x(sg.b) - x(sg.a)), lo - hi);
          }
        });
        g.stroke();
        g.lineWidth = 1;
      } else if (row.kind === 'num') {
        const nums = segs.map((sg) => Number(sg.v)).filter((v) => Number.isFinite(v));
        const min = Math.min(...nums, 0);
        const max = Math.max(...nums, min + 1);
        const y = (v: number) => top + ROW_H - 5 - ((v - min) / (max - min)) * (ROW_H - 10);
        g.strokeStyle = k.num;
        g.lineWidth = 1.5;
        g.beginPath();
        segs.forEach((sg, n) => {
          const yy = y(Number(sg.v));
          if (n === 0) g.moveTo(x(sg.a), yy);
          else g.lineTo(x(sg.a), yy);
          g.lineTo(x(sg.b), yy);
        });
        g.stroke();
        g.lineWidth = 1;
      } else {
        segs.forEach((sg) => {
          const label = show(sg.v);
          const color = k.bands[hash(label) % k.bands.length]!;
          const a = x(sg.a);
          const w = Math.max(1, x(sg.b) - a);
          g.fillStyle = `${color}40`;
          g.fillRect(a, top + 4, w, ROW_H - 8);
          g.fillStyle = color;
          g.fillRect(a, top + 4, 2, ROW_H - 8);
          if (w > 30) {
            g.fillStyle = k.textStrong;
            g.save();
            g.beginPath();
            g.rect(a, top, w - 2, ROW_H);
            g.clip();
            g.fillText(label, a + 6, top + ROW_H / 2);
            g.restore();
          }
        });
      }
    });

    // The cursor.
    if (cursor >= start && cursor <= end) {
      const px = Math.round(x(cursor)) + 0.5;
      g.strokeStyle = k.cursor;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(px, 0);
      g.lineTo(px, h);
      g.stroke();
      g.lineWidth = 1;
    }
  }, [rows, history, start, end, spanUs, width, cursor, nowUs]);

  // Cursor: click or drag on the plot. Zoom: wheel (around the pointer).
  const tAtX = (clientX: number) => {
    const r = plot.current!.getBoundingClientRect();
    return start + ((clientX - r.left) / r.width) * spanUs;
  };
  const dragging = useRef(false);
  const mon = useMonitor.getState;

  const valueAt = (path: string): Value | undefined => {
    const s = history[path];
    if (!s?.length) return undefined;
    const i = at(s, cursor);
    return i >= 0 ? s[i]!.v : s[0]!.v;
  };

  const forceRow = async (row: Row) => {
    const t = typeOf.get(row.path);
    const nowVal = useLive.getState().values[row.path];
    if (t?.kind === 'bool') return force(row.path, !(nowVal === true));
    const text = await askText(`Force ${row.path}`, 'Value', show(nowVal), (v) =>
      t &&
      (t.kind === 'int' || t.kind === 'real' || t.kind === 'duration') &&
      !Number.isFinite(Number(v))
        ? 'a number'
        : null,
    );
    if (text === null) return;
    const value: Value =
      t && (t.kind === 'int' || t.kind === 'real' || t.kind === 'duration') ? Number(text) : text;
    force(row.path, value);
  };

  const live = !replay;
  return (
    <section className="wave" data-testid="waveform">
      <div className="wave-bar">
        <span className="wave-title">
          {focus
            ? `${focus.machineName} › ${focus.nodeName}`
            : 'Click a state on the plan to see its signals'}
        </span>
        <span className="spacer" />
        <select
          className="input mono wave-pin"
          value=""
          data-testid="wave-pin"
          title="Pin another signal"
          onChange={(e) => e.target.value && mon().pin(e.target.value)}
        >
          <option value="">+ pin a signal…</option>
          {machines.map((m) => (
            <option key={`s-${m.name}`} value={stateTrack(m.name)}>
              {m.name} state
            </option>
          ))}
          {vars.map((v) => (
            <option key={v.path} value={v.path}>
              {v.path}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="tool"
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => mon().setSpan(spanUs / 2)}
        >
          <ZoomIn {...ICON} />
        </button>
        <button
          type="button"
          className="tool"
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => mon().setSpan(spanUs * 2)}
        >
          <ZoomOut {...ICON} />
        </button>
        <button
          type="button"
          className="tool"
          title="Earlier"
          aria-label="Earlier"
          onClick={() => mon().setEnd(end - spanUs / 2)}
        >
          <ChevronLeft {...ICON} />
        </button>
        <button
          type="button"
          className="tool"
          title="Later"
          aria-label="Later"
          onClick={() => mon().setEnd(end + spanUs / 2 >= nowUs ? null : end + spanUs / 2)}
        >
          <ChevronRight {...ICON} />
        </button>
        {endUs === null ? (
          <button
            type="button"
            className="tool"
            data-testid="wave-pause"
            title="Pause the view (the machine keeps running)"
            onClick={() => mon().setEnd(nowUs)}
          >
            <Pause {...ICON} /> Pause
          </button>
        ) : (
          <button
            type="button"
            className="tool on"
            data-testid="wave-resume"
            title="Follow the newest values again"
            onClick={() => {
              mon().setEnd(null);
              mon().setCursor(null);
            }}
          >
            <Play {...ICON} /> Follow
          </button>
        )}
        <span className="wave-sessions">
          <button
            type="button"
            className="tool"
            data-testid="wave-sessions"
            title="Open a recorded session"
            onClick={async () => {
              if (sessions) return setSessions(null);
              const r = (await (await fetch('/api/sessions')).json()) as {
                sessions: { name: string; bytes: number }[];
              };
              setSessions(r.sessions);
            }}
          >
            <FolderOpen {...ICON} /> Sessions
          </button>
          {sessions && (
            <div className="menu-list wave-session-list" role="menu">
              {sessions.length === 0 && (
                <div className="menu-item muted">No recorded sessions yet.</div>
              )}
              {sessions.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setSessions(null);
                    void openSession(s.name);
                  }}
                >
                  <span className="menu-label mono">{s.name}</span>
                  <span className="menu-shortcut">{Math.ceil(s.bytes / 1024)} KB</span>
                </button>
              ))}
            </div>
          )}
        </span>
        {!live && (
          <button
            type="button"
            className="tool on"
            data-testid="wave-live"
            onClick={() => backToLive()}
          >
            <Radio {...ICON} /> Back to live
          </button>
        )}
      </div>
      <div className="wave-main">
        <div className="wave-names" style={{ paddingTop: AXIS_H }}>
          {rows.map((r) => {
            const v = valueAt(r.path);
            return (
              <div
                key={r.path}
                className="wave-name"
                style={{ height: ROW_H }}
                data-testid={`wave-row-${r.path}`}
              >
                <span className="wave-label mono" title={r.path}>
                  {r.label}
                </span>
                <span className="wave-value mono" data-testid={`wave-value-${r.path}`}>
                  {show(v)}
                </span>
                {r.forcible && deployed && live && (
                  <button
                    type="button"
                    className="btn-small wave-force"
                    data-testid={`force-${r.path}`}
                    title={
                      typeOf.get(r.path)?.kind === 'bool'
                        ? 'Force the opposite value (logged as INJECT)'
                        : 'Force a value (logged as INJECT)'
                    }
                    onClick={() => void forceRow(r)}
                  >
                    force
                  </button>
                )}
                {r.pinned && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Unpin ${r.path}`}
                    onClick={() => mon().unpin(r.path)}
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            );
          })}
          {rows.length === 0 && <div className="panel-empty">Deploy and Start to see signals.</div>}
        </div>
        <div
          className="wave-plot"
          ref={plot}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            mon().setCursor(tAtX(e.clientX));
            if (endUs === null) mon().setEnd(nowUs); // looking back: stop following
          }}
          onPointerMove={(e) => dragging.current && mon().setCursor(tAtX(e.clientX))}
          onPointerUp={() => (dragging.current = false)}
          onWheel={(e) => {
            const t = tAtX(e.clientX);
            const span = e.deltaY > 0 ? spanUs * 1.25 : spanUs / 1.25;
            const ratio = (t - start) / spanUs;
            mon().setSpan(span);
            mon().setEnd(Math.min(nowUs, t + (1 - ratio) * span));
          }}
          data-testid="wave-plot"
        >
          <canvas ref={canvas} />
        </div>
      </div>
      <div className="wave-foot mono">
        <span>cursor {timeText(cursor)}</span>
        <span>window {timeText(spanUs)}</span>
        <span>
          {replay ? `recorded: ${replay}` : endUs === null ? 'following live' : 'paused view'}
        </span>
      </div>
    </section>
  );
}
