import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  GizmoHelper,
  GizmoViewport,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import {
  CuboidCollider,
  Physics,
  RigidBody,
  useBeforePhysicsStep,
  type RapierCollider,
  type RapierRigidBody,
} from '@react-three/rapier';
import type { TwinColors } from './colors';
import type { MemoryTwinIO } from './io';
import { lerp3, SPAWNER_START, stepSpawner } from './motion';
import {
  initialState,
  pathsByPort,
  readPort,
  stationBounds,
  stepStation,
  type Binding,
  type Part,
  type Station,
  type Vec3,
} from './station';

/* ----------------------------------------------------------------------------
 * The 3D scene: a station built from primitives, run by Rapier physics.
 *
 *  - Boxes are dynamic bodies. A running conveyor carries what rests on it.
 *  - Actuators are solid kinematic plates that move between two ends in their
 *    travel time (motion.ts); they shove whatever is in the way.
 *  - A presence beam is a sensor collider; it reports a box inside it.
 *  - Commands come from the TwinIO, sensor readings go back to it (station.ts).
 * -------------------------------------------------------------------------- */

export interface FeederSettings {
  on: boolean;
  periodMs: number;
  /** Width and length of each new box, in metres. */
  size: number;
}

export interface SceneProps {
  station: Station;
  bindings: Binding[];
  io: MemoryTwinIO;
  colors: TwinColors;
  feeder: FeederSettings;
  /** Where boxes appear and how tall they are. */
  spawnAt: Vec3;
  boxHeight: number;
  flat: boolean;
  /** Grows by one each time the Fit view button is pressed. */
  fitRequest: number;
  onBoxCount: (n: number) => void;
}

interface BoxSpec {
  id: number;
  at: Vec3;
  size: Vec3;
}

const MAX_BOXES = 40;
const ISO_DIR = new THREE.Vector3(1.1, 0.9, 1.4).normalize();

/** Read by the browser tests: where things are right now. */
export interface TwinProbe {
  boxes(): { x: number; y: number; z: number }[];
  part(id: string): { x: number; y: number; z: number } | null;
  camera(): { kind: string; x: number; y: number; z: number; zoom: number };
}
declare global {
  interface Window {
    __pulsoTwin?: Partial<TwinProbe>;
  }
}
/** Each part of the scene fills in its own fields; Scene puts it on window. */
const probe: Partial<TwinProbe> = {};

export function Scene(props: SceneProps) {
  const { colors, flat } = props;
  useEffect(() => {
    window.__pulsoTwin = probe;
    return () => {
      if (window.__pulsoTwin === probe) delete window.__pulsoTwin;
    };
  }, []);
  return (
    <Canvas shadows dpr={[1, 2]} data-testid="twin-canvas" style={{ background: colors.sky }}>
      {flat ? (
        <OrthographicCamera makeDefault near={0.05} far={100} position={[5, 4, 6]} zoom={150} />
      ) : (
        <PerspectiveCamera makeDefault fov={45} near={0.05} far={100} position={[5, 4, 6]} />
      )}
      <ambientLight intensity={0.55} />
      <hemisphereLight args={[colors.steel, colors.floor, 0.5]} />
      <directionalLight
        castShadow
        position={[4, 7, 3]}
        intensity={1.6}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
      />
      <OrbitControls
        makeDefault
        enableDamping={false}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
      <ViewFitter station={props.station} flat={flat} fitRequest={props.fitRequest} />
      <GizmoHelper alignment="top-left" margin={[56, 56]}>
        <GizmoViewport
          axisColors={[colors['beam-blocked'], colors.pusher, colors['beam-clear']]}
          labelColor={colors.sky}
        />
      </GizmoHelper>
      <Suspense fallback={null}>
        <Physics timeStep={1 / 60}>
          <World {...props} />
        </Physics>
      </Suspense>
    </Canvas>
  );
}

/* ---------------- Camera: Fit view and Flat view ---------------- */

