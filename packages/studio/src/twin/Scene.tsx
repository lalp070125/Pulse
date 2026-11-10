import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  GizmoHelper,
  GizmoViewport,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
} from '@react-three/drei';
import { CuboidCollider, Physics, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import type { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { localIo, type TwinIO } from './io';
import { BEAM, BELT, BOX, FENCE, MAX_BOXES, PUSHER, SEAL, SPAWN, STATION } from './layout';
import { actuatorFeedback, beltVelocity, lerp, stepActuator } from './motion';
import { blocksBeam, isGone, onBelt, underSealHead } from './sensing';
import { useScene } from './sceneStore';

/** Reads the Twin colours from tokens.css (3D materials cannot use CSS variables directly). */
function useTokens() {
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const get = (name: string) => style.getPropertyValue(name).trim();
    return {
      floor: get('--tw-floor'),
      belt: get('--tw-belt'),
      slat: get('--tw-belt-slat'),
      frame: get('--tw-frame'),
      fence: get('--tw-fence'),
      box: get('--tw-box'),
      boxSealed: get('--tw-box-sealed'),
      pusher: get('--tw-pusher'),
      sealHead: get('--tw-sealhead'),
      gantry: get('--tw-gantry'),
      beam: get('--tw-beam'),
      beamBlocked: get('--tw-beam-blocked'),
      lampOn: get('--tw-lamp-on'),
      lampOff: get('--tw-lamp-off'),
      sky: get('--tw-sky'),
    };
  }, []);
}
type Tokens = ReturnType<typeof useTokens>;

const BELT_LEN = BELT.x1 - BELT.x0;
const BELT_MID = (BELT.x0 + BELT.x1) / 2;
const SLATS = 33;
const SLAT_GAP = BELT_LEN / SLATS;

function CartonBody({
  id,
  sealed,
  at,
  colors,
  register,
}: {
  id: number;
  sealed: boolean;
  at: 'infeed' | 'station';
  colors: Tokens;
  register: (id: number, body: RapierRigidBody | null) => void;
}) {
  return (
    <RigidBody
      ref={(b) => register(id, b)}
      position={
        at === 'station' ? [STATION.x, BELT.top + BOX.halfH + 0.01, 0] : [SPAWN.x, SPAWN.y, SPAWN.z]
      }
      colliders={false}
      canSleep={false}
      linearDamping={0.05}
      angularDamping={0.6}
    >
      <CuboidCollider args={[BOX.halfL, BOX.halfH, BOX.halfW]} friction={0.7} density={2.5} />
      <mesh castShadow receiveShadow>
        <boxGeometry args={[BOX.halfL * 2, BOX.halfH * 2, BOX.halfW * 2]} />
        <meshStandardMaterial color={sealed ? colors.boxSealed : colors.box} roughness={0.8} />
      </mesh>
      {/* the tape stripe along the top; it is there on every box, the colour shows "sealed" */}
      <mesh position={[0, BOX.halfH + 0.002, 0]}>
        <boxGeometry args={[BOX.halfL * 2, 0.004, 0.04]} />
        <meshStandardMaterial color={sealed ? colors.beamBlocked : colors.fence} roughness={0.5} />
      </mesh>
    </RigidBody>
  );
}

