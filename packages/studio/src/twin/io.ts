import { create } from 'zustand';
import { BOX_CLOSING_TABLE, PORTS, type BindingTable, type PortId } from './bindings';

/**
 * The only door between the scene and the machine logic.
 * - `read(port)`: a command value the logic wants (logic to scene).
 * - `write(port, value)`: a sensor reading the scene publishes (scene to logic).
 * The scene never sees addresses; the binding table turns ports into addresses.
 */
export interface TwinIO {
  read(port: PortId): boolean;
  write(port: PortId, value: boolean): void;
}

interface LocalIoState {
  table: BindingTable;
  /** Current value of every port. */
  values: Record<PortId, boolean>;
  setTable(table: BindingTable): void;
  set(port: PortId, value: boolean): void;
}

const blank = (): Record<PortId, boolean> =>
  Object.fromEntries(PORTS.map((p) => [p.id, false])) as Record<PortId, boolean>;

/**
 * Local stand-in used before the Runtime exists: the hand panel sets commands,
 * the scene sets sensors. The live version (Phase 4 and 8) replaces this store
 * with one that talks to the running machine; the scene code does not change.
 */
export const useLocalIo = create<LocalIoState>((set) => ({
  table: BOX_CLOSING_TABLE,
  values: blank(),
  setTable: (table) => set({ table }),
  set: (port, value) =>
    set((s) => (s.values[port] === value ? s : { values: { ...s.values, [port]: value } })),
}));

export const localIo: TwinIO = {
  read: (port) => useLocalIo.getState().values[port],
  write: (port, value) => useLocalIo.getState().set(port, value),
};
