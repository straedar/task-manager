import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import type { MapObject, MapSettings } from "../api";
import {
  buildRackFrame,
  buildRackParts,
} from "../lib/rackGeometry";
import {
  DOOR_HEIGHT_M,
  GRID,
  METERS_PER_GRID,
  PALLET_HEIGHT_M,
  rackPose,
  worldToMeters,
} from "../world";
import { OfficeChairMesh, OfficeDeskMesh } from "./OfficeFurniture3D";

type Props = {
  objects: MapObject[];
  settings: MapSettings;
  selectedId: number | null;
  clipHeightM: number;
  onSelect: (id: number | null) => void;
  onOpenRack?: (id: number) => void;
};

function footprint(obj: MapObject) {
  const w = worldToMeters(obj.width);
  const d = worldToMeters(obj.height);
  const x = worldToMeters(obj.x) + w / 2;
  const z = worldToMeters(obj.y) + d / 2;
  const rotY = -((obj.rotation ?? 0) * Math.PI) / 180;
  return { w, d, x, z, rotY };
}

function sceneBounds(objects: MapObject[]) {
  if (objects.length === 0) {
    return { minX: 0, minZ: 0, maxX: 20, maxZ: 20, spanX: 20, spanZ: 20 };
  }
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const obj of objects) {
    minX = Math.min(minX, worldToMeters(obj.x));
    minZ = Math.min(minZ, worldToMeters(obj.y));
    maxX = Math.max(maxX, worldToMeters(obj.x + obj.width));
    maxZ = Math.max(maxZ, worldToMeters(obj.y + obj.height));
  }
  const pad = METERS_PER_GRID * 4;
  minX -= pad;
  minZ -= pad;
  maxX += pad;
  maxZ += pad;
  return {
    minX,
    minZ,
    maxX,
    maxZ,
    spanX: Math.max(8, maxX - minX),
    spanZ: Math.max(8, maxZ - minZ),
  };
}

const SCENE_BG = "#101412";
const WALL_COLOR = "#efe8dc";
const FLOOR_COLOR = "#d8cfc2";
const PLATFORM_COLOR = "#d5cec3";
const DOOR_COLOR = "#8a5a36";
const GLASS_COLOR = "#9ec9dc";
const SELECT_EMISSIVE = "#c4a574";
const PLATFORM_THICK_M = 0.06;
const PLATFORM_MARGIN_M = 0.35;

/** Wall/window thickness forced to one grid cell in 3D. */
function wallSlabSize(
  w: number,
  d: number,
  height: number,
  thickScale = 1,
): [number, number, number] {
  const cell = worldToMeters(GRID);
  const thick = cell * thickScale;
  if (w >= d) return [Math.max(w, cell), height, thick];
  return [thick, height, Math.max(d, cell)];
}

function clipVertical(
  y0: number,
  y1: number,
  clipHeightM: number,
): { y: number; h: number } | null {
  const top = Math.min(y1, clipHeightM);
  const bot = Math.max(y0, 0);
  if (top - bot <= 0.02) return null;
  return { y: (bot + top) / 2, h: top - bot };
}

