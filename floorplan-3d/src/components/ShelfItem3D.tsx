import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { ShelfItem, ShelfItemType } from "../api";
import type { RackFrame, ShelfItemPose } from "../lib/rackGeometry";
import { layoutShelfItemsOnRack } from "../lib/rackGeometry";
import {
  shelfBoxInstanceMaterial,
  shelfSolidInstanceMaterial,
} from "../lib/shelfItemMaterials";

const BLUE = "#3d7de0";
const GRAY = "#b0b4b8";

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D();

/**
 * Обзорная 3Д-карта: InstancedMesh + старая картонная текстура (без теней).
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
  const binMat = useMemo(() => shelfSolidInstanceMaterial(BLUE), []);
  const cellMat = useMemo(() => shelfSolidInstanceMaterial(GRAY), []);

  return (
    <group>
      <ItemInstances poses={groups.box} material={boxMat} />
      <ItemInstances poses={groups.stack} material={stackMat} />
      <ItemInstances poses={groups.container} material={binMat} />
      <ItemInstances poses={groups.cell} material={cellMat} />
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
