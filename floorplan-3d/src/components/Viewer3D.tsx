import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { FloorPlanModel, Opening } from "../lib/process";
import { furniturePose, shelfFrame, shelfParts, type Furniture } from "../lib/furniture";
import { cartonLocalPose, type Carton } from "../lib/carton";
import { cartonMaterials } from "../lib/cartonTexture";
import { FLOOR_THICKNESS_M, PLATFORM_THICKNESS_M, REAL_WALL_HEIGHT, openingParts, platformSize, truncateParts, type BoxPart } from "../lib/parts";

const ROOM_COLORS = [
  "#c4a07a",
  "#7d9a84",
  "#8aa0b4",
  "#b48a8a",
  "#9a9278",
  "#7b8c9e",
];

type ViewerProps = {
  model: FloorPlanModel;
  wallHeight: number;
  planWidth: number;
  showPlan: boolean;
  colorRooms: boolean;
  showOpenings: boolean;
  selectedWindowId: string | null;
  onSelectWindow: (id: string | null) => void;
  furniture?: Furniture[];
  selectedFurnitureId?: string | null;
  onSelectFurniture?: (id: string | null) => void;
  onOpenRack?: (id: string) => void;
  cartons?: Carton[];
};

export function Viewer3D({
  model,
  wallHeight,
  planWidth,
  showPlan,
  colorRooms,
  showOpenings,
  selectedWindowId,
  onSelectWindow,
  furniture = [],
  selectedFurnitureId = null,
  onSelectFurniture,
  onOpenRack,
  cartons = [],
}: ViewerProps) {
  const cell = planWidth / model.cols;
  const depth = model.rows * cell;
  const span = Math.max(planWidth, depth, 0.25);
  const lightReach = span * 2.2;

  return (
    <Canvas
      shadows={{ type: THREE.PCFSoftShadowMap }}
      dpr={typeof window !== "undefined" && window.innerWidth < 900 ? [1, 1.5] : [1, 2]}
      camera={{ position: [planWidth * 0.7, REAL_WALL_HEIGHT * 3.2, depth * 0.9], fov: 42 }}
      gl={{ antialias: true }}
      style={{ touchAction: "none" }}
      onPointerMissed={() => {
        onSelectWindow(null);
        onSelectFurniture?.(null);
      }}
    >
      <color attach="background" args={["#101412"]} />
      <fog attach="fog" args={["#101412", span * 8, span * 22]} />
      <hemisphereLight args={["#efe8dc", "#2a332e", 1.05]} />
      <directionalLight
        position={[span * 0.85, span * 1.35, span * 0.65]}
        intensity={1.25}
        castShadow
        shadow-mapSize={typeof window !== "undefined" && window.innerWidth < 900 ? [1024, 1024] : [2048, 2048]}
        shadow-bias={-0.00015}
        shadow-normalBias={0.012}
        shadow-camera-near={0.02}
        shadow-camera-far={lightReach}
        shadow-camera-left={-span * 1.15}
        shadow-camera-right={span * 1.15}
        shadow-camera-top={span * 1.15}
        shadow-camera-bottom={-span * 1.15}
      />
      <Bounds key={`${model.cols}x${model.rows}-${model.wallCount}`} fit clip observe margin={1.35}>
        <group position={[-planWidth / 2, 0, -depth / 2]}>
          <Platform planWidth={planWidth} depth={depth} />
          <Floor
            model={model}
            planWidth={planWidth}
            depth={depth}
            showPlan={showPlan}
            colorRooms={colorRooms}
          />
          <Walls rects={model.wallRects} cell={cell} height={Math.min(REAL_WALL_HEIGHT, wallHeight)} />
          {showOpenings ? (
            <Openings
              openings={model.openings}
              cell={cell}
              wallHeight={REAL_WALL_HEIGHT}
              clipHeight={wallHeight}
              selectedWindowId={selectedWindowId}
              onSelectWindow={onSelectWindow}
            />
          ) : null}
          <FurnitureMeshes
            items={furniture}
            cartons={cartons}
            cell={cell}
            clipHeight={wallHeight}
            selectedId={selectedFurnitureId}
            onSelect={(id) => {
              onSelectFurniture?.(id);
              if (id) onSelectWindow(null);
            }}
            onOpenRack={onOpenRack}
          />
        </group>
      </Bounds>
      <Grid
        infiniteGrid
        fadeDistance={6}
        fadeStrength={1.2}
        sectionColor="#3a4640"
        cellColor="#24302a"
        cellSize={0.05}
        sectionSize={0.25}
        position={[0, -PLATFORM_THICKNESS_M - 0.002, 0]}
      />
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.05} minDistance={0.08} maxDistance={6} />
    </Canvas>
  );
}