function FloorPlane({
  bounds,
  floorUrl,
}: {
  bounds: ReturnType<typeof sceneBounds>;
  floorUrl: string | null;
}) {
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const plateW = bounds.spanX + PLATFORM_MARGIN_M * 2;
  const plateD = bounds.spanZ + PLATFORM_MARGIN_M * 2;
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!floorUrl) {
      setTexture(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    let loaded: THREE.Texture | null = null;

    void (async () => {
      try {
        const res = await fetch(floorUrl, { credentials: "include" });
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        loaded = await new Promise<THREE.Texture>((resolve, reject) => {
          new THREE.TextureLoader().load(objectUrl!, resolve, undefined, reject);
        });
        if (cancelled) {
          loaded.dispose();
          return;
        }
        loaded.colorSpace = THREE.SRGBColorSpace;
        loaded.wrapS = THREE.RepeatWrapping;
        loaded.wrapT = THREE.RepeatWrapping;
        const tilesX = Math.max(1, bounds.spanX / (METERS_PER_GRID * 4));
        const tilesZ = Math.max(1, bounds.spanZ / (METERS_PER_GRID * 4));
        loaded.repeat.set(tilesX, tilesZ);
        loaded.needsUpdate = true;
        setTexture(loaded);
      } catch {
        if (!cancelled) setTexture(null);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      loaded?.dispose();
    };
  }, [floorUrl, bounds.spanX, bounds.spanZ]);

  return (
    <group>
      <mesh position={[cx, -PLATFORM_THICK_M / 2, cz]} receiveShadow>
        <boxGeometry args={[plateW, PLATFORM_THICK_M, plateD]} />
        <meshStandardMaterial
          color={PLATFORM_COLOR}
          roughness={0.88}
          metalness={0.02}
        />
      </mesh>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[cx, 0.001, cz]}
        receiveShadow
      >
        <planeGeometry args={[bounds.spanX, bounds.spanZ]} />
        {texture ? (
          <meshStandardMaterial
            map={texture}
            color="#ffffff"
            roughness={0.9}
            metalness={0.02}
          />
        ) : (
          <meshStandardMaterial
            color={FLOOR_COLOR}
            roughness={0.92}
            metalness={0.02}
          />
        )}
      </mesh>
    </group>
  );
}

function WallMesh({
  obj,
  selected,
  wallHeightM,
  clipHeightM,
  onSelect,
}: {
  obj: MapObject;
  selected: boolean;
  wallHeightM: number;
  clipHeightM: number;
  onSelect: () => void;
}) {
  const { w, d, x, z, rotY } = footprint(obj);
  const band = clipVertical(0, wallHeightM, clipHeightM);
  if (!band) return null;
  return (
    <mesh
      position={[x, band.y, z]}
      rotation={[0, rotY, 0]}
      castShadow
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <boxGeometry args={wallSlabSize(w, d, band.h)} />
      <meshStandardMaterial
        color={WALL_COLOR}
        roughness={0.78}
        metalness={0.02}
        emissive={selected ? SELECT_EMISSIVE : "#000000"}
        emissiveIntensity={selected ? 0.18 : 0}
      />
    </mesh>
  );
}

function WindowMesh({
  obj,
  selected,
  wallHeightM,
  sillM,
  heightM,
  clipHeightM,
  onSelect,
}: {
  obj: MapObject;
  selected: boolean;
  wallHeightM: number;
  sillM: number;
  heightM: number;
  clipHeightM: number;
  onSelect: () => void;
}) {
  const { w, d, x, z, rotY } = footprint(obj);
  const sillTop = Math.min(Math.max(0.05, sillM), wallHeightM * 0.85);
  const glassTop = Math.min(sillTop + Math.max(0.2, heightM), wallHeightM);

  const sill = clipVertical(0, sillTop, clipHeightM);
  const glass = clipVertical(sillTop, glassTop, clipHeightM);
  const head = clipVertical(glassTop, wallHeightM, clipHeightM);

  const onPick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onSelect();
  };

  return (
    <group rotation={[0, rotY, 0]} position={[x, 0, z]}>
      {sill && (
        <mesh position={[0, sill.y, 0]} castShadow receiveShadow onClick={onPick}>
          <boxGeometry args={wallSlabSize(w, d, sill.h)} />
          <meshStandardMaterial
            color={WALL_COLOR}
            roughness={0.78}
            metalness={0.02}
            emissive={selected ? SELECT_EMISSIVE : "#000000"}
            emissiveIntensity={selected ? 0.14 : 0}
          />
        </mesh>
      )}
      {glass && (
        <mesh position={[0, glass.y, 0]} onClick={onPick}>
          <boxGeometry args={wallSlabSize(w, d, glass.h, 0.55)} />
          <meshStandardMaterial
            color={selected ? "#d7f3ff" : GLASS_COLOR}
            transparent
            opacity={0.32}
            roughness={0.08}
            metalness={0.15}
            emissive={selected ? SELECT_EMISSIVE : "#000000"}
            emissiveIntensity={selected ? 0.12 : 0}
          />
        </mesh>
      )}
      {head && (
        <mesh position={[0, head.y, 0]} castShadow receiveShadow onClick={onPick}>
          <boxGeometry args={wallSlabSize(w, d, head.h)} />
          <meshStandardMaterial
            color={WALL_COLOR}
            roughness={0.78}
            metalness={0.02}
            emissive={selected ? SELECT_EMISSIVE : "#000000"}
            emissiveIntensity={selected ? 0.14 : 0}
          />
        </mesh>
      )}
    </group>
  );
}