function ViewFitter({
  station,
  flat,
  fitRequest,
}: {
  station: Station;
  flat: boolean;
  fitRequest: number;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as {
    target: THREE.Vector3;
    update(): void;
  } | null;
  const size = useThree((s) => s.size);
  const dir = useRef(ISO_DIR.clone());
  const bounds = useMemo(() => stationBounds(station), [station]);

  // Remember the viewing direction, so switching cameras keeps it.
  useFrame(() => {
    if (!controls) return;
    const d = camera.position.clone().sub(controls.target);
    if (d.lengthSq() > 1e-6) dir.current.copy(d.normalize());
  });

  useEffect(() => {
    if (!controls) return;
    const c = new THREE.Vector3(...bounds.center);
    const r = bounds.radius;
    if (camera instanceof THREE.OrthographicCamera) {
      camera.position.copy(c).addScaledVector(dir.current, r * 4);
      camera.zoom = Math.min(size.width, size.height) / (2.1 * r);
    } else if (camera instanceof THREE.PerspectiveCamera) {
      const half = THREE.MathUtils.degToRad(camera.fov / 2);
      const fit = Math.min(half, Math.atan(Math.tan(half) * camera.aspect));
      camera.position.copy(c).addScaledVector(dir.current, (r / Math.sin(fit)) * 1.02);
    }
    camera.updateProjectionMatrix();
    controls.target.copy(c);
    controls.update();
    // Size is left out on purpose: resizing the window must not move the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, controls, bounds, fitRequest, flat]);

  useEffect(() => {
    probe.camera = () => ({
      kind: camera instanceof THREE.OrthographicCamera ? 'flat' : 'perspective',
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      zoom: camera.zoom,
    });
  }, [camera]);
  return null;
}

/* ---------------- The physics world ---------------- */

function World({
  station,
  bindings,
  io,
  colors,
  feeder,
  spawnAt,
  boxHeight,
  onBoxCount,
}: SceneProps) {
  const paths = useMemo(() => pathsByPort(bindings), [bindings]);
  const [boxes, setBoxes] = useState<BoxSpec[]>([]);
  const bodies = useRef(new Map<number, RapierRigidBody>());
  const plates = useRef(new Map<string, RapierRigidBody>());
  const sensors = useRef(new Map<string, RapierCollider>());
  const present = useRef<Record<string, boolean>>({});
  const stationState = useRef(initialState(station));
  const spawner = useRef(SPAWNER_START);
  const nextId = useRef(1);
  const feederRef = useRef(feeder);
  feederRef.current = feeder;

  useEffect(() => onBoxCount(boxes.length), [boxes.length, onBoxCount]);

  useEffect(() => {
    const pos = (b: RapierRigidBody) => {
      const t = b.translation();
      return { x: t.x, y: t.y, z: t.z };
    };
    probe.boxes = () => [...bodies.current.values()].map(pos);
    probe.part = (id) => {
      const b = plates.current.get(id);
      return b ? pos(b) : null;
    };
  }, []);

  useBeforePhysicsStep((world) => {
    const dtMs = world.timestep * 1000;

    // 1. What each beam sees: any box collider inside the sensor.
    const boxHandles = new Set([...bodies.current.values()].map((b) => b.handle));
    for (const [id, sensor] of sensors.current) {
      let hit = false;
      world.intersectionPairsWith(sensor, (other) => {
        const parent = other.parent();
        if (parent && boxHandles.has(parent.handle)) hit = true;
      });
      present.current[id] = hit;
    }

    // 2. Commands in, actuators moved, sensor readings out.
    const state = stepStation(station, paths, io, stationState.current, dtMs, present.current);
    stationState.current = state;
    for (const part of station.parts) {
      if (part.kind !== 'actuator') continue;
      const plate = plates.current.get(part.id);
      const pos = state.actuators[part.id]?.position ?? 0;
      if (plate) {
        const [x, y, z] = lerp3(part.retracted, part.extended, pos);
        plate.setNextKinematicTranslation({ x, y, z });
      }
    }

    // 3. Running conveyors carry the boxes that rest on them.
    for (const part of station.parts) {
      if (part.kind !== 'conveyor' || !readPort(paths, io, `${part.id}.run`)) continue;
      for (const body of bodies.current.values()) {
        const t = body.translation();
        const bottom = t.y - boxHeight / 2;
        const onBelt =
          Math.abs(t.x - part.at[0]) <= part.length / 2 &&
          Math.abs(t.z - part.at[2]) <= part.width / 2 &&
          Math.abs(bottom - part.at[1]) < 0.03;
        if (!onBelt) continue;
        const v = body.linvel();
        body.setLinvel({ x: part.speed, y: v.y, z: v.z }, true);
      }
    }

    // 4. The box feeder, and boxes that fell off the world.
    const f = feederRef.current;
    const step = stepSpawner(spawner.current, f.on, dtMs, f.periodMs);
    spawner.current = step.state;
    const fallen = [...bodies.current.entries()]
      .filter(([, b]) => b.translation().y < -1)
      .map(([id]) => id);
    if (step.due > 0 || fallen.length > 0) {
      const added: BoxSpec[] = [];
      for (let i = 0; i < step.due; i++)
        added.push({ id: nextId.current++, at: spawnAt, size: [f.size, boxHeight, f.size] });
      setBoxes((list) => {
        const kept = list.filter((b) => !fallen.includes(b.id)).concat(added);
        return kept.slice(Math.max(0, kept.length - MAX_BOXES));
      });
    }
  });

  return (
    <>
      <Floor colors={colors} />
      {station.parts.map((part) => (
        <PartView
          key={part.id}
          part={part}
          colors={colors}
          io={io}
          paths={paths}
          present={present}
          plates={plates.current}
          sensors={sensors.current}
        />
      ))}
      {boxes.map((b) => (
        <RigidBody
          key={b.id}
          ref={(body) => {
            if (body) bodies.current.set(b.id, body);
            else bodies.current.delete(b.id);
          }}
          position={[...b.at]}
          colliders={false}
        >
          <CuboidCollider args={[b.size[0] / 2, b.size[1] / 2, b.size[2] / 2]} friction={0.8} />
          <mesh castShadow receiveShadow>
            <boxGeometry args={[...b.size]} />
            <meshStandardMaterial color={colors.box} roughness={0.9} />
          </mesh>
        </RigidBody>
      ))}
    </>
  );
}

function Floor({ colors }: { colors: TwinColors }) {
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider args={[6, 0.05, 6]} position={[0, -0.05, 0]} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[12, 12]} />
        <meshStandardMaterial color={colors.floor} roughness={1} />
      </mesh>
    </RigidBody>
  );
}

/* ---------------- One part of the station ---------------- */

interface PartViewProps {
  part: Part;
  colors: TwinColors;
  io: MemoryTwinIO;
  paths: Map<string, string>;
  present: { current: Record<string, boolean> };
  plates: Map<string, RapierRigidBody>;
  sensors: Map<string, RapierCollider>;
}

function PartView(props: PartViewProps) {
  const { part, colors } = props;
  switch (part.kind) {
    case 'conveyor':
      return <ConveyorView part={part} colors={colors} />;
    case 'block':
      return (
        <RigidBody type="fixed" colliders={false} position={[...part.at]}>
          <CuboidCollider args={[part.size[0] / 2, part.size[1] / 2, part.size[2] / 2]} />
          <SolidBox size={part.size} color={part.look === 'steel' ? colors.steel : colors.frame} />
        </RigidBody>
      );
    case 'actuator':
      return <ActuatorView {...props} part={part} />;
    case 'presence':
      return <PresenceView {...props} part={part} />;
    case 'indicator':
      return <IndicatorView {...props} part={part} />;
  }
}

function SolidBox({ size, color, at }: { size: Vec3; color: string; at?: Vec3 }) {
  return (
    <mesh castShadow receiveShadow position={at ? [...at] : undefined}>
      <boxGeometry args={[...size]} />
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.2} />
    </mesh>
  );
}