function Machine({ io, colors }: { io: TwinIO; colors: Tokens }) {
  const boxes = useScene((s) => s.boxes);
  const pusherBody = useRef<RapierRigidBody>(null);
  const sealBody = useRef<RapierRigidBody>(null);
  const bodies = useRef(new Map<number, RapierRigidBody>());
  const sealedIds = useRef(new Set<number>());
  const pusherPos = useRef(0);
  const sealPos = useRef(0);
  const spawnClock = useRef(0);
  const statsClock = useRef(0);
  const slatOffset = useRef(0);
  const slats = useRef<Group>(null);
  const beamMat = useRef<MeshBasicMaterial>(null);
  const lampMat = useRef<MeshStandardMaterial>(null);
  const beamMesh = useRef<Mesh>(null);

  const register = useCallback((id: number, body: RapierRigidBody | null) => {
    if (body) bodies.current.set(id, body);
    else bodies.current.delete(id);
  }, []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const dtMs = dt * 1000;
    const scene = useScene.getState();

    // --- actuators: move toward their commands, publish their feedback ---
    pusherPos.current = stepActuator(
      pusherPos.current,
      io.read('pusher.extend'),
      dtMs,
      scene.pusherTravelMs,
    );
    sealPos.current = stepActuator(
      sealPos.current,
      io.read('sealhead.down'),
      dtMs,
      scene.sealTravelMs,
    );
    const pusherZ = lerp(
      PUSHER.retractedFace + PUSHER.thickness / 2,
      PUSHER.extendedFace + PUSHER.thickness / 2,
      pusherPos.current,
    );
    pusherBody.current?.setNextKinematicTranslation({ x: STATION.x, y: PUSHER.y, z: pusherZ });
    sealBody.current?.setNextKinematicTranslation({
      x: STATION.x,
      y: lerp(SEAL.upY, SEAL.downY, sealPos.current),
      z: SEAL.z,
    });
    const pusherFb = actuatorFeedback(pusherPos.current);
    const sealFb = actuatorFeedback(sealPos.current);
    io.write('pusher.extended', pusherFb.extended);
    io.write('pusher.retracted', pusherFb.retracted);
    io.write('sealhead.downPosition', sealFb.extended);
    io.write('sealhead.upPosition', sealFb.retracted);

    // --- belt: carries every box standing on it, and stops them the moment it stops ---
    const running = io.read('conveyor.run');
    io.write('conveyor.running', running);
    const beltSpeed = beltVelocity(running, BELT.speed);
    let present = false;
    let sealedCount = 0;
    let stationZ: number | null = null;
    for (const [id, body] of bodies.current) {
      const t = body.translation();
      if (isGone(t)) {
        scene.remove(id);
        sealedIds.current.delete(id);
        continue;
      }
      if (onBelt(t)) {
        const v = body.linvel();
        body.setLinvel({ x: beltSpeed, y: v.y, z: v.z }, true);
      }
      if (blocksBeam(t, BEAM.x, BEAM.y)) {
        present = true;
        stationZ = Math.round(t.z * 100) / 100;
      }
      if (sealFb.extended && underSealHead(t) && !sealedIds.current.has(id)) {
        sealedIds.current.add(id);
        scene.markSealed(id);
      }
      if (sealedIds.current.has(id)) sealedCount += 1;
    }
    io.write('sensor.present', present);

    // --- box spawner ---
    if (scene.autoSpawn) {
      spawnClock.current += dt;
      if (spawnClock.current >= scene.periodS) {
        spawnClock.current = 0;
        if (bodies.current.size < MAX_BOXES) scene.spawn();
      }
    } else spawnClock.current = 0;

    // --- belt slats scroll while running (a picture of the motion, nothing more) ---
    slatOffset.current = (slatOffset.current + beltSpeed * dt) % BELT_LEN;
    slats.current?.children.forEach((slat, i) => {
      slat.position.x = BELT.x0 + ((i * SLAT_GAP + slatOffset.current) % BELT_LEN);
    });

    // --- indicators ---
    if (beamMat.current) beamMat.current.color.set(present ? colors.beamBlocked : colors.beam);
    if (lampMat.current) {
      const on = io.read('lamp.on');
      lampMat.current.color.set(on ? colors.lampOn : colors.lampOff);
      lampMat.current.emissive.set(on ? colors.lampOn : '#000000');
      lampMat.current.emissiveIntensity = on ? 1.6 : 0;
    }
    if (beamMesh.current) beamMesh.current.visible = true;

    // --- readout (a few times a second) ---
    const now = state.clock.elapsedTime;
    if (now - statsClock.current >= 0.2) {
      statsClock.current = now;
      scene.setStats({ boxes: bodies.current.size, sealed: sealedCount, stationZ });
    }
  });

  const frameY = BELT.top - 0.4;
  return (
    <>
      {/* ----- floor, belt and station: solid and fixed ----- */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[8, 0.05, 8]} position={[0, -0.05, 0]} friction={0.8} />
        <CuboidCollider
          args={[BELT_LEN / 2, 0.03, BELT.halfZ]}
          position={[BELT_MID, BELT.top - 0.03, 0]}
          friction={0.6}
        />
        <CuboidCollider
          args={[FENCE.halfX, FENCE.halfY, FENCE.halfZ]}
          position={[STATION.x - 0.03, BELT.top + 0.1, FENCE.z]}
          friction={0.3}
        />
      </RigidBody>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[16, 16]} />
        <meshStandardMaterial color={colors.floor} roughness={1} />
      </mesh>

      {/* belt surface, side rails, slats, legs */}
      <mesh position={[BELT_MID, BELT.top - 0.03, 0]} receiveShadow>
        <boxGeometry args={[BELT_LEN, 0.06, BELT.halfZ * 2]} />
        <meshStandardMaterial color={colors.belt} roughness={0.9} />
      </mesh>
      <group ref={slats}>
        {Array.from({ length: SLATS }, (_, i) => (
          <mesh key={i} position={[BELT.x0 + i * SLAT_GAP, BELT.top + 0.003, 0]}>
            <boxGeometry args={[0.03, 0.006, BELT.halfZ * 2 - 0.04]} />
            <meshStandardMaterial color={colors.slat} roughness={0.9} />
          </mesh>
        ))}
      </group>
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[BELT_MID, BELT.top - 0.07, side * (BELT.halfZ + 0.02)]}
          castShadow
        >
          <boxGeometry args={[BELT_LEN + 0.1, 0.1, 0.04]} />
          <meshStandardMaterial color={colors.frame} roughness={0.6} metalness={0.3} />
        </mesh>
      ))}
      {[-1.8, -0.8, 0.2, 1.2].flatMap((x) =>
        [-1, 1].map((side) => (
          <mesh
            key={`${x}-${side}`}
            position={[x, frameY / 2 + 0.2, side * (BELT.halfZ + 0.02)]}
            castShadow
          >
            <boxGeometry args={[0.05, BELT.top - 0.12, 0.05]} />
            <meshStandardMaterial color={colors.frame} roughness={0.6} metalness={0.3} />
          </mesh>
        )),
      )}

      {/* fence the box is clamped against */}
      <mesh position={[STATION.x - 0.03, BELT.top + 0.1, FENCE.z]} castShadow>
        <boxGeometry args={[FENCE.halfX * 2, FENCE.halfY * 2, FENCE.halfZ * 2]} />
        <meshStandardMaterial color={colors.fence} roughness={0.5} metalness={0.4} />
      </mesh>

      {/* ----- pusher: a plate on a rod, in a fixed cylinder body ----- */}
      <mesh position={[STATION.x, PUSHER.y, 0.95]} castShadow rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.3, 24]} />
        <meshStandardMaterial color={colors.gantry} roughness={0.5} metalness={0.5} />
      </mesh>
      <RigidBody
        ref={pusherBody}
        type="kinematicPosition"
        colliders={false}
        position={[STATION.x, PUSHER.y, PUSHER.retractedFace + PUSHER.thickness / 2]}
      >
        <CuboidCollider args={[PUSHER.halfX, PUSHER.halfY, PUSHER.thickness / 2]} friction={0.3} />
        <mesh castShadow>
          <boxGeometry args={[PUSHER.halfX * 2, PUSHER.halfY * 2, PUSHER.thickness]} />
          <meshStandardMaterial color={colors.pusher} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0, 0.45]} castShadow rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.9, 12]} />
          <meshStandardMaterial color={colors.fence} roughness={0.3} metalness={0.7} />
        </mesh>
      </RigidBody>

      {/* ----- seal head: a plate on a rod, hung from a gantry ----- */}
      <mesh position={[STATION.x, BELT.top + 0.7, -0.5]} castShadow>
        <boxGeometry args={[0.08, 1.4, 0.08]} />
        <meshStandardMaterial color={colors.gantry} roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh position={[STATION.x, BELT.top + 1.36, -0.3]} castShadow>
        <boxGeometry args={[0.1, 0.08, 0.5]} />
        <meshStandardMaterial color={colors.gantry} roughness={0.6} metalness={0.4} />
      </mesh>
      <RigidBody
        ref={sealBody}
        type="kinematicPosition"
        colliders={false}
        position={[STATION.x, SEAL.upY, SEAL.z]}
      >
        <CuboidCollider args={[SEAL.halfX, SEAL.halfY, SEAL.halfZ]} friction={0.5} />
        <mesh castShadow>
          <boxGeometry args={[SEAL.halfX * 2, SEAL.halfY * 2, SEAL.halfZ * 2]} />
          <meshStandardMaterial color={colors.sealHead} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.38, 0]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.7, 12]} />
          <meshStandardMaterial color={colors.fence} roughness={0.3} metalness={0.7} />
        </mesh>
      </RigidBody>

      {/* ----- photoelectric sensor: emitter, receiver and the beam between them ----- */}
      {[0.42, -0.42].map((z) => (
        <mesh key={z} position={[BEAM.x, BEAM.y, z]} castShadow>
          <boxGeometry args={[0.05, 0.05, 0.05]} />
          <meshStandardMaterial color={colors.gantry} roughness={0.5} />
        </mesh>
      ))}
      <mesh ref={beamMesh} position={[BEAM.x, BEAM.y, 0]}>
        <boxGeometry args={[0.006, 0.006, 0.8]} />
        <meshBasicMaterial ref={beamMat} color={colors.beam} />
      </mesh>

      {/* ----- indicator lamp on a post ----- */}
      <mesh position={[0.2, BELT.top + 0.25, 0.55]} castShadow>
        <cylinderGeometry args={[0.02, 0.02, 0.5, 12]} />
        <meshStandardMaterial color={colors.gantry} roughness={0.6} />
      </mesh>
      <mesh position={[0.2, BELT.top + 0.55, 0.55]}>
        <sphereGeometry args={[0.06, 24, 16]} />
        <meshStandardMaterial ref={lampMat} color={colors.lampOff} roughness={0.3} />
      </mesh>

      {/* ----- the cartons ----- */}
      {boxes.map((b) => (
        <CartonBody
          key={b.id}
          id={b.id}
          sealed={b.sealed}
          at={b.at}
          colors={colors}
          register={register}
        />
      ))}
    </>
  );
}