function DoorMesh({
  obj,
  selected,
  wallHeightM,
  clipHeightM,
  onSelect,
}: {
  obj: MapObject;
  selected: boolean;
  wallHeightM: number;
  clipHeightM: number;
  onSelect: () => void;
}) {
  const { w, d, x, z, rotY } = footprint(obj);
  const doorH = Math.min(DOOR_HEIGHT_M, wallHeightM * 0.85);
  const leaf = clipVertical(0, doorH, clipHeightM);
  const lintel = clipVertical(doorH, wallHeightM, clipHeightM);
  const onPick = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onSelect();
  };

  return (
    <group rotation={[0, rotY, 0]} position={[x, 0, z]}>
      {leaf && (
        <mesh position={[0, leaf.y, 0]} castShadow receiveShadow onClick={onPick}>
          <boxGeometry args={wallSlabSize(w, d, leaf.h, 0.45)} />
          <meshStandardMaterial
            color={DOOR_COLOR}
            roughness={0.55}
            metalness={0.05}
            emissive={selected ? SELECT_EMISSIVE : "#000000"}
            emissiveIntensity={selected ? 0.16 : 0}
          />
        </mesh>
      )}
      {lintel && (
        <mesh position={[0, lintel.y, 0]} castShadow receiveShadow onClick={onPick}>
          <boxGeometry args={wallSlabSize(w, d, lintel.h)} />
          <meshStandardMaterial
            color={WALL_COLOR}
            roughness={0.78}
            metalness={0.02}
            emissive={selected ? SELECT_EMISSIVE : "#000000"}
            emissiveIntensity={selected ? 0.14 : 0}
          />
        </mesh>
      )}
    </group>
  );
}

function rackPartMaterials(theme: MapObject["rackTheme"]) {
  const upright =
    theme === "black"
      ? { color: "#2a2e34", roughness: 0.48, metalness: 0.32 }
      : { color: "#2f5fbf", roughness: 0.42, metalness: 0.28 };
  return {
    rackUpright: upright,
    rackBeam: { color: "#e07a2f", roughness: 0.45, metalness: 0.22 },
    rackDeck: { color: "#c5ccd3", roughness: 0.28, metalness: 0.55 },
  } as const;
}

