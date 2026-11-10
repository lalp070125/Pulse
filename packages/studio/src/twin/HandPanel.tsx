import { PORTS, TABLES } from './bindings';
import { useLocalIo } from './io';
import { useScene } from './sceneStore';

function Lamp({ on }: { on: boolean }) {
  return <span className={`tw-lamp ${on ? 'on' : ''}`} aria-hidden="true" />;
}

/**
 * Hand controls: a switch for every command, a lamp for every sensor.
 * Used until the live machine is connected (Phase 4 and 8); then the logic sets
 * the commands and these switches are only for forcing.
 */
export function HandPanel() {
  const { table, values, setTable, set } = useLocalIo();
  const scene = useScene();
  const commands = PORTS.filter((p) => p.direction === 'command');
  const sensors = PORTS.filter((p) => p.direction === 'sensor');

  return (
    <aside className="tw-panel" aria-label="Hand controls">
      <section>
        <h3>Machine</h3>
        <select
          aria-label="Binding table"
          value={table.id}
          onChange={(e) => {
            const next = TABLES.find((t) => t.id === e.target.value);
            if (next) setTable(next);
          }}
        >
          {TABLES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </section>

      <section>
        <h3>Commands</h3>
        {commands.map((p) => (
          <label key={p.id} className="tw-row">
            <input
              type="checkbox"
              checked={values[p.id]}
              onChange={(e) => set(p.id, e.target.checked)}
              data-port={p.id}
            />
            <span className="tw-label">{p.label}</span>
            <code title={table.addresses[p.id]}>{table.addresses[p.id]}</code>
          </label>
        ))}
      </section>

      <section>
        <h3>Sensors</h3>
        {sensors.map((p) => (
          <div
            key={p.id}
            className="tw-row"
            data-port={p.id}
            data-value={values[p.id] ? 'on' : 'off'}
          >
            <Lamp on={values[p.id]} />
            <span className="tw-label">{p.label}</span>
            <code title={table.addresses[p.id]}>{table.addresses[p.id]}</code>
            <span className="tw-state">{values[p.id] ? 'ON' : 'off'}</span>
          </div>
        ))}
      </section>

      <section>
        <h3>Cartons</h3>
        <div className="tw-buttons tw-wrap">
          <button type="button" onClick={() => scene.spawn()}>
            Add carton
          </button>
          <button type="button" onClick={() => scene.spawn('station')}>
            Carton at station
          </button>
          <button type="button" onClick={() => scene.clear()}>
            Remove all
          </button>
        </div>
        <label className="tw-row">
          <input
            type="checkbox"
            checked={scene.autoSpawn}
            onChange={(e) => scene.setAutoSpawn(e.target.checked)}
          />
          <span className="tw-label">Add one every</span>
          <input
            type="number"
            min={1}
            step={1}
            value={scene.periodS}
            onChange={(e) => scene.setPeriod(Number(e.target.value))}
            aria-label="Seconds between cartons"
            className="tw-num"
          />
          <span>s</span>
        </label>
        <div className="tw-readout" data-testid="twin-readout">
          <span>
            Cartons: <b data-k="boxes">{scene.stats.boxes}</b>
          </span>
          <span>
            Sealed: <b data-k="sealed">{scene.stats.sealed}</b>
          </span>
          <span>
            At sensor, sideways:{' '}
            <b data-k="station-z">
              {scene.stats.stationZ === null ? '-' : `${scene.stats.stationZ} m`}
            </b>
          </span>
        </div>
      </section>

      <section>
        <h3>Travel time</h3>
        <label className="tw-row">
          <span className="tw-label">Pusher</span>
          <input
            type="number"
            min={50}
            step={50}
            value={scene.pusherTravelMs}
            onChange={(e) => scene.setPusherTravel(Number(e.target.value))}
            aria-label="Pusher travel time in milliseconds"
            className="tw-num"
          />
          <span>ms</span>
        </label>
        <label className="tw-row">
          <span className="tw-label">Seal head</span>
          <input
            type="number"
            min={50}
            step={50}
            value={scene.sealTravelMs}
            onChange={(e) => scene.setSealTravel(Number(e.target.value))}
            aria-label="Seal head travel time in milliseconds"
            className="tw-num"
          />
          <span>ms</span>
        </label>
      </section>
    </aside>
  );
}
