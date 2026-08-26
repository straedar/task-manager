import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import type { MapObject, MapSettings, ShelfItem } from "../api";
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
import { detectEnclosedRoomFloors } from "../lib/enclosedRooms";
import {
  OfficeChairMesh,
  OfficeDeskMesh,
  OfficePlainDeskMesh,
} from "./OfficeFurniture3D";
import { RackShelfItems } from "./ShelfItem3D";

type Props = {
  objects: MapObject[];
  settings: MapSettings;
  selectedId: number | null;
  clipHeightM: number;
  /** Soft-hide walls that face the camera and block the view. */
  occlusionMasking?: boolean;
  onOcclusionMaskingChange?: (enabled: boolean) => void;
  shelfItems?: ShelfItem[];
  onSelect: (id: number | null) => void;
  onOpenRack?: (id: number) => void;
};

type OcclusionTarget = { x: number; y: number; z: number };

type OcclusionEntry = {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  baseOpacity: number;
  /** Center of wall slab in XZ. */
  px: number;
  pz: number;
  /** Outward normal (thickness axis). */
  nx: number;
  nz: number;
  /** Unit tangent along the wall run. */
  tx: number;
  tz: number;
  halfLen: number;
  halfThick: number;
  y0: number;
  y1: number;
};

type OcclusionApi = {
  enabled: boolean;
  register: (entry: OcclusionEntry) => () => void;
};

const WallOcclusionContext = createContext<OcclusionApi | null>(null);

/** Horizontal unit normal of a wall slab face (thickness axis). */
function wallFaceNormal(w: number, d: number, rotY: number): { nx: number; nz: number } {
  if (w >= d) {
    return { nx: Math.sin(rotY), nz: Math.cos(rotY) };
  }
  return { nx: Math.cos(rotY), nz: -Math.sin(rotY) };
}

function wallOcclusionEntry(
  w: number,
  d: number,
  x: number,
  z: number,
  rotY: number,
  y0: number,
  y1: number,
  mesh: THREE.Mesh,
  material: THREE.MeshStandardMaterial,
  baseOpacity: number,
): OcclusionEntry {
  const { nx, nz } = wallFaceNormal(w, d, rotY);
  const along = Math.max(w, d);
  const cell = worldToMeters(GRID);
  return {
    mesh,
    material,
    baseOpacity,
    px: x,
    pz: z,
    nx,
    nz,
    tx: -nz,
    tz: nx,
    halfLen: along / 2,
    halfThick: cell / 2,
    y0,
    y1,
  };
}

/**
 * True when the wall segment sits between camera and target in the floor plan (XZ).
 * Height is ignored on purpose: from a high orbit the 3D ray often clears the wall top,
 * but the wall still visually blocks the racks.
 */
function wallBlocksTarget(
  cam: THREE.Vector3,
  target: OcclusionTarget,
  wall: OcclusionEntry,
): boolean {
  const dx = target.x - cam.x;
  const dz = target.z - cam.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.12) return false;

  const dirX = dx / dist;
  const dirZ = dz / dist;
  const denom = dirX * wall.nx + dirZ * wall.nz;
  if (Math.abs(denom) < 1e-5) return false;

  const t = ((wall.px - cam.x) * wall.nx + (wall.pz - cam.z) * wall.nz) / denom;
  // Must be strictly between camera and target.
  if (t < 0.02 || t > dist - 0.02) return false;

  const ix = cam.x + t * dirX;
  const iz = cam.z + t * dirZ;
  const along = Math.abs((ix - wall.px) * wall.tx + (iz - wall.pz) * wall.tz);
  // Slight pad so segmented walls still catch rays near joints.
  return along <= wall.halfLen + 0.2;
}

function applyWallOpacity(entry: OcclusionEntry, opacity: number) {
  if (opacity < 0.08) {
    entry.mesh.visible = false;
    entry.mesh.castShadow = false;
  } else {
    entry.mesh.visible = true;
    entry.mesh.castShadow = opacity > 0.85;
    entry.material.transparent = opacity < 0.98;
    entry.material.opacity = opacity;
    entry.material.depthWrite = opacity > 0.85;
  }
}

