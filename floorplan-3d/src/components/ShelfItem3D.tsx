import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ShelfItem, ShelfItemType } from "../api";
import type { RackFrame, ShelfItemPose } from "../lib/rackGeometry";
import { layoutShelfItemsOnRack } from "../lib/rackGeometry";
import { shelfBoxInstanceMaterial } from "../lib/shelfItemMaterials";

const BLUE = "#3d7de0";
const BLUE_DARK = "#1e4aa3";
const BLUE_INNER = "#2a62c4";
const GRAY = "#c5c5c5";
const GRAY_EDGE = "#8d8d8d";
const GRAY_INNER = "#d8d8d8";

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D();

/**
 * Коробки — InstancedMesh; контейнеры/ячейки — объёмные модели (открытый ящик / лоток).
 */
export function RackShelfItems({
  frame,
  items,
  frameWidthPx = null,
}: {
  frame: RackFrame;
  items: ShelfItem[];
  frameWidthPx?: number | null;
}) {
  const poses = useMemo(
    () => layoutShelfItemsOnRack(frame, items, frameWidthPx),
    [frame, items, frameWidthPx],
  );

  const groups = useMemo(() => {
    const map: Record<ShelfItemType, ShelfItemPose[]> = {
      box: [],
      stack: [],
      container: [],
      cell: [],
    };
    for (const pose of poses) map[pose.type].push(pose);
    return map;
  }, [poses]);

  const boxMat = useMemo(() => shelfBoxInstanceMaterial("box"), []);
  const stackMat = useMemo(() => shelfBoxInstanceMaterial("stack"), []);

  return (
    <group>
      <ItemInstances poses={groups.box} material={boxMat} />
      <ItemInstances poses={groups.stack} material={stackMat} />
      {groups.container.map((pose) => (
        <BlueBinMesh
          key={pose.itemId}
          position={pose.position}
          w={pose.size[0]}
          h={pose.size[1]}
          d={pose.size[2]}
        />
      ))}
      {groups.cell.map((pose) => (
        <GrayCellMesh
          key={pose.itemId}
          position={pose.position}
          w={pose.size[0]}
          h={pose.size[1]}
          d={pose.size[2]}
        />
      ))}
    </group>
  );
}