function Platform({ planWidth, depth }: { planWidth: number; depth: number }) {
  const plate = platformSize(planWidth, depth);
  return (
    <mesh
      position={[planWidth / 2, -plate.thickness / 2, depth / 2]}
      receiveShadow
    >
      <boxGeometry args={[plate.width, plate.thickness, plate.depth]} />
      <meshStandardMaterial color="#d5cec3" roughness={0.88} metalness={0.02} />
    </mesh>
  );
}

function Floor({
  model,
  planWidth,
  depth,
  showPlan,
  colorRooms,
}: {
  model: FloorPlanModel;
  planWidth: number;
  depth: number;
  showPlan: boolean;
  colorRooms: boolean;
}) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (showPlan) ctx.drawImage(img, 0, 0);
      else {
        ctx.fillStyle = "#d8cfc2";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (colorRooms) {
        const sx = canvas.width / model.cols;
        const sy = canvas.height / model.rows;
        ctx.globalAlpha = 0.28;
        model.rooms.forEach((room, i) => {
          ctx.fillStyle = ROOM_COLORS[i % ROOM_COLORS.length]!;
          for (const rect of room.rects) {
            ctx.fillRect(rect.c * sx, rect.r * sy, rect.w * sx, rect.d * sy);
          }
        });
        ctx.globalAlpha = 1;
      }
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 8;
      map.needsUpdate = true;
      setTexture(map);
    };
    img.src = model.sourceUrl;
    return () => {
      cancelled = true;
    };
  }, [model.sourceUrl, model.rooms, model.cols, model.rows, showPlan, colorRooms]);

  useEffect(() => {
    return () => texture?.dispose();
  }, [texture]);

  return (
    <mesh
      position={[planWidth / 2, FLOOR_THICKNESS_M / 2, depth / 2]}
      receiveShadow
    >
      <boxGeometry args={[planWidth, FLOOR_THICKNESS_M, depth]} />
      <meshStandardMaterial
        color="#ffffff"
        map={texture}
        roughness={0.92}
        metalness={0.02}
        polygonOffset
        polygonOffsetFactor={1}
        polygonOffsetUnits={1}
      />
    </mesh>
  );
}

