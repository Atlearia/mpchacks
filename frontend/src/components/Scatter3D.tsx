import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Line, Html } from "@react-three/drei";
import * as THREE from "three";
import { deptDatePoints, maxDeptMonthTotal } from "../data/selectors";
import { DEPARTMENTS, MONTH_LABELS, MONTH_STARTS } from "../data/dataset";
import { deptColor, fmtUSD } from "../theme";
import { useNav } from "../state/store";

// Half-extents of the 3D plot volume.
// X = department spread, Y = spending (height), Z = date (depth).
const EXTENT = { x: 14, y: 10, z: 10 };

/**
 * Map a data point to scene coordinates.
 *   X  → department index  (left-right)
 *   Y  → value / spending  (floor to ceiling)
 *   Z  → month index       (near-far / depth)
 */
function pos(deptIdx: number, monthIdx: number, value: number, maxVal: number) {
  const x = (deptIdx / (DEPARTMENTS.length - 1) - 0.5) * 2 * EXTENT.x;
  const y = (value / maxVal) * EXTENT.y;                              // 0 at floor, EXTENT.y at ceiling
  const z = (monthIdx / (MONTH_STARTS.length - 1) - 0.5) * 2 * EXTENT.z;
  return [x, y, z] as const;
}

/* ───────────────────────── Interactive data point ───────────────────────── */

function Dot({
  position,
  color,
  label,
  onClick,
}: {
  position: readonly [number, number, number];
  color: string;
  label: string;
  onClick: () => void;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const [hover, setHover] = useState(false);
  useFrame(() => {
    if (!ref.current) return;
    const target = hover ? 1.7 : 1;
    ref.current.scale.lerp(new THREE.Vector3(target, target, target), 0.2);
  });
  return (
    <group position={position as unknown as THREE.Vector3}>
      <mesh
        ref={ref}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = "auto";
        }}
      >
        <sphereGeometry args={[0.42, 24, 24]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hover ? 1.1 : 0.55}
          roughness={0.3}
          metalness={0.1}
        />
      </mesh>
      {/* Vertical drop line to the Y=0 floor for depth perception */}
      <Line
        points={[
          [0, 0, 0],
          [0, -position[1], 0],
        ]}
        color={color}
        transparent
        opacity={0.18}
        lineWidth={1}
      />
      {/* Small dot on the floor where the drop line lands */}
      <mesh position={[0, -position[1], 0]}>
        <sphereGeometry args={[0.14, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} />
      </mesh>
      {hover && (
        <Html position={[0, 1.2, 0]} center distanceFactor={26} zIndexRange={[40, 0]}>
          <div className="dot-tip" style={{ borderColor: color }}>
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}

/* ─────────────────────────── Axis labels ────────────────────────────────── */

function AxisLabels() {
  return (
    <>
      {/* X-axis: department names along the floor front edge */}
      {DEPARTMENTS.map((dept, i) => {
        const [x] = pos(i, 0, 0, 1);
        return (
          <Html
            key={dept}
            position={[x, -0.8, EXTENT.z + 1.6]}
            center
            distanceFactor={30}
          >
            <div className="axis-x" style={{ color: deptColor(dept) }}>
              {dept}
            </div>
          </Html>
        );
      })}

      {/* Z-axis: month labels along the left floor edge (depth) */}
      {MONTH_LABELS.map((label, i) => {
        const [, , z] = pos(0, i, 0, 1);
        return (
          <Html
            key={label}
            position={[-EXTENT.x - 2, -0.8, z]}
            center
            distanceFactor={30}
          >
            <div className="axis-y">{label}</div>
          </Html>
        );
      })}

      {/* Y-axis title: spending (height) */}
      <Html position={[-EXTENT.x - 2, EXTENT.y * 0.55, -EXTENT.z]} center distanceFactor={30}>
        <div className="axis-z">spend ($) ↑</div>
      </Html>
    </>
  );
}

/* ──────────────────────────── Floor grid ────────────────────────────────── */

function FloorGrid() {
  const lines: [number, number, number][][] = [];

  // Grid lines along X for each month
  for (let mi = 0; mi < MONTH_STARTS.length; mi++) {
    const z = (mi / (MONTH_STARTS.length - 1) - 0.5) * 2 * EXTENT.z;
    lines.push([[-EXTENT.x, 0, z], [EXTENT.x, 0, z]]);
  }
  // Grid lines along Z for each department
  for (let di = 0; di < DEPARTMENTS.length; di++) {
    const x = (di / (DEPARTMENTS.length - 1) - 0.5) * 2 * EXTENT.x;
    lines.push([[x, 0, -EXTENT.z], [x, 0, EXTENT.z]]);
  }

  return (
    <>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="#1e2742" lineWidth={1} transparent opacity={0.45} />
      ))}
    </>
  );
}

