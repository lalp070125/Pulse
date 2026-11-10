import type { TwinIO } from './io';
import { actuatorFeedback, stepActuator, type ActuatorState } from './motion';

/* ----------------------------------------------------------------------------
 * A station: its parts, their ports, and the binding table that connects each
 * port to a variable path (SPEC 10.2 steps 3–5, docs/parallel-twin-plan.md §1).
 *
 * Ports are the scene's own names for what a part needs or gives:
 *   a conveyor needs `run` and gives `running`,
 *   an actuator needs `extend` and gives `extended` and `retracted`,
 *   a presence sensor gives `present`,
 *   an indicator needs `on`.
 * The binding table decides which variable each port talks to. The scene code
 * never names a variable, so a different machine only needs a different table.
 * -------------------------------------------------------------------------- */

export type Vec3 = readonly [number, number, number];

/** Physical parameters of each part kind. Lengths in metres, times in milliseconds. */
export type Part =
  | {
      id: string;
      kind: 'conveyor';
      /** Centre of the belt's top surface. The belt runs along +x. */
      at: Vec3;
      length: number;
      width: number;
      /** Belt speed in m/s. Negative runs toward −x. */
      speed: number;
    }
  | {
      id: string;
      kind: 'actuator';
      /** Size of the moving plate. */
      size: Vec3;
      /** Centre of the plate at each end. */
      retracted: Vec3;
      extended: Vec3;
      travelMs: number;
    }
  | {
      id: string;
      kind: 'presence';
      /** A beam between two points; it is blocked by anything inside it. */
      from: Vec3;
      to: Vec3;
    }
  | { id: string; kind: 'indicator'; at: Vec3 }
  | { id: string; kind: 'block'; at: Vec3; size: Vec3 };

export type PartKind = Part['kind'];
export type Direction = 'command' | 'sensor';

/** The ports of each part kind and their direction. */
export const PORTS: Record<PartKind, Record<string, Direction>> = {
  conveyor: { run: 'command', running: 'sensor' },
  actuator: { extend: 'command', extended: 'sensor', retracted: 'sensor' },
  presence: { present: 'sensor' },
  indicator: { on: 'command' },
  block: {},
};

/** One row of a binding table: a port (`partId.port`) and the variable path it talks to. */
export interface Binding {
  port: string;
  path: string;
}

export interface Station {
  parts: Part[];
}

export interface PortInfo {
  port: string;
  partId: string;
  name: string;
  direction: Direction;
}

/** Every port of a station, in part order. */
export function portsOf(station: Station): PortInfo[] {
  return station.parts.flatMap((p) =>
    Object.entries(PORTS[p.kind]).map(([name, direction]) => ({
      port: `${p.id}.${name}`,
      partId: p.id,
      name,
      direction,
    })),
  );
}

/** Plain-language problems with a binding table. An empty list means it is complete. */
export function checkBindings(station: Station, table: Binding[]): string[] {
  const problems: string[] = [];
  const ports = new Map(portsOf(station).map((p) => [p.port, p]));
  const seenPort = new Set<string>();
  const sensorPaths = new Map<string, string>();
  for (const row of table) {
    const info = ports.get(row.port);
    if (!info) problems.push(`"${row.port}" is not a port of this station.`);
    if (seenPort.has(row.port)) problems.push(`"${row.port}" is bound twice.`);
    seenPort.add(row.port);
    if (!row.path.trim()) problems.push(`"${row.port}" has an empty path.`);
    if (info?.direction === 'sensor') {
      const other = sensorPaths.get(row.path);
      if (other) problems.push(`"${other}" and "${row.port}" both write "${row.path}".`);
      sensorPaths.set(row.path, row.port);
    }
  }
  for (const p of ports.keys())
    if (!seenPort.has(p)) problems.push(`"${p}" is not bound to anything.`);
  return problems;
}

/* ---------------- Running a station against a TwinIO ---------------- */

export interface StationState {
  actuators: Record<string, ActuatorState>;
}

export function initialState(station: Station): StationState {
  const actuators: Record<string, ActuatorState> = {};
  for (const p of station.parts) if (p.kind === 'actuator') actuators[p.id] = { position: 0 };
  return { actuators };
}

/** Reads the bound command of a port. An unbound port reads as off. */
export function readPort(paths: Map<string, string>, io: TwinIO, port: string): boolean {
  const path = paths.get(port);
  return path ? io.read(path) === true : false;
}

export function pathsByPort(table: Binding[]): Map<string, string> {
  return new Map(table.map((b) => [b.port, b.path]));
}

/**
 * One step of the station: read the commands, move the actuators, write every
 * sensor. `present` holds what the physics scene sees in each presence beam.
 */
export function stepStation(
  station: Station,
  paths: Map<string, string>,
  io: TwinIO,
  state: StationState,
  dtMs: number,
  present: Record<string, boolean>,
): StationState {
  const actuators: Record<string, ActuatorState> = {};
  const write = (port: string, value: boolean) => {
    const path = paths.get(port);
    if (path) io.write(path, value);
  };
  for (const part of station.parts) {
    switch (part.kind) {
      case 'conveyor':
        // The motor's running feedback follows its run command.
        write(`${part.id}.running`, readPort(paths, io, `${part.id}.run`));
        break;
      case 'actuator': {
        const next = stepActuator(
          state.actuators[part.id] ?? { position: 0 },
          readPort(paths, io, `${part.id}.extend`),
          dtMs,
          part.travelMs,
        );
        actuators[part.id] = next;
        const fb = actuatorFeedback(next);
        write(`${part.id}.extended`, fb.extended);
        write(`${part.id}.retracted`, fb.retracted);
        break;
      }
      case 'presence':
        write(`${part.id}.present`, present[part.id] === true);
        break;
      default:
        break;
    }
  }
  return { actuators };
}
