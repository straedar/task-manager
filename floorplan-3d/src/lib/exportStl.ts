import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { FloorPlanModel } from "./process";
import { furniturePose, shelfFrame, shelfParts, type Furniture } from "./furniture";
import { cartonLocalPose, type Carton } from "./carton";
import { REAL_WALL_HEIGHT, openingParts, platformSize } from "./parts";

const METERS_TO_MM = 1000;

export function exportFloorplanStl(
  model: FloorPlanModel,
  options: { planWidth: number; furniture?: Furniture[]; cartons?: Carton[] },
) {
  const geometry = buildSolidGeometry(model, options);
  const mesh = new THREE.Mesh(geometry);
  const exporter = new STLExporter();
  const data = exporter.parse(mesh, { binary: true }) as DataView;
  geometry.dispose();

  const blob = new Blob([data.buffer as ArrayBuffer], { type: "model/stl" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "floorplan.stl";
  a.click();
  URL.revokeObjectURL(a.href);
}

function buildSolidGeometry(
  model: FloorPlanModel,
  options: { planWidth: number; furniture?: Furniture[]; cartons?: Carton[] },
): THREE.BufferGeometry {
  const cell = options.planWidth / model.cols;
  const depth = model.rows * cell;
  const plate = platformSize(options.planWidth, depth);
  const parts: THREE.BufferGeometry[] = [];

  const platform = new THREE.BoxGeometry(plate.width, plate.thickness, plate.depth);
  platform.translate(options.planWidth / 2, plate.thickness / 2, depth / 2);
  parts.push(platform);

  for (const rect of model.wallRects) {
    const width = rect.w * cell;
    const length = rect.d * cell;
    const wall = new THREE.BoxGeometry(width, REAL_WALL_HEIGHT, length);
    wall.translate(
      (rect.c + rect.w / 2) * cell,
      plate.thickness + REAL_WALL_HEIGHT / 2,
      (rect.r + rect.d / 2) * cell,
    );
    parts.push(wall);
  }

  for (const opening of model.openings) {
    for (const part of openingParts(opening, cell, REAL_WALL_HEIGHT, plate.thickness)) {
      if (part.role === "glass") continue;
      const box = new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
      box.rotateY(part.rotationY);
      box.translate(part.position[0], part.position[1], part.position[2]);
      parts.push(box);
    }
  }

  for (const item of options.furniture ?? []) {
    const pose = furniturePose(item, cell);
    for (const part of shelfParts(item, cell, plate.thickness)) {
      const box = new THREE.BoxGeometry(part.size[0], part.size[1], part.size[2]);
      if (part.rotationX) box.rotateX(part.rotationX);
      if (part.rotationY) box.rotateY(part.rotationY);
      if (part.rotationZ) box.rotateZ(part.rotationZ);
      box.translate(part.position[0], part.position[1], part.position[2]);
      box.rotateY(pose.yaw);
      box.translate(pose.x, 0, pose.z);
      parts.push(box);
    }
    const frame = shelfFrame(item, cell);
    for (const carton of (options.cartons ?? []).filter((entry) => entry.furnitureId === item.id)) {
      const poseBox = cartonLocalPose(frame, carton, plate.thickness);
      if (!poseBox) continue;
      const box = new THREE.BoxGeometry(poseBox.size[0], poseBox.size[1], poseBox.size[2]);
      box.translate(poseBox.position[0], poseBox.position[1], poseBox.position[2]);
      box.rotateY(pose.yaw);
      box.translate(pose.x, 0, pose.z);
      parts.push(box);
    }
  }

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error("Не удалось собрать геометрию для STL");

  merged.rotateX(Math.PI / 2);
  merged.scale(METERS_TO_MM, METERS_TO_MM, METERS_TO_MM);
  merged.computeBoundingBox();
  return merged;
}
