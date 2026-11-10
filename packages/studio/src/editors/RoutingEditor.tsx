import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  TRANSPORTS,
  compileProject,
  type ConcreteVarRef,
  type Project,
  type RouteDir,
  type Transport,
  type VarInfo,
} from '@pulso/core';
import { useProject } from '../state/project';
import { EditorPage, IconButton } from './common';

/* Routing (bus manager, SPEC 6.2 and 5.9): one row per variable, one column per transport.
 * Each cell is a checkbox plus a direction. A variable with no row uses the default
 * (feedback read from Sim, commands written to Sim, globals kept in memory). */

const LABEL: Record<Transport, string> = { sim: 'Sim', twin: 'Twin', panel: 'Panel' };

type Dirs = Record<Transport, RouteDir>;

const sameRef = (a: ConcreteVarRef, b: ConcreteVarRef) => JSON.stringify(a) === JSON.stringify(b);

function Cell({
  v,
  t,
  dir,
  onChange,
}: {
  v: VarInfo;
  t: Transport;
  dir: RouteDir;
  onChange: (d: RouteDir) => void;
}) {
  const on = dir !== 'off';
  // A command signal can only be written; a feedback signal can only be read from the world.
  const canRead = v.owner !== 'command';
  const canWrite = v.owner !== 'feedback';
  return (
    <td className="route-cell">
      <input
        type="checkbox"
        checked={on}
        data-testid={`route-on-${v.path}-${t}`}
        aria-label={`${v.path} on ${LABEL[t]}`}
        onChange={(e) => onChange(e.target.checked ? (canRead ? 'read' : 'write') : 'off')}
      />
      <select
        className="input"
        disabled={!on}
        value={on ? dir : 'read'}
        data-testid={`route-dir-${v.path}-${t}`}
        aria-label={`${v.path} direction on ${LABEL[t]}`}
        onChange={(e) => onChange(e.target.value as RouteDir)}
      >
        <option value="read" disabled={!canRead}>
          Read
        </option>
        <option value="write" disabled={!canWrite}>
          Write
        </option>
      </select>
    </td>
  );
}

export function RoutingEditor() {
  const project = useProject((s) => s.project);
  const update = useProject((s) => s.update);
  const [machine, setMachine] = useState('all');
  const [transport, setTransport] = useState<'all' | Transport>('all');
  const [text, setText] = useState('');

  const compiled = useMemo(() => (project ? compileProject(project) : null), [project]);
  if (!project || !compiled) return <div className="editor-empty">No project is open.</div>;

  const effective = (path: string): Dirs => {
    const r = compiled.routes.get(path) ?? { read: [], write: [] };
    const d: Dirs = { sim: 'off', twin: 'off', panel: 'off' };
    for (const t of r.read) d[t] = 'read';
    for (const t of r.write) d[t] = 'write';
    return d;
  };
  const hasRow = (v: VarInfo) => project.routing.routes.some((r) => sameRef(r.ref, v.ref));

  const set = (v: VarInfo, t: Transport, dir: RouteDir) => {
    const base = effective(v.path);
    update((p: Project) => {
      let row = p.routing.routes.find((r) => sameRef(r.ref, v.ref));
      if (!row) {
        row = { ref: v.ref, ...base };
        p.routing.routes.push(row);
      }
      row[t] = dir;
      // A variable is read from at most one transport: taking Read here frees it elsewhere.
      if (dir === 'read') {
        for (const o of TRANSPORTS) if (o !== t && row[o] === 'read') row[o] = 'off';
      }
    });
  };
  const reset = (v: VarInfo) =>
    update((p: Project) => {
      p.routing.routes = p.routing.routes.filter((r) => !sameRef(r.ref, v.ref));
    });

  const machineName = new Map(project.machines.map((m) => [m.machine.id, m.machine.name]));
  const rows = [...compiled.vars.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .filter(
      (v) =>
        machine === 'all' || (machine === 'global' ? v.machine === null : v.machine === machine),
    )
    .filter((v) => transport === 'all' || effective(v.path)[transport] !== 'off')
    .filter((v) => v.path.toLowerCase().includes(text.toLowerCase()));

  const problems = compiled.problems.filter((p) => p.where === 'Routing');

  return (
    <EditorPage
      testId="editor-routing"
      title="Routing"
      hint="Which transport carries each variable. Logic never names an address; switching Sim to Twin is a change here only."
    >
      <div className="route-filters">
        <label>
          Machine{' '}
          <select
            className="input"
            value={machine}
            data-testid="route-machine"
            onChange={(e) => setMachine(e.target.value)}
          >
            <option value="all">all</option>
            <option value="global">globals</option>
            {project.machines.map((m) => (
              <option key={m.machine.id} value={m.machine.id}>
                {m.machine.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Transport{' '}
          <select
            className="input"
            value={transport}
            data-testid="route-transport"
            onChange={(e) => setTransport(e.target.value as 'all' | Transport)}
          >
            <option value="all">all</option>
            {TRANSPORTS.map((t) => (
              <option key={t} value={t}>
                {LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <input
          className="input"
          placeholder="Filter variables…"
          value={text}
          data-testid="route-filter"
          onChange={(e) => setText(e.target.value)}
        />
        <span className="route-count" data-testid="route-count">
          {rows.length} variables
        </span>
      </div>
      {problems.length > 0 && (
        <div className="route-problems" data-testid="route-problems">
          {problems.map((p, i) => (
            <div key={i}>{p.message}</div>
          ))}
        </div>
      )}
      <table className="grid">
        <thead>
          <tr>
            <th>Variable</th>
            <th>Machine</th>
            <th>Type</th>
            {TRANSPORTS.map((t) => (
              <th key={t}>{LABEL[t]}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const d = effective(v.path);
            return (
              <tr key={v.path} data-testid={`route-row-${v.path}`}>
                <td className="mono">{v.path}</td>
                <td>{v.machine ? (machineName.get(v.machine) ?? '?') : 'globals'}</td>
                <td className="mono">{v.type.kind}</td>
                {TRANSPORTS.map((t) => (
                  <Cell key={t} v={v} t={t} dir={d[t]} onChange={(dir) => set(v, t, dir)} />
                ))}
                <td className="cell-actions">
                  {hasRow(v) && (
                    <IconButton
                      title="Back to the default routing"
                      testId={`route-reset-${v.path}`}
                      onClick={() => reset(v)}
                    >
                      <RotateCcw size={14} strokeWidth={1.5} />
                    </IconButton>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </EditorPage>
  );
}