function ItemInstances({
  poses,
  material,
}: {
  poses: ShelfItemPose[];
  material: THREE.Material;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = poses.length;

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;
    for (let i = 0; i < count; i += 1) {
      const pose = poses[i]!;
      const [x, y, z] = pose.position;
      const [w, h, d] = pose.size;
      dummy.position.set(x, y, z);
      dummy.scale.set(Math.max(0.02, w), Math.max(0.02, h), Math.max(0.02, d));
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [poses, count]);

  if (count === 0) return null;

  return (
    <instancedMesh
      key={count}
      ref={meshRef}
      args={[unitBox, material, count]}
      castShadow={false}
      receiveShadow={false}
      frustumCulled
    />
  );
}

function BlueBinMesh({
  position,
  w,
  h,
  d,
}: {
  position: [number, number, number];
  w: number;
  h: number;
  d: number;
}) {
  const t = Math.min(0.018, w * 0.08, d * 0.06);
  const innerW = Math.max(0.02, w - t * 2);
  const innerD = Math.max(0.02, d - t * 2);
  const wallH = Math.max(0.02, h - t);
  const labelW = innerW * 0.62;
  const labelH = Math.min(wallH * 0.28, h * 0.22);

  return (
    <group position={position}>
      <mesh position={[0, -h / 2 + t / 2, 0]} castShadow={false}>
        <boxGeometry args={[w, t, d]} />
        <meshStandardMaterial color={BLUE_DARK} roughness={0.45} metalness={0.05} />
      </mesh>
      <mesh position={[0, -h / 2 + t + wallH / 2, -d / 2 + t / 2]} castShadow={false}>
        <boxGeometry args={[w, wallH, t]} />
        <meshStandardMaterial color={BLUE} roughness={0.42} metalness={0.04} />
      </mesh>
      <mesh position={[-w / 2 + t / 2, -h / 2 + t + wallH / 2, 0]} castShadow={false}>
        <boxGeometry args={[t, wallH, innerD]} />
        <meshStandardMaterial color={BLUE} roughness={0.42} metalness={0.04} />
      </mesh>
      <mesh position={[w / 2 - t / 2, -h / 2 + t + wallH / 2, 0]} castShadow={false}>
        <boxGeometry args={[t, wallH, innerD]} />
        <meshStandardMaterial color={BLUE} roughness={0.42} metalness={0.04} />
      </mesh>
      <mesh position={[0, -h / 2 + t + wallH * 0.42, d / 2 - t / 2]} castShadow={false}>
        <boxGeometry args={[w, wallH * 0.84, t]} />
        <meshStandardMaterial color={BLUE} roughness={0.42} metalness={0.04} />
      </mesh>
      <mesh position={[0, t * 0.2, 0]}>
        <boxGeometry args={[innerW * 0.96, 0.004, innerD * 0.96]} />
        <meshStandardMaterial color={BLUE_INNER} roughness={0.5} metalness={0.03} />
      </mesh>
      <mesh position={[0, -h / 2 + t + labelH * 0.7, d / 2 - t * 0.4 + 0.001]}>
        <boxGeometry args={[labelW, labelH, 0.003]} />
        <meshStandardMaterial color="#f4f7fb" roughness={0.65} metalness={0} />
      </mesh>
    </group>
  );
}

function GrayCellMesh({
  position,
  w,
  h,
  d,
}: {
  position: [number, number, number];
  w: number;
  h: number;
  d: number;
}) {
  const t = Math.min(0.016, w * 0.07, d * 0.05);
  const rim = Math.min(0.02, h * 0.14);
  const bodyW = Math.max(0.03, w - rim * 0.8);
  const bodyD = Math.max(0.03, d - rim * 0.8);
  const bodyH = Math.max(0.03, h - rim);
  const innerW = Math.max(0.02, bodyW - t * 2);
  const innerD = Math.max(0.02, bodyD - t * 2);

  return (
    <group position={position}>
      <mesh position={[0, -h / 2 + t / 2, 0]} castShadow={false}>
        <boxGeometry args={[bodyW, t, bodyD]} />
        <meshStandardMaterial color={GRAY_EDGE} roughness={0.55} metalness={0.08} />
      </mesh>
      <mesh position={[0, -h / 2 + t + (bodyH - t) / 2, -bodyD / 2 + t / 2]} castShadow={false}>
        <boxGeometry args={[bodyW, bodyH - t, t]} />
        <meshStandardMaterial color={GRAY} roughness={0.5} metalness={0.06} />
      </mesh>
      <mesh position={[0, -h / 2 + t + (bodyH - t) / 2, bodyD / 2 - t / 2]} castShadow={false}>
        <boxGeometry args={[bodyW, bodyH - t, t]} />
        <meshStandardMaterial color={GRAY} roughness={0.5} metalness={0.06} />
      </mesh>
      <mesh position={[-bodyW / 2 + t / 2, -h / 2 + t + (bodyH - t) / 2, 0]} castShadow={false}>
        <boxGeometry args={[t, bodyH - t, innerD]} />
        <meshStandardMaterial color={GRAY} roughness={0.5} metalness={0.06} />
      </mesh>
      <mesh position={[bodyW / 2 - t / 2, -h / 2 + t + (bodyH - t) / 2, 0]} castShadow={false}>
        <boxGeometry args={[t, bodyH - t, innerD]} />
        <meshStandardMaterial color={GRAY} roughness={0.5} metalness={0.06} />
      </mesh>
      <mesh position={[0, -h / 2 + bodyH + rim / 2, 0]} castShadow={false}>
        <boxGeometry args={[w, rim, d]} />
        <meshStandardMaterial color={GRAY_EDGE} roughness={0.48} metalness={0.1} />
      </mesh>
      <mesh position={[0, -h / 2 + t + 0.003, 0]}>
        <boxGeometry args={[innerW, 0.004, innerD]} />
        <meshStandardMaterial color={GRAY_INNER} roughness={0.62} metalness={0.04} />
      </mesh>
    </group>
  );
}