/** Camera: perspective by default, flat (orthographic) on request; "Reset view" returns here. */
function CameraRig() {
  const ortho = useScene((s) => s.ortho);
  const viewKey = useScene((s) => s.viewKey);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    camera.position.set(2.6, 2.1, 3.1);
    camera.lookAt(0.2, 0.9, 0);
    camera.updateProjectionMatrix();
  }, [camera, viewKey, ortho]);

  return (
    <>
      <PerspectiveCamera
        makeDefault={!ortho}
        position={[2.6, 2.1, 3.1]}
        fov={45}
        near={0.05}
        far={60}
      />
      <OrthographicCamera
        makeDefault={ortho}
        position={[2.6, 2.1, 3.1]}
        zoom={150}
        near={-20}
        far={60}
      />
      <OrbitControls
        key={`${viewKey}-${ortho}`}
        makeDefault
        target={[0.2, 0.9, 0]}
        enableDamping
        dampingFactor={0.12}
        maxPolarAngle={Math.PI / 2 - 0.02}
        minDistance={0.8}
        maxDistance={12}
      />
    </>
  );
}

export default function Scene({ io = localIo }: { io?: TwinIO }) {
  const colors = useTokens();
  return (
    <Canvas shadows dpr={[1, 2]} data-testid="twin-canvas">
      <color attach="background" args={[colors.sky]} />
      <ambientLight intensity={0.55} />
      <hemisphereLight args={['#ffffff', '#3a4152', 0.5]} />
      <directionalLight
        position={[3, 6, 4]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
        shadow-bias={-0.0005}
      />
      <CameraRig />
      <Physics gravity={[0, -9.81, 0]}>
        <Machine io={io} colors={colors} />
      </Physics>
      <GizmoHelper alignment="top-left" margin={[56, 56]}>
        <GizmoViewport />
      </GizmoHelper>
    </Canvas>
  );
}