function Walls({
  rects,
  cell,
  height,
}: {
  rects: FloorPlanModel["wallRects"];
  cell: number;
  height: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    rects.forEach((rect, i) => {
      dummy.position.set(
        (rect.c + rect.w / 2) * cell,
        height / 2,
        (rect.r + rect.d / 2) * cell,
      );
      dummy.scale.set(rect.w * cell, height, rect.d * cell);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [rects, cell, height, dummy]);

  if (rects.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, rects.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#efe8dc" roughness={0.78} metalness={0.02} />
    </instancedMesh>
  );
}

const PART_MATERIALS: Record<BoxPart["role"], { color: string; roughness: number; metalness: number; transparent?: boolean; opacity?: number }> = {
  lintel: { color: "#efe8dc", roughness: 0.72, metalness: 0.04 },
  sill: { color: "#efe8dc", roughness: 0.72, metalness: 0.04 },
  head: { color: "#efe8dc", roughness: 0.72, metalness: 0.04 },
  door: { color: "#8a5a36", roughness: 0.55, metalness: 0.05 },
  glass: { color: "#9ec9dc", roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.32 },
  rackUpright: { color: "#2f5fbf", roughness: 0.42, metalness: 0.28 },
  rackBeam: { color: "#9aa3ad", roughness: 0.58, metalness: 0.28 },
  rackDeck: { color: "#9aa3ad", roughness: 0.58, metalness: 0.28 },
};

function Openings({
  openings,
  cell,
  wallHeight,
  clipHeight,
  selectedWindowId,
  onSelectWindow,
}: {
  openings: Opening[];
  cell: number;
  wallHeight: number;
  clipHeight: number;
  selectedWindowId: string | null;
  onSelectWindow: (id: string | null) => void;
}) {
  return (
    <group>
      {openings.map((opening) => (
        <OpeningMesh
          key={opening.id}
          opening={opening}
          cell={cell}
          wallHeight={wallHeight}
          clipHeight={clipHeight}
          selected={opening.id === selectedWindowId}
          onSelect={() => onSelectWindow(opening.id)}
        />
      ))}
    </group>
  );
}

function OpeningMesh({
  opening,
  cell,
  wallHeight,
  clipHeight,
  selected,
  onSelect,
}: {
  opening: Opening;
  cell: number;
  wallHeight: number;
  clipHeight: number;
  selected: boolean;
  onSelect?: () => void;
}) {
  const parts = useMemo(
    () => truncateParts(openingParts(opening, cell, wallHeight, 0), clipHeight),
    [opening, cell, wallHeight, clipHeight],
  );

  return (
    <group onClick={onSelect ? (event) => { event.stopPropagation(); onSelect(); } : undefined}>
      {parts.map((part, i) => {
        const mat = PART_MATERIALS[part.role];
        const glassSelected = selected && part.role === "glass";
        return (
          <mesh
            key={i}
            position={part.position}
            rotation={[part.rotationX ?? 0, part.rotationY, part.rotationZ ?? 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={part.size} />
            <meshStandardMaterial
              color={glassSelected ? "#d7f3ff" : mat.color}
              roughness={mat.roughness}
              metalness={mat.metalness}
              transparent={mat.transparent}
              opacity={glassSelected ? 0.55 : mat.opacity}
              emissive={selected ? "#c4a574" : "#000000"}
              emissiveIntensity={selected ? (part.role === "glass" ? 0.35 : 0.12) : 0}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function FurnitureMeshes({
  items,
  cartons,
  cell,
  clipHeight,
  selectedId,
  onSelect,
  onOpenRack,
}: {
  items: Furniture[];
  cartons: Carton[];
  cell: number;
  clipHeight: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenRack?: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <group>
      {items.map((item) => (
        <ShelfMesh
          key={item.id}
          item={item}
          cartons={cartons.filter((carton) => carton.furnitureId === item.id)}
          cell={cell}
          clipHeight={clipHeight}
          selected={item.id === selectedId}
          onSelect={() => onSelect(item.id)}
          onOpenRack={onOpenRack ? () => onOpenRack(item.id) : undefined}
        />
      ))}
    </group>
  );
}

function ShelfMesh({
  item,
  cartons,
  cell,
  clipHeight,
  selected,
  onSelect,
  onOpenRack,
}: {
  item: Furniture;
  cartons: Carton[];
  cell: number;
  clipHeight: number;
  selected: boolean;
  onSelect: () => void;
  onOpenRack?: () => void;
}) {
  const pose = useMemo(() => furniturePose(item, cell), [item, cell]);
  const frame = useMemo(() => shelfFrame(item, cell), [item, cell]);
  const parts = useMemo(
    () => truncateParts(shelfParts(item, cell, 0), clipHeight),
    [item, cell, clipHeight],
  );
  const materials = useMemo(() => cartonMaterials(), []);
  const holdRef = useRef<number | null>(null);
  const startRef = useRef({ x: 0, y: 0 });

  const clearHold = () => {
    if (holdRef.current != null) {
      window.clearTimeout(holdRef.current);
      holdRef.current = null;
    }
  };

  return (
    <group
      position={[pose.x, 0, pose.z]}
      rotation={[0, pose.yaw, 0]}
      onClick={(event) => { event.stopPropagation(); onSelect(); }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        clearHold();
        onOpenRack?.();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
        startRef.current = { x: event.clientX, y: event.clientY };
        clearHold();
        holdRef.current = window.setTimeout(() => {
          holdRef.current = null;
          onOpenRack?.();
        }, 520);
      }}
      onPointerMove={(event) => {
        if (holdRef.current == null) return;
        const dx = event.clientX - startRef.current.x;
        const dy = event.clientY - startRef.current.y;
        if (Math.hypot(dx, dy) > 12) clearHold();
      }}
      onPointerUp={clearHold}
      onPointerCancel={clearHold}
    >
      {parts.map((part, i) => {
        const mat = PART_MATERIALS[part.role];
        return (
          <mesh
            key={i}
            position={part.position}
            rotation={[part.rotationX ?? 0, part.rotationY, part.rotationZ ?? 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={part.size} />
            <meshStandardMaterial
              color={mat.color}
              roughness={mat.roughness}
              metalness={mat.metalness}
              emissive={selected ? "#c4a574" : "#000000"}
              emissiveIntensity={selected ? 0.16 : 0}
            />
          </mesh>
        );
      })}
      {cartons.map((carton) => {
        const poseBox = cartonLocalPose(frame, carton, 0);
        if (!poseBox) return null;
        const top = poseBox.position[1] + poseBox.size[1] / 2;
        if (top < 0.001 || poseBox.position[1] - poseBox.size[1] / 2 >= clipHeight) return null;
        return (
          <mesh
            key={carton.id}
            position={poseBox.position}
            material={materials}
            castShadow
            receiveShadow
          >
            <boxGeometry args={poseBox.size} />
          </mesh>
        );
      })}
    </group>
  );
}
