import type { MapObject } from "../api";
import { deskPose, worldToMeters } from "../world";

/** Светлый дуб как на референсе. */
const WOOD = "#d2b48c";
const WOOD_EDGE = "#b8956a";
/** Матовый чёрный металл (O-рама). */
const METAL = "#1a1a1a";
const CHROME = "#c5ccd4";
const BLACK = "#1a1d22";
const BLACK_SOFT = "#2a2e34";
const MESH = "#252830";
const GROMMET = "#111111";
const SELECT = "#c4a574";

/** Базовая высота перегородки (128 см) × 3. */
export const DESK_PARTITION_H_M = 1.28 * 3;
/** Базовая высота столешницы (74 см) × 3. */
export const DESK_TOP_H_M = 0.74 * 3;
/** Сиденье: было ~47 см от пола, высота до сидушки × 3. */
export const CHAIR_SEAT_H_M = 0.47 * 3;

function footprint(obj: MapObject) {
  const w = worldToMeters(obj.width);
  const d = worldToMeters(obj.height);
  const x = worldToMeters(obj.x) + w / 2;
  const z = worldToMeters(obj.y) + d / 2;
  const rotY = -((obj.rotation ?? 0) * Math.PI) / 180;
  return { w, d, x, z, rotY };
}

function MetalMat() {
  return (
    <meshStandardMaterial color={METAL} roughness={0.55} metalness={0.35} />
  );
}

function WoodMat({
  selected,
  color = WOOD,
}: {
  selected?: boolean;
  color?: string;
}) {
  return (
    <meshStandardMaterial
      color={color}
      roughness={0.62}
      metalness={0.04}
      emissive={selected ? SELECT : "#000000"}
      emissiveIntensity={selected ? 0.1 : 0}
    />
  );
}

/** Прямоугольная O-рама из квадратной трубы в плоскости YZ. */
function OFrame({
  depth,
  height,
  tube,
}: {
  depth: number;
  height: number;
  tube: number;
}) {
  const innerH = Math.max(tube * 2, height - tube);
  return (
    <group>
      <mesh position={[0, height - tube / 2, 0]} castShadow>
        <boxGeometry args={[tube, tube, depth]} />
        <MetalMat />
      </mesh>
      <mesh position={[0, tube / 2, 0]} castShadow>
        <boxGeometry args={[tube, tube, depth]} />
        <MetalMat />
      </mesh>
      <mesh position={[0, height / 2, depth / 2 - tube / 2]} castShadow>
        <boxGeometry args={[tube, innerH, tube]} />
        <MetalMat />
      </mesh>
      <mesh position={[0, height / 2, -depth / 2 + tube / 2]} castShadow>
        <boxGeometry args={[tube, innerH, tube]} />
        <MetalMat />
      </mesh>
    </group>
  );
}

/**
 * Односторонний стол: перегородка всегда на длинной стороне (deskPose),
 * столешница с одной стороны, чёрные O-рамы.
 */
