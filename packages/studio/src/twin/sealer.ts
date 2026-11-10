import type { Binding, Station, Vec3 } from './station';

/* ----------------------------------------------------------------------------
 * Demo data: the seed Sealer station (SPEC 12) built from primitives, and its
 * binding table (docs/parallel-twin-plan.md §1). Lengths in metres.
 *
 * Layout: the belt runs along +x to a fixed stop. The beam sits just before
 * the stop. The pusher stands beside the belt and pushes the stopped box
 * sideways (+z) onto a table under the seal head, which presses down on it.
 * -------------------------------------------------------------------------- */

export const BELT_TOP = 0.8;
export const BOX: Vec3 = [0.3, 0.24, 0.3];

const STOP_X = 1.03; // centre of the stop gate
const AT_STOP_X = STOP_X - 0.03 - BOX[0] / 2; // box centre when it rests on the stop
const SEAL_Z = 0.62; // centre of the seal position on the side table

export const SEALER_STATION: Station = {
  parts: [
    {
      id: 'conveyor',
      kind: 'conveyor',
      at: [-0.25, BELT_TOP, 0],
      length: 2.6,
      width: 0.5,
      speed: 0.5,
    },
    // The stop: a fixed gate across the end of the belt.
    { id: 'stop', kind: 'block', at: [STOP_X, BELT_TOP + 0.13, 0], size: [0.06, 0.26, 0.5] },
    // The table beside the belt where boxes are sealed. Flush with the belt top.
    { id: 'table', kind: 'block', at: [AT_STOP_X, BELT_TOP - 0.03, 0.88], size: [0.6, 0.06, 1.2] },
    {
      id: 'boxAtStop',
      kind: 'presence',
      from: [AT_STOP_X, BELT_TOP + 0.08, -0.3],
      to: [AT_STOP_X, BELT_TOP + 0.08, 0.3],
    },
    {
      id: 'pusher',
      kind: 'actuator',
      size: [0.28, 0.18, 0.04],
      retracted: [AT_STOP_X, BELT_TOP + 0.1, -0.36],
      extended: [AT_STOP_X, BELT_TOP + 0.1, SEAL_Z - BOX[2] / 2 - 0.025],
      travelMs: 800,
    },
    {
      id: 'sealHead',
      kind: 'actuator',
      size: [0.34, 0.04, 0.34],
      retracted: [AT_STOP_X, BELT_TOP + BOX[1] + 0.27, SEAL_Z],
      extended: [AT_STOP_X, BELT_TOP + BOX[1] + 0.022, SEAL_Z],
      travelMs: 500,
    },
    { id: 'lamp', kind: 'indicator', at: [-1.45, 1.45, -0.42] },
  ],
};

/** The seed Sealer's binding table: exactly the ten paths of the plan. */
export const SEALER_BINDINGS: Binding[] = [
  { port: 'conveyor.run', path: 'Sealer.Conveyor.IMotor.Run' },
  { port: 'pusher.extend', path: 'Sealer.Pusher.ICylinder.Extend' },
  { port: 'sealHead.extend', path: 'Sealer.SealHead.ICylinder.Extend' },
  { port: 'lamp.on', path: 'Sealer.Lamp.IIndicator.On' },
  { port: 'conveyor.running', path: 'Sealer.Conveyor.IMotor.Running' },
  { port: 'boxAtStop.present', path: 'Sealer.BoxAtStop.ISensor.Present' },
  { port: 'pusher.extended', path: 'Sealer.Pusher.ICylinder.Extended' },
  { port: 'pusher.retracted', path: 'Sealer.Pusher.ICylinder.Retracted' },
  { port: 'sealHead.extended', path: 'Sealer.SealHead.ICylinder.Extended' },
  { port: 'sealHead.retracted', path: 'Sealer.SealHead.ICylinder.Retracted' },
];

/** Where new boxes drop onto the belt, and how often by default. */
export const SPAWN_AT: Vec3 = [-1.3, BELT_TOP + BOX[1] / 2 + 0.04, 0];
export const SPAWN_PERIOD_MS = 6000;