function ConveyorView({
  part,
  colors,
}: {
  part: Extract<Part, { kind: 'conveyor' }>;
  colors: TwinColors;
}) {
  const [x, top, z] = part.at;
  const thick = 0.06;
  const legs: Vec3[] = [];
  const legH = top - thick;
  for (const lx of [x - part.length / 2 + 0.1, x, x + part.length / 2 - 0.1])
    for (const lz of [z - part.width / 2 + 0.03, z + part.width / 2 - 0.03])
      legs.push([lx, legH / 2, lz]);
  return (
    <group>
      {/* The belt: a solid surface the boxes rest on. */}
      <RigidBody type="fixed" colliders={false} position={[x, top - thick / 2, z]}>
        <CuboidCollider args={[part.length / 2, thick / 2, part.width / 2]} friction={0.8} />
        <SolidBox size={[part.length, thick, part.width]} color={colors.belt} />
      </RigidBody>
      {/* Side rails just below the belt top, so pushed boxes slide off freely. */}
      {[-1, 1].map((s) => (
        <SolidBox
          key={s}
          at={[x, top - thick / 2 - 0.01, z + s * (part.width / 2 + 0.02)]}
          size={[part.length + 0.04, thick + 0.02, 0.04]}
          color={colors.frame}
        />
      ))}
      {/* Rollers at each end. */}
      {[-1, 1].map((s) => (
        <mesh
          key={`r${s}`}
          castShadow
          position={[x + s * (part.length / 2), top - thick / 2, z]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[thick / 2 + 0.005, thick / 2 + 0.005, part.width, 20]} />
          <meshStandardMaterial color={colors.steel} metalness={0.4} roughness={0.4} />
        </mesh>
      ))}
      {legs.map((at, i) => (
        <SolidBox key={`l${i}`} at={at} size={[0.05, legH, 0.05]} color={colors.frame} />
      ))}
    </group>
  );
}