export function OfficeDeskMesh({
  obj,
  selected,
  onSelect,
}: {
  obj: MapObject;
  selected: boolean;
  onSelect: () => void;
}) {
  const { alongM: along, deepM: deep, rotY } = deskPose(obj);
  const cx = worldToMeters(obj.x) + worldToMeters(obj.width) / 2;
  const cz = worldToMeters(obj.y) + worldToMeters(obj.height) / 2;
  const topY = DESK_TOP_H_M;
  const topT = 0.036 * 3;
  const partitionH = DESK_PARTITION_H_M;
  const partitionT = 0.028 * 3;
  const tube = Math.min(0.045 * 3, Math.min(along, deep) * 0.04);
  const frameInset = tube * 0.5 + 0.02;
  /** Локально: перегородка на −Z (длинная кромка), столешница в +Z. */
  const partitionZ = -deep / 2 + partitionT / 2;
  const topDepth = Math.max(0.3, deep - partitionT - 0.02);
  const topZ = partitionZ + partitionT / 2 + topDepth / 2;
  const grommetR = Math.min(0.05, topDepth * 0.07);
  const frameDepth = topDepth * 0.92;

  return (
    <group
      position={[cx, 0, cz]}
      rotation={[0, rotY, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <mesh position={[0, topY, topZ]} castShadow>
        <boxGeometry args={[along, topT, topDepth]} />
        <WoodMat selected={selected} />
      </mesh>

      <mesh position={[0, partitionH / 2, partitionZ]} castShadow>
        <boxGeometry args={[along, partitionH, partitionT]} />
        <WoodMat selected={selected} color={WOOD_EDGE} />
      </mesh>

      {(
        [
          [-along * 0.22, partitionZ + partitionT / 2 + topDepth * 0.18],
          [along * 0.22, partitionZ + partitionT / 2 + topDepth * 0.18],
        ] as const
      ).map(([gx, gz], i) => (
        <mesh
          key={i}
          position={[gx, topY + topT / 2 + 0.001, gz]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[grommetR, 16]} />
          <meshStandardMaterial color={GROMMET} roughness={0.7} metalness={0.1} />
        </mesh>
      ))}

      <group position={[-along / 2 + frameInset, 0, topZ]}>
        <OFrame depth={frameDepth} height={topY} tube={tube} />
      </group>
      <group position={[along / 2 - frameInset, 0, topZ]}>
        <OFrame depth={frameDepth} height={topY} tube={tube} />
      </group>
    </group>
  );
}

/**
 * Стол без перегородки.
 * geometry: только столешница + ножки (O-рамы).
 */
export function OfficePlainDeskMesh({
  obj,
  selected,
  onSelect,
}: {
  obj: MapObject;
  selected: boolean;
  onSelect: () => void;
}) {
  const { alongM: along, deepM: deep, rotY } = deskPose(obj);
  const cx = worldToMeters(obj.x) + worldToMeters(obj.width) / 2;
  const cz = worldToMeters(obj.y) + worldToMeters(obj.height) / 2;

  const topY = DESK_TOP_H_M;
  const topT = 0.036 * 3;

  const tube = Math.min(0.045 * 3, Math.min(along, deep) * 0.04);
  const frameInset = tube * 0.5 + 0.02;
  const frameDepth = deep * 0.92;

  return (
    <group
      position={[cx, 0, cz]}
      rotation={[0, rotY, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <mesh position={[0, topY, 0]} castShadow>
        <boxGeometry args={[along, topT, deep]} />
        <WoodMat selected={selected} />
      </mesh>

      <group position={[-along / 2 + frameInset, 0, 0]}>
        <OFrame depth={frameDepth} height={topY} tube={tube} />
      </group>
      <group position={[along / 2 - frameInset, 0, 0]}>
        <OFrame depth={frameDepth} height={topY} tube={tube} />
      </group>
    </group>
  );
}

/** Офисное кресло как раньше по виду; высота от ножек до сидушки × 3. */
export function OfficeChairMesh({
  obj,
  selected,
  onSelect,
}: {
  obj: MapObject;
  selected: boolean;
  onSelect: () => void;
}) {
  const { w, d, x, z, rotY } = footprint(obj);
  const s = Math.min(w, d);
  const seatY = CHAIR_SEAT_H_M;
  const seatW = s * 0.48;
  const seatD = s * 0.46;
  const backH = s * 0.55;
  const stemH = Math.max(0.2, seatY - 0.08);

  return (
    <group
      position={[x, 0, z]}
      rotation={[0, rotY, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <mesh position={[0, seatY, 0.02]} castShadow>
        <boxGeometry args={[seatW, 0.08, seatD]} />
        <meshStandardMaterial
          color={BLACK_SOFT}
          roughness={0.75}
          metalness={0.05}
          emissive={selected ? SELECT : "#000000"}
          emissiveIntensity={selected ? 0.14 : 0}
        />
      </mesh>

      <mesh position={[0, seatY + backH * 0.35, -seatD * 0.42]} castShadow>
        <boxGeometry args={[seatW * 0.9, backH * 0.7, 0.04]} />
        <meshStandardMaterial
          color={MESH}
          roughness={0.85}
          metalness={0.08}
          transparent
          opacity={0.85}
        />
      </mesh>
      <mesh position={[0, seatY + backH * 0.78, -seatD * 0.42]} castShadow>
        <boxGeometry args={[seatW * 0.72, backH * 0.22, 0.05]} />
        <meshStandardMaterial color={BLACK} roughness={0.55} metalness={0.1} />
      </mesh>

      {([-1, 1] as const).map((side) => (
        <group key={side}>
          <mesh position={[side * seatW * 0.52, seatY + 0.12, -0.02]} castShadow>
            <boxGeometry args={[0.04, 0.04, seatD * 0.55]} />
            <meshStandardMaterial color={BLACK} roughness={0.5} metalness={0.15} />
          </mesh>
          <mesh position={[side * seatW * 0.52, seatY - stemH * 0.15, 0.05]}>
            <cylinderGeometry args={[0.012, 0.012, stemH * 0.35, 8]} />
            <meshStandardMaterial color={CHROME} metalness={0.9} roughness={0.2} />
          </mesh>
        </group>
      ))}

      <mesh position={[0, stemH / 2, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.04, stemH, 12]} />
        <meshStandardMaterial color={CHROME} metalness={0.9} roughness={0.22} />
      </mesh>

      {[0, 72, 144, 216, 288].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const len = s * 0.32;
        return (
          <group key={deg} rotation={[0, rad, 0]}>
            <mesh position={[len / 2, 0.06, 0]} castShadow>
              <boxGeometry args={[len, 0.035, 0.045]} />
              <meshStandardMaterial
                color={CHROME}
                metalness={0.88}
                roughness={0.25}
              />
            </mesh>
            <mesh
              position={[len, 0.045, 0]}
              rotation={[Math.PI / 2, 0, 0]}
              castShadow
            >
              <cylinderGeometry args={[0.035, 0.035, 0.05, 10]} />
              <meshStandardMaterial color={BLACK} roughness={0.6} metalness={0.2} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
