import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { Box, Maximize, RotateCcw, Square } from 'lucide-react';
import { readTwinColors } from './colors';
import { createMemoryTwinIO, type MemoryTwinIO } from './io';
import { BOX, SEALER_BINDINGS, SEALER_STATION, SPAWN_AT, SPAWN_PERIOD_MS } from './sealer';
import { Scene, type FeederSettings } from './Scene';
import { portsOf, type Binding, type Station } from './station';
import './twin.css';

/* ----------------------------------------------------------------------------
 * The station view: the 3D scene with its view buttons, and beside it the
 * Manual control panel, which plays the logic's part through an in-memory
 * TwinIO until the runtime connection exists (docs/parallel-twin-plan.md §2).
 *
 * Labels were chosen by the owner on 2026-11-10 (Fit view, Flat view, Manual
 * control, Box feeder, Reset scene).
 * -------------------------------------------------------------------------- */

const BOX_SIZE_CM = { min: 20, max: 40, start: Math.round(BOX[0] * 100) };

export default function TwinStation() {
  const station = SEALER_STATION;
  const bindings = SEALER_BINDINGS;
  const io = useMemo(() => createMemoryTwinIO(), []);
  const colors = useMemo(() => readTwinColors(), []);
  const [flat, setFlat] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [run, setRun] = useState(0); // grows on Reset scene: rebuilds the physics world
  const [boxCount, setBoxCount] = useState(0);
  const [feeder, setFeeder] = useState<FeederSettings>({
    on: false,
    periodMs: SPAWN_PERIOD_MS,
    size: BOX_SIZE_CM.start / 100,
  });

  const reset = useCallback(() => {
    io.clear();
    setFeeder((f) => ({ ...f, on: false }));
    setRun((n) => n + 1);
  }, [io]);

  return (
    <div className="twin" data-testid="twin-station">
      <div className="twin-view">
        <div className="twin-toolbar">
          <button
            type="button"
            className="twin-btn"
            data-testid="twin-fit"
            title="Fit the whole station in view"
            onClick={() => setFitRequest((n) => n + 1)}
          >
            <Maximize size={14} strokeWidth={1.5} /> Fit view
          </button>
          <button
            type="button"
            className={`twin-btn${flat ? ' on' : ''}`}
            data-testid="twin-flat"
            aria-pressed={flat}
            title="Switch between a 3D view and a flat view without perspective"
            onClick={() => setFlat((v) => !v)}
          >
            {flat ? <Square size={14} strokeWidth={1.5} /> : <Box size={14} strokeWidth={1.5} />}{' '}
            Flat view
          </button>
          <span className="twin-toolbar-gap" />
          <button
            type="button"
            className="twin-btn"
            data-testid="twin-reset"
            title="Remove every box, switch every command off and put the moving parts home"
            onClick={reset}
          >
            <RotateCcw size={14} strokeWidth={1.5} /> Reset scene
          </button>
        </div>
        <div className="twin-canvas">
          <Scene
            key={run}
            station={station}
            bindings={bindings}
            io={io}
            colors={colors}
            feeder={feeder}
            spawnAt={SPAWN_AT}
            boxHeight={BOX[1]}
            flat={flat}
            fitRequest={fitRequest}
            onBoxCount={setBoxCount}
          />
        </div>
      </div>
      <ManualControl
        station={station}
        bindings={bindings}
        io={io}
        feeder={feeder}
        setFeeder={setFeeder}
        boxCount={boxCount}
      />
    </div>
  );
}

function ManualControl({
  station,
  bindings,
  io,
  feeder,
  setFeeder,
  boxCount,
}: {
  station: Station;
  bindings: Binding[];
  io: MemoryTwinIO;
  feeder: FeederSettings;
  setFeeder: (f: (old: FeederSettings) => FeederSettings) => void;
  boxCount: number;
}) {
  useSyncExternalStore(io.subscribe, io.version);
  const direction = useMemo(
    () => new Map(portsOf(station).map((p) => [p.port, p.direction])),
    [station],
  );
  const commands = bindings.filter((b) => direction.get(b.port) === 'command');
  const sensors = bindings.filter((b) => direction.get(b.port) === 'sensor');

  return (
    <aside className="twin-panel" data-testid="twin-manual">
      <div className="twin-panel-head">Manual control</div>
      <div className="twin-note">
        Plays the logic's part by hand until the runtime drives the scene.
      </div>

      <div className="twin-section" title="Written by the logic. Here you set them by hand.">
        Commands
      </div>
      {commands.map((b) => {
        const on = io.get(b.path) === true;
        return (
          <label key={b.port} className="twin-row">
            <button
              type="button"
              role="switch"
              aria-checked={on}
              className={`twin-switch${on ? ' on' : ''}`}
              data-testid={`twin-cmd-${b.path}`}
              onClick={() => io.command(b.path, !on)}
            />
            <span className="twin-path">{b.path}</span>
            <span className="twin-state">{on ? 'on' : 'off'}</span>
          </label>
        );
      })}

      <div className="twin-section" title="Read by the logic. The scene sets them.">
        Sensors
      </div>
      {sensors.map((b) => {
        const on = io.get(b.path) === true;
        return (
          <div
            key={b.port}
            className="twin-row"
            data-testid={`twin-sensor-${b.path}`}
            data-on={on ? 'true' : 'false'}
          >
            <span className={`twin-lamp${on ? ' on' : ''}`} />
            <span className="twin-path">{b.path}</span>
            <span className="twin-state">{on ? 'on' : 'off'}</span>
          </div>
        );
      })}

      <div className="twin-section">Box feeder</div>
      <label className="twin-row">
        <button
          type="button"
          role="switch"
          aria-checked={feeder.on}
          className={`twin-switch${feeder.on ? ' on' : ''}`}
          data-testid="twin-feeder-on"
          onClick={() => setFeeder((f) => ({ ...f, on: !f.on }))}
        />
        <span className="twin-label">On</span>
        <span className="twin-state">{feeder.on ? 'on' : 'off'}</span>
      </label>
      <label className="twin-row">
        <span className="twin-label">Every (s)</span>
        <input
          className="twin-input"
          type="number"
          min={1}
          max={60}
          step={0.5}
          data-testid="twin-feeder-every"
          value={feeder.periodMs / 1000}
          onChange={(e) => {
            const s = Number(e.target.value);
            if (s >= 1 && s <= 60) setFeeder((f) => ({ ...f, periodMs: s * 1000 }));
          }}
        />
      </label>
      <label className="twin-row" title="Width and length of each new box. Height stays 24 cm.">
        <span className="twin-label">Box size (cm)</span>
        <input
          className="twin-input"
          type="number"
          min={BOX_SIZE_CM.min}
          max={BOX_SIZE_CM.max}
          step={1}
          data-testid="twin-feeder-size"
          value={Math.round(feeder.size * 100)}
          onChange={(e) => {
            const cm = Number(e.target.value);
            if (cm >= BOX_SIZE_CM.min && cm <= BOX_SIZE_CM.max)
              setFeeder((f) => ({ ...f, size: cm / 100 }));
          }}
        />
      </label>
      <div className="twin-row">
        <span className="twin-label">Boxes in the scene</span>
        <span className="twin-state" data-testid="twin-box-count">
          {boxCount}
        </span>
      </div>
    </aside>
  );
}