function ActuatorView({
  part,
  colors,
  plates,
}: PartViewProps & { part: Extract<Part, { kind: 'actuator' }> }) {
  const color = part.look === 'press' ? colors['seal-head'] : colors.pusher;
  const rod = useRef<THREE.Mesh>(null);
  const bodyRef = useRef<RapierRigidBody | null>(null);

  // The cylinder body sits behind the retracted end, on the far side from the stroke.
  const { housing, housingSize } = useMemo(() => {
    const ret = new THREE.Vector3(...part.retracted);
    const d = new THREE.Vector3(...part.extended).sub(ret).normalize();
    const plateHalf =
      Math.abs(d.x) * part.size[0] + Math.abs(d.y) * part.size[1] + Math.abs(d.z) * part.size[2];
    const at = ret.clone().addScaledVector(d, -(plateHalf / 2 + 0.1));
    return { housing: at, housingSize: 0.12 };
  }, [part]);

  // The rod stretches from the cylinder body to the moving plate.
  useFrame(() => {
    const body = bodyRef.current;
    const mesh = rod.current;
    if (!body || !mesh) return;
    const t = body.translation();
    const plate = new THREE.Vector3(t.x, t.y, t.z);
    const mid = plate.clone().add(housing).multiplyScalar(0.5);
    const len = Math.max(0.001, plate.distanceTo(housing));
    mesh.position.copy(mid);
    mesh.scale.set(1, len, 1);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      plate.clone().sub(housing).normalize(),
    );
  });

  return (
    <group>
      <RigidBody
        type="kinematicPosition"
        colliders={false}
        position={[...part.retracted]}
        ref={(b) => {
          bodyRef.current = b;
          if (b) plates.set(part.id, b);
          else plates.delete(part.id);
        }}
      >
        <CuboidCollider
          args={[part.size[0] / 2, part.size[1] / 2, part.size[2] / 2]}
          friction={0.4}
        />
        <SolidBox size={part.size} color={color} />
      </RigidBody>
      <SolidBox
        at={[housing.x, housing.y, housing.z]}
        size={[housingSize, housingSize, housingSize]}
        color={colors.frame}
      />
      <mesh ref={rod} castShadow>
        <cylinderGeometry args={[0.015, 0.015, 1, 12]} />
        <meshStandardMaterial color={colors.steel} metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  );
}

function PresenceView({
  part,
  colors,
  present,
  sensors,
}: PartViewProps & { part: Extract<Part, { kind: 'presence' }> }) {
  const beam = useRef<THREE.MeshStandardMaterial>(null);
  const a = new THREE.Vector3(...part.from);
  const b = new THREE.Vector3(...part.to);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const len = a.distanceTo(b);
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    b.clone().sub(a).normalize(),
  );
  // Axis-aligned sensor volume around the beam, 2 cm thick.
  const half: [number, number, number] = [0, 1, 2].map(
    (i) => Math.abs(part.to[i] - part.from[i]) / 2 + 0.01,
  ) as [number, number, number];
  const clear = useMemo(() => new THREE.Color(colors['beam-clear']), [colors]);
  const blocked = useMemo(() => new THREE.Color(colors['beam-blocked']), [colors]);

  useFrame(() => {
    const m = beam.current;
    if (!m) return;
    const c = present.current[part.id] ? blocked : clear;
    m.color.copy(c);
    m.emissive.copy(c);
  });

  return (
    <group>
      <RigidBody type="fixed" colliders={false} position={[mid.x, mid.y, mid.z]}>
        <CuboidCollider
          sensor
          args={half}
          ref={(c) => {
            if (c) sensors.set(part.id, c);
            else sensors.delete(part.id);
          }}
        />
      </RigidBody>
      <mesh position={mid} quaternion={quat}>
        <cylinderGeometry args={[0.006, 0.006, len, 8]} />
        <meshStandardMaterial ref={beam} emissiveIntensity={1.2} transparent opacity={0.85} />
      </mesh>
      <SolidBox at={part.from} size={[0.06, 0.06, 0.06]} color={colors.frame} />
    </group>
  );
}

function IndicatorView({
  part,
  colors,
  io,
  paths,
}: PartViewProps & { part: Extract<Part, { kind: 'indicator' }> }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const on = useMemo(() => new THREE.Color(colors['lamp-on']), [colors]);
  const off = useMemo(() => new THREE.Color(colors['lamp-off']), [colors]);
  const black = useMemo(() => new THREE.Color(0, 0, 0), []);
  useFrame(() => {
    const m = mat.current;
    if (!m) return;
    const lit = readPort(paths, io, `${part.id}.on`);
    m.color.copy(lit ? on : off);
    m.emissive.copy(lit ? on : black);
  });
  const [x, y, z] = part.at;
  return (
    <group>
      <SolidBox at={[x, (y - 0.06) / 2, z]} size={[0.04, y - 0.06, 0.04]} color={colors.frame} />
      <mesh position={[x, y, z]} castShadow>
        <sphereGeometry args={[0.06, 24, 16]} />
        <meshStandardMaterial ref={mat} emissiveIntensity={1.5} />
      </mesh>
    </group>
  );
}
