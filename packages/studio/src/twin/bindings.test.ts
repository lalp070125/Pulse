import { describe, expect, it } from 'vitest';
import { BOX_CLOSING_TABLE, PORTS, SEALER_SEED_TABLE, TABLES, checkTable } from './bindings';

describe('binding tables', () => {
  it('every shipped table is complete and has no duplicate address', () => {
    for (const table of TABLES) expect(checkTable(table), table.name).toEqual([]);
  });

  it('every table covers every port', () => {
    for (const table of TABLES)
      expect(Object.keys(table.addresses).sort()).toEqual(PORTS.map((p) => p.id).sort());
  });

  it('checkTable reports a missing address and a duplicate', () => {
    const broken = {
      ...BOX_CLOSING_TABLE,
      addresses: {
        ...BOX_CLOSING_TABLE.addresses,
        'pusher.extend': '',
        'pusher.extended': BOX_CLOSING_TABLE.addresses['pusher.retracted'],
      },
    };
    const problems = checkTable(broken);
    expect(problems.some((p) => p.includes('pusher.extend has no address'))).toBe(true);
    expect(problems.some((p) => p.includes('is used by both'))).toBe(true);
  });

  it('the seed table uses the addresses of the seed project', () => {
    expect(SEALER_SEED_TABLE.addresses['pusher.extend']).toBe('Sealer.Pusher.ICylinder.Extend');
    expect(SEALER_SEED_TABLE.addresses['sensor.present']).toBe('Sealer.BoxAtStop.ISensor.Present');
  });

  it('the box machine table follows the design document', () => {
    expect(BOX_CLOSING_TABLE.addresses['sealhead.downPosition']).toBe('SealHead.DownPosition');
    expect(BOX_CLOSING_TABLE.addresses['sensor.present']).toBe('BoxSensor.Detected');
  });

  it('commands and sensors are split as in the design', () => {
    const commands = PORTS.filter((p) => p.direction === 'command').map((p) => p.id);
    expect(commands.sort()).toEqual(
      ['conveyor.run', 'lamp.on', 'pusher.extend', 'sealhead.down'].sort(),
    );
  });
});
