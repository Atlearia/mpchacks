import { Suspense, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Line, Html } from "@react-three/drei";
import * as THREE from "three";
import { deptDatePoints, maxDeptMonthTotal } from "../data/selectors";
import { DEPARTMENTS, MONTH_LABELS, MONTH_STARTS } from "../data/generate";
import { deptColor, fmtUSD } from "../theme";
import { useNav } from "../state/store";

const GRID = { x: 14, y: 9, z: 9 }; // half-extents of the plot box

// Map a (department index, month index, value) to scene coordinates.
function pos(deptIdx: number, monthIdx: number, value: number, maxVal: number) {
  const x = (deptIdx / (DEPARTMENTS.length - 1) - 0.5) * 2 * GRID.x;
  const y = (monthIdx / (MONTH_STARTS.length - 1) - 0.5) * 2 * GRID.y;
  const z = (value / maxVal) * 2 * GRID.z - GRID.z;
  return [x, y, z] as const;
}

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
      {/* drop line to the department floor for depth perception */}
      <Line
        points={[
          [0, 0, 0],
          [0, 0, -(position[2] + GRID.z)],
        ]}
        color={color}
        transparent
        opacity={0.22}
        lineWidth={1}
      />
      {hover && (
        <Html position={[0, 1, 0]} center distanceFactor={26} zIndexRange={[40, 0]}>
          <div className="dot-tip" style={{ borderColor: color }}>
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}

function AxisLabels() {
  return (
    <>
      {DEPARTMENTS.map((dept, i) => {
        const [x] = pos(i, 0, 0, 1);
        return (
          <Html key={dept} position={[x, -GRID.y - 1.8, -GRID.z]} center distanceFactor={30}>
            <div className="axis-x" style={{ color: deptColor(dept) }}>
              {dept}
            </div>
          </Html>
        );
      })}
      {MONTH_LABELS.map((label, i) => {
        const [, y] = pos(0, i, 0, 1);
        return (
          <Html key={label} position={[-GRID.x - 2.4, y, -GRID.z]} center distanceFactor={30}>
            <div className="axis-y">{label}</div>
          </Html>
        );
      })}
      <Html position={[0, GRID.y + 2.6, -GRID.z]} center distanceFactor={30}>
        <div className="axis-z">spend ($) ↑</div>
      </Html>
    </>
  );
}

function BoxFrame() {
  const lines: [number, number, number][][] = [];
  const xs = [-GRID.x, GRID.x];
  const ys = [-GRID.y, GRID.y];
  const zs = [-GRID.z, GRID.z];
  for (const y of ys) for (const z of zs) lines.push([[xs[0], y, z], [xs[1], y, z]]);
  for (const x of xs) for (const z of zs) lines.push([[x, ys[0], z], [x, ys[1], z]]);
  for (const x of xs) for (const y of ys) lines.push([[x, y, zs[0]], [x, y, zs[1]]]);
  return (
    <>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="#2a3357" lineWidth={1} transparent opacity={0.5} />
      ))}
    </>
  );
}

function Scene() {
  const selectMonth = useNav((s) => s.selectMonth);
  const points = useMemo(() => deptDatePoints(), []);
  const maxVal = useMemo(() => maxDeptMonthTotal() * 1.05, []);

  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (groupRef.current) groupRef.current.rotation.y += delta * 0.04;
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <pointLight position={[20, 20, 20]} intensity={1.2} />
      <pointLight position={[-20, -10, -10]} intensity={0.5} color="#c6a0f6" />
      <group ref={groupRef}>
        <BoxFrame />
        <AxisLabels />
        {points.map((p) => {
          const di = DEPARTMENTS.indexOf(p.department as (typeof DEPARTMENTS)[number]);
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
      <OrbitControls enablePan={false} minDistance={18} maxDistance={70} dampingFactor={0.08} />
    </>
  );
}

export default function Scatter3D() {
  return (
    <Canvas
      camera={{ position: [26, 12, 34], fov: 50 }}
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
    >
      <color attach="background" args={["#07080f"]} />
      <fog attach="fog" args={["#07080f", 60, 110]} />
      <Suspense fallback={null}>
        <Scene />
      </Suspense>
    </Canvas>
  );
}
