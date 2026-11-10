/**
 * Ports and binding tables.
 *
 * A PORT is a named thing the 3D scene reads (a command) or publishes (a sensor).
 * A BINDING TABLE maps every port to a variable address of one machine.
 * The scene only ever talks about ports, so a different machine needs a
 * different table and no change to the scene code.
 */

export type PortId =
  | 'conveyor.run'
  | 'conveyor.running'
  | 'sensor.present'
  | 'pusher.extend'
  | 'pusher.extended'
  | 'pusher.retracted'
  | 'sealhead.down'
  | 'sealhead.downPosition'
  | 'sealhead.upPosition'
  | 'lamp.on';

export interface Port {
  id: PortId;
  /** command: logic to scene. sensor: scene to logic. */
  direction: 'command' | 'sensor';
  label: string;
}

export const PORTS: readonly Port[] = [
  { id: 'conveyor.run', direction: 'command', label: 'Conveyor: run' },
  { id: 'pusher.extend', direction: 'command', label: 'Pusher: extend' },
  { id: 'sealhead.down', direction: 'command', label: 'Seal head: lower' },
  { id: 'lamp.on', direction: 'command', label: 'Lamp: on' },
  { id: 'conveyor.running', direction: 'sensor', label: 'Conveyor: running' },
  { id: 'sensor.present', direction: 'sensor', label: 'Box sensor: box detected' },
  { id: 'pusher.extended', direction: 'sensor', label: 'Pusher: extended' },
  { id: 'pusher.retracted', direction: 'sensor', label: 'Pusher: retracted' },
  { id: 'sealhead.downPosition', direction: 'sensor', label: 'Seal head: down' },
  { id: 'sealhead.upPosition', direction: 'sensor', label: 'Seal head: up' },
];

export interface BindingTable {
  id: string;
  name: string;
  /** Variable address for every port. */
  addresses: Record<PortId, string>;
}

/** The machine from docs/box-closing-machine-design.md. Addresses follow its equipment names. */
export const BOX_CLOSING_TABLE: BindingTable = {
  id: 'box-closing',
  name: 'Box closing and sealing machine',
  addresses: {
    'conveyor.run': 'Conveyor.Run',
    'conveyor.running': 'Conveyor.Running',
    'sensor.present': 'BoxSensor.Detected',
    'pusher.extend': 'Pusher.Extend',
    'pusher.extended': 'Pusher.Extended',
    'pusher.retracted': 'Pusher.Retracted',
    'sealhead.down': 'SealHead.Down',
    'sealhead.downPosition': 'SealHead.DownPosition',
    'sealhead.upPosition': 'SealHead.UpPosition',
    'lamp.on': 'RunningLamp.On',
  },
};

/** The seed `Sealer` machine (projects/box-sealer-demo). */
export const SEALER_SEED_TABLE: BindingTable = {
  id: 'sealer-seed',
  name: 'Sealer (seed project)',
  addresses: {
    'conveyor.run': 'Sealer.Conveyor.IMotor.Run',
    'conveyor.running': 'Sealer.Conveyor.IMotor.Running',
    'sensor.present': 'Sealer.BoxAtStop.ISensor.Present',
    'pusher.extend': 'Sealer.Pusher.ICylinder.Extend',
    'pusher.extended': 'Sealer.Pusher.ICylinder.Extended',
    'pusher.retracted': 'Sealer.Pusher.ICylinder.Retracted',
    'sealhead.down': 'Sealer.SealHead.ICylinder.Extend',
    'sealhead.downPosition': 'Sealer.SealHead.ICylinder.Extended',
    'sealhead.upPosition': 'Sealer.SealHead.ICylinder.Retracted',
    'lamp.on': 'Sealer.Lamp.IIndicator.On',
  },
};

export const TABLES: readonly BindingTable[] = [BOX_CLOSING_TABLE, SEALER_SEED_TABLE];

/** Problems with a table: a missing address, or one address used for two ports. */
export function checkTable(table: BindingTable): string[] {
  const problems: string[] = [];
  const seen = new Map<string, PortId>();
  for (const port of PORTS) {
    const address = table.addresses[port.id];
    if (!address) {
      problems.push(`${port.id} has no address`);
      continue;
    }
    const other = seen.get(address);
    if (other) problems.push(`${address} is used by both ${other} and ${port.id}`);
    else seen.set(address, port.id);
  }
  return problems;
}
