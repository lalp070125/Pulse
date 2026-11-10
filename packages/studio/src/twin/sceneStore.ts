import { create } from 'zustand';
import { PUSHER, SEAL } from './layout';

export interface BoxItem {
  id: number;
  sealed: boolean;
  /** Where it appears: at the start of the belt, or already resting at the work station. */
  at: 'infeed' | 'station';
}

/** What the readout shows (rounded, updated a few times a second at most). */
export interface Stats {
  boxes: number;
  sealed: number;
  /** Sideways position (z, metres, rounded to 1 cm) of the box nearest the sensor, or null. */
  stationZ: number | null;
}

interface SceneState {
  boxes: BoxItem[];
  nextId: number;
  autoSpawn: boolean;
  periodS: number;
  pusherTravelMs: number;
  sealTravelMs: number;
  /** Bumped by "Reset view" so the camera goes back to its starting place. */
  viewKey: number;
  ortho: boolean;
  stats: Stats;
  spawn(at?: BoxItem['at']): void;
  remove(id: number): void;
  markSealed(id: number): void;
  clear(): void;
  setAutoSpawn(on: boolean): void;
  setPeriod(s: number): void;
  setPusherTravel(ms: number): void;
  setSealTravel(ms: number): void;
  resetView(): void;
  toggleOrtho(): void;
  setStats(stats: Stats): void;
}

export const useScene = create<SceneState>((set) => ({
  boxes: [],
  nextId: 1,
  autoSpawn: false,
  periodS: 5,
  pusherTravelMs: PUSHER.travelMs,
  sealTravelMs: SEAL.travelMs,
  viewKey: 0,
  ortho: false,
  stats: { boxes: 0, sealed: 0, stationZ: null },
  spawn: (at = 'infeed') =>
    set((s) => ({
      boxes: [...s.boxes, { id: s.nextId, sealed: false, at }],
      nextId: s.nextId + 1,
    })),
  remove: (id) => set((s) => ({ boxes: s.boxes.filter((b) => b.id !== id) })),
  markSealed: (id) =>
    set((s) => ({ boxes: s.boxes.map((b) => (b.id === id ? { ...b, sealed: true } : b)) })),
  clear: () => set({ boxes: [] }),
  setAutoSpawn: (autoSpawn) => set({ autoSpawn }),
  setPeriod: (periodS) => set({ periodS: Math.max(1, periodS) }),
  setPusherTravel: (ms) => set({ pusherTravelMs: Math.max(50, ms) }),
  setSealTravel: (ms) => set({ sealTravelMs: Math.max(50, ms) }),
  resetView: () => set((s) => ({ viewKey: s.viewKey + 1 })),
  toggleOrtho: () => set((s) => ({ ortho: !s.ortho, viewKey: s.viewKey + 1 })),
  setStats: (stats) =>
    set((s) =>
      s.stats.boxes === stats.boxes &&
      s.stats.sealed === stats.sealed &&
      s.stats.stationZ === stats.stationZ
        ? s
        : { stats },
    ),
}));