function WallOcclusionDriver({
  enabled,
  entriesRef,
  targetsRef,
}: {
  enabled: boolean;
  entriesRef: MutableRefObject<Set<OcclusionEntry>>;
  targetsRef: MutableRefObject<OcclusionTarget[]>;
}) {
  const { camera } = useThree();

  useFrame(() => {
    const entries = entriesRef.current;
    if (entries.size === 0) return;

    const targets = targetsRef.current;

    if (!enabled || targets.length === 0) {
      for (const entry of entries) {
        applyWallOpacity(entry, entry.baseOpacity);
      }
      return;
    }

    for (const entry of entries) {
      let occludes = false;

      for (const target of targets) {
        if (wallBlocksTarget(camera.position, target, entry)) {
          occludes = true;
          break;
        }
      }

      if (!occludes) {
        applyWallOpacity(entry, entry.baseOpacity);
        continue;
      }

      // Hard hide when the wall blocks any rack/furniture.
      applyWallOpacity(entry, entry.baseOpacity * 0.04);
    }
  });

  return null;
}

function useWallOcclusionRegistration(opts: {
  meshRef: MutableRefObject<THREE.Mesh | null>;
  materialRef: MutableRefObject<THREE.MeshStandardMaterial | null>;
  w: number;
  d: number;
  x: number;
  z: number;
  rotY: number;
  y0: number;
  y1: number;
  baseOpacity?: number;
}) {
  const api = useContext(WallOcclusionContext);
  const { meshRef, materialRef, w, d, x, z, rotY, y0, y1, baseOpacity = 1 } =
    opts;

  useLayoutEffect(() => {
    if (!api) return;
    const mesh = meshRef.current;
    const material = materialRef.current;
    if (!mesh || !material) return;
    return api.register(
      wallOcclusionEntry(w, d, x, z, rotY, y0, y1, mesh, material, baseOpacity),
    );
  }, [api, meshRef, materialRef, w, d, x, z, rotY, y0, y1, baseOpacity]);
}

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
const WALL_HEIGHT_BOOST = 4 / 3;
const RACK_HEIGHT_BOOST = 4 / 3;

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
  roomFloors,
}: {
  bounds: ReturnType<typeof sceneBounds>;
  floorUrl: string | null;
  roomFloors: ReturnType<typeof detectEnclosedRoomFloors>;
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
        loaded.anisotropy = 4;
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
  }, [floorUrl]);

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
        <meshStandardMaterial
          color={FLOOR_COLOR}
          roughness={0.92}
          metalness={0.02}
        />
      </mesh>
      {texture &&
        roomFloors.map((room, i) => (
          <RoomFloorPatch
            key={`room-floor-${i}-${room.x.toFixed(2)}-${room.z.toFixed(2)}`}
            room={room}
            source={texture}
          />
        ))}
    </group>
  );
}

function RoomFloorPatch({
  room,
  source,
}: {
  room: { x: number; z: number; width: number; depth: number };
  source: THREE.Texture;
}) {
  const material = useMemo(() => {
    const map = source.clone();
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(
      Math.max(1, room.width / (METERS_PER_GRID * 2)),
      Math.max(1, room.depth / (METERS_PER_GRID * 2)),
    );
    map.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      map,
      color: "#ffffff",
      roughness: 0.82,
      metalness: 0.02,
    });
  }, [source, room.width, room.depth]);

  useEffect(
    () => () => {
      material.map?.dispose();
      material.dispose();
    },
    [material],
  );

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[room.x + room.width / 2, 0.004, room.z + room.depth / 2]}
      receiveShadow
      material={material}
    >
      <planeGeometry args={[room.width, room.depth]} />
    </mesh>
  );
}