/* ─────────────────────────── Wireframe box ──────────────────────────────── */

function BoxFrame() {
  const lines: [number, number, number][][] = [];
  const xs = [-EXTENT.x, EXTENT.x];
  const ys = [0, EXTENT.y]; // floor at 0, ceiling at EXTENT.y
  const zs = [-EXTENT.z, EXTENT.z];

  // Horizontal edges (X direction)
  for (const y of ys) for (const z of zs) lines.push([[xs[0], y, z], [xs[1], y, z]]);
  // Depth edges (Z direction)
  for (const x of xs) for (const y of ys) lines.push([[x, y, zs[0]], [x, y, zs[1]]]);
  // Vertical edges (Y direction)
  for (const x of xs) for (const z of zs) lines.push([[x, ys[0], z], [x, ys[1], z]]);

  return (
    <>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="#2a3357" lineWidth={1} transparent opacity={0.4} />
      ))}
    </>
  );
}

/* ──────────────────────────── Y-axis ticks ──────────────────────────────── */

function YAxisTicks({ maxVal }: { maxVal: number }) {
  const tickCount = 4;
  const ticks: { y: number; label: string }[] = [];
  for (let i = 1; i <= tickCount; i++) {
    const frac = i / tickCount;
    ticks.push({
      y: frac * EXTENT.y,
      label: fmtUSD(frac * maxVal),
    });
  }
  return (
    <>
      {ticks.map((t) => (
        <group key={t.label}>
          <Line
            points={[[-EXTENT.x, t.y, -EXTENT.z], [EXTENT.x, t.y, -EXTENT.z]]}
            color="#1e2742"
            lineWidth={1}
            transparent
            opacity={0.2}
          />
          <Html position={[-EXTENT.x - 2.2, t.y, -EXTENT.z]} center distanceFactor={30}>
            <div className="axis-tick">{t.label}</div>
          </Html>
        </group>
      ))}
    </>
  );
}

/* ────────────────────────────── Scene ───────────────────────────────────── */

function Scene() {
  const selectMonth = useNav((s) => s.selectMonth);
  const points = useMemo(() => deptDatePoints(), []);
  const maxVal = useMemo(() => maxDeptMonthTotal() * 1.05, []);

  return (
    <>
      <ambientLight intensity={0.55} />
      <pointLight position={[20, 25, 20]} intensity={1.3} />
      <pointLight position={[-15, 5, -15]} intensity={0.4} color="#7eb3ff" />
      <directionalLight position={[0, 30, 0]} intensity={0.3} />

      {/* Center the plot so it orbits around its visual center (half height) */}
      <group position={[0, -EXTENT.y * 0.45, 0]}>
        <BoxFrame />
        <FloorGrid />
        <AxisLabels />
        <YAxisTicks maxVal={maxVal} />
        {points.map((p) => {
          const di = DEPARTMENTS.indexOf(p.department);
          const mi = MONTH_STARTS.indexOf(p.date);
          return (
            <Dot
              key={`${p.department}-${p.date}`}
              position={pos(di, mi, p.total, maxVal)}
              color={deptColor(p.department)}
              label={`${p.department} · ${p.monthLabel} · ${fmtUSD(p.total)}`}
              onClick={() => selectMonth(p.date)}
            />
          );
        })}
      </group>

      <OrbitControls
        enablePan={false}
        minDistance={18}
        maxDistance={70}
        dampingFactor={0.08}
        // Constrain vertical orbit so user can't flip under the floor
        minPolarAngle={Math.PI * 0.1}
        maxPolarAngle={Math.PI * 0.48}
      />
    </>
  );
}

/* ──────────────────────────── Canvas root ───────────────────────────────── */

export default function Scatter3D() {
  return (
    <Canvas
      camera={{
        // Elevated 3/4 view: slightly right, well above, looking down at ~35-40°.
        // This angle immediately reveals the X=department, Z=date base grid
        // with Y=spending pillars rising from it.
        position: [28, 22, 28],
        fov: 48,
      }}
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
    >
      <color attach="background" args={["#061027"]} />
      <fog attach="fog" args={["#061027", 65, 120]} />
      <Suspense fallback={null}>
        <Scene />
      </Suspense>
    </Canvas>
  );
}