function RackMesh({
  obj,
  selected,
  rackHeightM,
  onSelect,
  onOpen,
}: {
  obj: MapObject;
  selected: boolean;
  rackHeightM: number;
  onSelect: () => void;
  onOpen?: () => void;
}) {
  const { x, z } = footprint(obj);
  const pose = useMemo(() => rackPose(obj), [obj.width, obj.height, obj.rotation]);
  const frame = useMemo(
    () =>
      buildRackFrame(pose.alongM, pose.deepM, obj.shelvesCount ?? 5, rackHeightM),
    [pose.alongM, pose.deepM, obj.shelvesCount, rackHeightM],
  );
  const parts = useMemo(() => buildRackParts(frame), [frame]);
  const partMats = useMemo(
    () => rackPartMaterials(obj.rackTheme),
    [obj.rackTheme],
  );

  return (
    <group
      position={[x, 0, z]}
      rotation={[0, pose.rotY, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpen?.();
      }}
    >
      {parts.map((part, i) => {
        const mat = partMats[part.role];
        return (
          <mesh
            key={i}
            position={part.position}
            rotation={[part.rotationX ?? 0, 0, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={part.size} />
            <meshStandardMaterial
              color={mat.color}
              roughness={mat.roughness}
              metalness={mat.metalness}
              emissive={selected ? SELECT_EMISSIVE : "#000000"}
              emissiveIntensity={selected ? 0.14 : 0}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function SimpleBox({
  obj,
  height,
  color,
  selected,
  onSelect,
}: {
  obj: MapObject;
  height: number;
  color: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { w, d, x, z, rotY } = footprint(obj);
  return (
    <mesh
      position={[x, height / 2, z]}
      rotation={[0, rotY, 0]}
      castShadow
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <boxGeometry args={[Math.max(w, 0.05), height, Math.max(d, 0.05)]} />
      <meshStandardMaterial
        color={color}
        roughness={0.72}
        metalness={0.04}
        emissive={selected ? SELECT_EMISSIVE : "#000000"}
        emissiveIntensity={selected ? 0.14 : 0}
      />
    </mesh>
  );
}

function ZoneMesh({
  obj,
  selected,
  onSelect,
}: {
  obj: MapObject;
  selected: boolean;
  onSelect: () => void;
}) {
  const { w, d, x, z, rotY } = footprint(obj);
  return (
    <mesh
      position={[x, 0.012, z]}
      rotation={[-Math.PI / 2, 0, rotY]}
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <planeGeometry args={[w, d]} />
      <meshStandardMaterial
        color="#eab308"
        transparent
        opacity={0.38}
        roughness={0.85}
        emissive={selected ? SELECT_EMISSIVE : "#000000"}
        emissiveIntensity={selected ? 0.12 : 0}
      />
    </mesh>
  );
}

function ObjectMesh({
  obj,
  selected,
  settings,
  clipHeightM,
  onSelect,
  onOpen,
}: {
  obj: MapObject;
  selected: boolean;
  settings: MapSettings;
  clipHeightM: number;
  onSelect: () => void;
  onOpen?: () => void;
}) {
  switch (obj.type) {
    case "wall":
      return (
        <WallMesh
          obj={obj}
          selected={selected}
          wallHeightM={settings.wallHeightM}
          clipHeightM={clipHeightM}
          onSelect={onSelect}
        />
      );
    case "window":
      return (
        <WindowMesh
          obj={obj}
          selected={selected}
          wallHeightM={settings.wallHeightM}
          sillM={settings.windowSillM}
          heightM={settings.windowHeightM}
          clipHeightM={clipHeightM}
          onSelect={onSelect}
        />
      );
    case "door":
      return (
        <DoorMesh
          obj={obj}
          selected={selected}
          wallHeightM={settings.wallHeightM}
          clipHeightM={clipHeightM}
          onSelect={onSelect}
        />
      );
    case "rack":
      return (
        <RackMesh
          obj={obj}
          selected={selected}
          rackHeightM={settings.rackHeightM}
          onSelect={onSelect}
          onOpen={onOpen}
        />
      );
    case "pallet":
      return (
        <SimpleBox
          obj={obj}
          height={PALLET_HEIGHT_M}
          color="#b8956a"
          selected={selected}
          onSelect={onSelect}
        />
      );
    case "table":
      return (
        <OfficeDeskMesh obj={obj} selected={selected} onSelect={onSelect} />
      );
    case "chair":
      return (
        <OfficeChairMesh obj={obj} selected={selected} onSelect={onSelect} />
      );
    case "zone":
      return <ZoneMesh obj={obj} selected={selected} onSelect={onSelect} />;
    default:
      return null;
  }
}

/**
 * Стартовый ракурс: высокий косой вид сверху (~45–55°),
 * вся площадка в кадре с небольшим запасом по краям.
 */
function DefaultWarehouseCamera({
  cx,
  cz,
  spanX,
  spanZ,
}: {
  cx: number;
  cz: number;
  spanX: number;
  spanZ: number;
}) {
  const { camera } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const applied = useRef(false);
  const span = Math.max(spanX, spanZ, 1);
  const targetY = 0.15;

  useLayoutEffect(() => {
    // Один раз при входе в 3Д (компонент монтируется заново)
    if (applied.current) return;
    applied.current = true;

    const horizontal = span * 0.92;
    const height = span * 0.86;
    const cam = camera as THREE.PerspectiveCamera;
    cam.position.set(
      cx + horizontal * 0.38,
      height,
      cz + horizontal * 0.78,
    );
    cam.fov = 38;
    cam.near = Math.max(0.08, span * 0.002);
    cam.far = Math.max(400, span * 60);
    cam.up.set(0, 1, 0);
    cam.lookAt(cx, targetY, cz);
    cam.updateProjectionMatrix();

    const syncControls = () => {
      const ctrl = controlsRef.current;
      if (!ctrl) return false;
      ctrl.target.set(cx, targetY, cz);
      ctrl.update();
      return true;
    };
    if (!syncControls()) {
      requestAnimationFrame(() => {
        if (!syncControls()) requestAnimationFrame(syncControls);
      });
    }
  }, [camera, cx, cz, span]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={[cx, targetY, cz]}
      maxPolarAngle={Math.PI / 2.05}
      minPolarAngle={0.18}
      minDistance={span * 0.12}
      maxDistance={span * 6}
      enableDamping
      dampingFactor={0.08}
    />
  );
}

export function WarehouseViewer3D({
  objects,
  settings,
  selectedId,
  clipHeightM,
  onSelect,
  onOpenRack,
}: Props) {
  const bounds = useMemo(() => sceneBounds(objects), [objects]);

  const nonClip = objects.filter((o) => o.type !== "wall" && o.type !== "window");
  const clipOnly = objects.filter((o) => o.type === "wall" || o.type === "window");
  const span = Math.max(bounds.spanX, bounds.spanZ);
  const lightReach = span * 2.2;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const wallH = settings.wallHeightM;
  const camH = Math.max(span * 0.86, wallH * 2.5);
  const camDist = span * 0.92;

  return (
    <div className="viewer-3d">
      <Canvas
        shadows={{ type: THREE.PCFSoftShadowMap }}
        dpr={typeof window !== "undefined" && window.innerWidth < 900 ? [1, 1.5] : [1, 2]}
        gl={{ antialias: true }}
        camera={{
          position: [
            cx + camDist * 0.38,
            camH,
            cz + camDist * 0.78,
          ],
          fov: 38,
          near: Math.max(0.08, span * 0.002),
          far: Math.max(400, span * 60),
        }}
        onPointerMissed={() => onSelect(null)}
      >
        <color attach="background" args={[SCENE_BG]} />
        <fog attach="fog" args={[SCENE_BG, span * 4.5, span * 14]} />
        <hemisphereLight args={["#efe8dc", "#2a332e", 1.05]} />
        <directionalLight
          castShadow
          intensity={1.25}
          position={[cx + span * 0.85, Math.max(span, wallH * 3), cz + span * 0.65]}
          shadow-mapSize={
            typeof window !== "undefined" && window.innerWidth < 900
              ? [1024, 1024]
              : [2048, 2048]
          }
          shadow-bias={-0.00015}
          shadow-normalBias={0.012}
          shadow-camera-near={0.05}
          shadow-camera-far={lightReach}
          shadow-camera-left={-span * 1.15}
          shadow-camera-right={span * 1.15}
          shadow-camera-top={span * 1.15}
          shadow-camera-bottom={-span * 1.15}
        />
        <FloorPlane bounds={bounds} floorUrl={settings.floorUrl} />

        <group>
          {nonClip.map((obj) => (
            <ObjectMesh
              key={obj.id}
              obj={obj}
              selected={selectedId === obj.id}
              settings={settings}
              clipHeightM={1e9}
              onSelect={() => onSelect(obj.id)}
              onOpen={
                obj.type === "rack" ? () => onOpenRack?.(obj.id) : undefined
              }
            />
          ))}
        </group>

        <group>
          {clipOnly.map((obj) => (
            <ObjectMesh
              key={obj.id}
              obj={obj}
              selected={selectedId === obj.id}
              settings={settings}
              clipHeightM={clipHeightM}
              onSelect={() => onSelect(obj.id)}
            />
          ))}
        </group>

        <Grid
          infiniteGrid
          fadeDistance={Math.max(8, span * 1.8)}
          fadeStrength={1.15}
          sectionColor="#3a4640"
          cellColor="#24302a"
          cellSize={METERS_PER_GRID}
          sectionSize={METERS_PER_GRID * 5}
          position={[cx, -PLATFORM_THICK_M - 0.002, cz]}
        />
        <DefaultWarehouseCamera
          cx={cx}
          cz={cz}
          spanX={bounds.spanX}
          spanZ={bounds.spanZ}
        />
      </Canvas>
      {objects.length === 0 && (
        <p className="viewer-empty">
          Карта пуста — переключитесь в редактирование и нарисуйте склад
        </p>
      )}
    </div>
  );
}