function OccludingWallPart({
  position,
  rotationY,
  size,
  color,
  selected,
  emissiveIntensity,
  w,
  d,
  x,
  z,
  rotY,
  y0,
  y1,
  baseOpacity = 1,
  roughness = 0.78,
  metalness = 0.02,
  castShadow = true,
  receiveShadow = true,
  onClick,
}: {
  position: [number, number, number];
  rotationY: number;
  size: [number, number, number];
  color: string;
  selected: boolean;
  emissiveIntensity: number;
  w: number;
  d: number;
  x: number;
  z: number;
  rotY: number;
  y0: number;
  y1: number;
  baseOpacity?: number;
  roughness?: number;
  metalness?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  onClick: (e: { stopPropagation: () => void }) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  useWallOcclusionRegistration({
    meshRef,
    materialRef,
    w,
    d,
    x,
    z,
    rotY,
    y0,
    y1,
    baseOpacity,
  });

  useLayoutEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;
    mat.opacity = baseOpacity;
    mat.transparent = baseOpacity < 0.99;
    mat.depthWrite = baseOpacity > 0.85;
  }, [baseOpacity]);

  return (
    <mesh
      ref={meshRef}
      position={position}
      rotation={[0, rotationY, 0]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      onClick={onClick}
    >
      <boxGeometry args={size} />
      <meshStandardMaterial
        ref={materialRef}
        color={color}
        roughness={roughness}
        metalness={metalness}
        emissive={selected ? SELECT_EMISSIVE : "#000000"}
        emissiveIntensity={emissiveIntensity}
      />
    </mesh>
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
  const y0 = band.y - band.h / 2;
  const y1 = band.y + band.h / 2;
  return (
    <OccludingWallPart
      position={[x, band.y, z]}
      rotationY={rotY}
      size={wallSlabSize(w, d, band.h)}
      color={WALL_COLOR}
      selected={selected}
      emissiveIntensity={selected ? 0.18 : 0}
      w={w}
      d={d}
      x={x}
      z={z}
      rotY={rotY}
      y0={y0}
      y1={y1}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    />
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
    <group>
      {sill && (
        <OccludingWallPart
          position={[x, sill.y, z]}
          rotationY={rotY}
          size={wallSlabSize(w, d, sill.h)}
          color={WALL_COLOR}
          selected={selected}
          emissiveIntensity={selected ? 0.14 : 0}
          w={w}
          d={d}
          x={x}
          z={z}
          rotY={rotY}
          y0={sill.y - sill.h / 2}
          y1={sill.y + sill.h / 2}
          onClick={onPick}
        />
      )}
      {glass && (
        <OccludingWallPart
          position={[x, glass.y, z]}
          rotationY={rotY}
          size={wallSlabSize(w, d, glass.h, 0.55)}
          color={selected ? "#d7f3ff" : GLASS_COLOR}
          selected={selected}
          emissiveIntensity={selected ? 0.12 : 0}
          w={w}
          d={d}
          x={x}
          z={z}
          rotY={rotY}
          y0={glass.y - glass.h / 2}
          y1={glass.y + glass.h / 2}
          baseOpacity={0.32}
          roughness={0.08}
          metalness={0.15}
          castShadow={false}
          receiveShadow={false}
          onClick={onPick}
        />
      )}
      {head && (
        <OccludingWallPart
          position={[x, head.y, z]}
          rotationY={rotY}
          size={wallSlabSize(w, d, head.h)}
          color={WALL_COLOR}
          selected={selected}
          emissiveIntensity={selected ? 0.14 : 0}
          w={w}
          d={d}
          x={x}
          z={z}
          rotY={rotY}
          y0={head.y - head.h / 2}
          y1={head.y + head.h / 2}
          onClick={onPick}
        />
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
    <group>
      {leaf && (
        <OccludingWallPart
          position={[x, leaf.y, z]}
          rotationY={rotY}
          size={wallSlabSize(w, d, leaf.h, 0.45)}
          color={DOOR_COLOR}
          selected={selected}
          emissiveIntensity={selected ? 0.16 : 0}
          w={w}
          d={d}
          x={x}
          z={z}
          rotY={rotY}
          y0={leaf.y - leaf.h / 2}
          y1={leaf.y + leaf.h / 2}
          roughness={0.55}
          metalness={0.05}
          onClick={onPick}
        />
      )}
      {lintel && (
        <OccludingWallPart
          position={[x, lintel.y, z]}
          rotationY={rotY}
          size={wallSlabSize(w, d, lintel.h)}
          color={WALL_COLOR}
          selected={selected}
          emissiveIntensity={selected ? 0.14 : 0}
          w={w}
          d={d}
          x={x}
          z={z}
          rotY={rotY}
          y0={lintel.y - lintel.h / 2}
          y1={lintel.y + lintel.h / 2}
          onClick={onPick}
        />
      )}
    </group>
  );
}

function rackPartMaterials(theme: MapObject["rackTheme"]) {
  const upright =
    theme === "black"
      ? { color: "#2a2e34", roughness: 0.48, metalness: 0.32 }
      : { color: "#2f5fbf", roughness: 0.42, metalness: 0.28 };
  const deck =
    theme === "black"
      ? { color: "#e07a2f", roughness: 0.45, metalness: 0.22 }
      : { color: "#9aa3ad", roughness: 0.58, metalness: 0.28 };
  return {
    rackUpright: upright,
    rackBeam: deck,
    rackDeck: deck,
  } as const;
}

function RackMesh({
  obj,
  selected,
  rackHeightM,
  items,
  onSelect,
  onOpen,
}: {
  obj: MapObject;
  selected: boolean;
  rackHeightM: number;
  items: ShelfItem[];
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
            castShadow={false}
            receiveShadow={false}
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
      <RackShelfItems
        frame={frame}
        items={items}
        frameWidthPx={obj.frameWidth}
      />
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
  items,
  onSelect,
  onOpen,
}: {
  obj: MapObject;
  selected: boolean;
  settings: MapSettings;
  clipHeightM: number;
  items?: ShelfItem[];
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
          items={items ?? []}
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
    case "computer_desk":
      return (
        <OfficePlainDeskMesh obj={obj} selected={selected} onSelect={onSelect} />
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

/** Свет всегда смотрит в центр склада — иначе карта теней «ползёт» при правке стен. */
function WarehouseSun({
  cx,
  cz,
  span,
  wallH,
}: {
  cx: number;
  cz: number;
  span: number;
  wallH: number;
}) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const { scene } = useThree();
  const qcx = Math.round(cx / 2) * 2;
  const qcz = Math.round(cz / 2) * 2;
  const shadowSpan = Math.ceil(Math.max(span, 12) / 4) * 4;
  const height = Math.max(shadowSpan, wallH * 3);

  useLayoutEffect(() => {
    const light = lightRef.current;
    if (!light) return;
    light.target.position.set(qcx, 0, qcz);
    scene.add(light.target);
    light.target.updateMatrixWorld();
    return () => {
      scene.remove(light.target);
    };
  }, [scene, qcx, qcz]);

  return (
    <directionalLight
      ref={lightRef}
      castShadow
      intensity={1.25}
      position={[qcx + shadowSpan * 0.55, height, qcz + shadowSpan * 0.4]}
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.00025}
      shadow-normalBias={0.035}
      shadow-radius={2}
      shadow-camera-near={0.5}
      shadow-camera-far={shadowSpan * 4}
      shadow-camera-left={-shadowSpan * 1.15}
      shadow-camera-right={shadowSpan * 1.15}
      shadow-camera-top={shadowSpan * 1.15}
      shadow-camera-bottom={-shadowSpan * 1.15}
    />
  );
}

export function WarehouseViewer3D({
  objects,
  settings,
  selectedId,
  clipHeightM,
  occlusionMasking = true,
  onOcclusionMaskingChange,
  shelfItems = [],
  onSelect,
  onOpenRack,
}: Props) {
  const bounds = useMemo(() => sceneBounds(objects), [objects]);
  const itemsByRack = useMemo(() => {
    const map = new Map<number, ShelfItem[]>();
    for (const item of shelfItems) {
      const list = map.get(item.rackId);
      if (list) list.push(item);
      else map.set(item.rackId, [item]);
    }
    return map;
  }, [shelfItems]);
  const boostedSettings = useMemo<MapSettings>(
    () => ({
      ...settings,
      wallHeightM: settings.wallHeightM * WALL_HEIGHT_BOOST,
      rackHeightM: settings.rackHeightM * RACK_HEIGHT_BOOST,
    }),
    [settings],
  );

  const nonClip = objects.filter((o) => o.type !== "wall" && o.type !== "window");
  const clipOnly = objects.filter((o) => o.type === "wall" || o.type === "window");
  const span = Math.max(bounds.spanX, bounds.spanZ);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const wallH = boostedSettings.wallHeightM;
  const camH = Math.max(span * 0.86, wallH * 2.5);
  const camDist = span * 0.92;

  const roomFloors = useMemo(
    () => detectEnclosedRoomFloors(objects),
    [objects],
  );

  const occlusionTargets = useMemo<OcclusionTarget[]>(() => {
    const rackH = boostedSettings.rackHeightM;
    const targets: OcclusionTarget[] = [];
    for (const obj of objects) {
      if (
        obj.type !== "rack" &&
        obj.type !== "table" &&
        obj.type !== "computer_desk" &&
        obj.type !== "pallet"
      ) {
        continue;
      }
      const { x, z, w, d } = footprint(obj);
      const y =
        obj.type === "rack"
          ? rackH * 0.45
          : obj.type === "pallet"
            ? PALLET_HEIGHT_M * 0.5
            : 0.4;
      // Dense XZ samples so long walls catch occlusion from any orbit angle.
      const ox = Math.max(w * 0.4, 0.15);
      const oz = Math.max(d * 0.4, 0.15);
      targets.push(
        { x, y, z },
        { x: x - ox, y, z: z - oz },
        { x: x + ox, y, z: z - oz },
        { x: x - ox, y, z: z + oz },
        { x: x + ox, y, z: z + oz },
        { x: x - ox, y, z },
        { x: x + ox, y, z },
        { x, y, z: z - oz },
        { x, y, z: z + oz },
      );
    }
    return targets;
  }, [objects, boostedSettings.rackHeightM]);

  const occlusionEntriesRef = useRef(new Set<OcclusionEntry>());
  const occlusionTargetsRef = useRef<OcclusionTarget[]>([]);
  useLayoutEffect(() => {
    occlusionTargetsRef.current = occlusionTargets;
  }, [occlusionTargets]);
  const occlusionApi = useMemo<OcclusionApi>(
    () => ({
      enabled: occlusionMasking,
      register: (entry) => {
        occlusionEntriesRef.current.add(entry);
        return () => {
          occlusionEntriesRef.current.delete(entry);
        };
      },
    }),
    [occlusionMasking],
  );

  return (
    <div className="viewer-3d">
      <Canvas
        shadows={{ type: THREE.PCFSoftShadowMap }}
        dpr={1}
        gl={{ antialias: false, powerPreference: "high-performance" }}
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
        <hemisphereLight args={["#efe8dc", "#2a332e", 1.15]} />
        <ambientLight intensity={0.22} />
        <WarehouseSun cx={cx} cz={cz} span={span} wallH={wallH} />
        <FloorPlane
          bounds={bounds}
          floorUrl={settings.floorUrl}
          roomFloors={roomFloors}
        />

        <WallOcclusionContext.Provider value={occlusionApi}>
          <WallOcclusionDriver
            enabled={occlusionMasking}
            entriesRef={occlusionEntriesRef}
            targetsRef={occlusionTargetsRef}
          />
          <group>
            {nonClip.map((obj) => (
              <ObjectMesh
                key={obj.id}
                obj={obj}
                selected={selectedId === obj.id}
                settings={boostedSettings}
                clipHeightM={1e9}
                items={obj.type === "rack" ? itemsByRack.get(obj.id) : undefined}
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
                settings={boostedSettings}
                clipHeightM={clipHeightM}
                onSelect={() => onSelect(obj.id)}
              />
            ))}
          </group>
        </WallOcclusionContext.Provider>

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
      {onOcclusionMaskingChange && (
        <button
          type="button"
          className={
            occlusionMasking
              ? "viewer-occlusion-toggle active"
              : "viewer-occlusion-toggle"
          }
          aria-pressed={occlusionMasking}
          title="Скрывать стены, которые перекрывают вид на стеллажи"
          onClick={() => onOcclusionMaskingChange(!occlusionMasking)}
        >
          Маскировка стен: {occlusionMasking ? "вкл" : "выкл"}
        </button>
      )}
      {objects.length === 0 && (
        <p className="viewer-empty">
          Карта пуста — переключитесь в редактирование и нарисуйте склад
        </p>
      )}
    </div>
  );
}
