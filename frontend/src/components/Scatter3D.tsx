import {
  Suspense,
  useMemo,
  useRef,
  useState,
  useCallback,
  useEffect,
  type RefObject,
} from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, Line, Html } from "@react-three/drei";
import * as THREE from "three";
import { deptDatePoints, maxDeptMonthTotal } from "../data/selectors";
import { DEPARTMENTS, MONTH_LABELS, MONTH_STARTS } from "../data/dataset";
import { deptColor, fmtUSD } from "../theme";
import { useNav } from "../state/store";
import { usePolicy } from "../data/policy";

// Half-extents of the 3D plot volume.
// X = department spread, Y = spending (height), Z = date (depth).
const EXTENT = { x: 14, y: 10, z: 10 };

const INITIAL_CAMERA = {
  position: new THREE.Vector3(28, 22, 28),
  target: new THREE.Vector3(0, 0, 0),
};

/**
 * Finance-grade metallic palette — think Bloomberg terminal meets
 * premium data viz. Deep metallics with subtle luminous glow.
 */
const FINANCE_TONES = [
  "#1a3a5c", // deep steel blue
  "#2c4a3e", // dark jade
  "#3d2e5c", // midnight plum
  "#1e4d4d", // dark teal
  "#4a3520", // dark bronze
  "#1c3d6e", // navy sapphire
  "#3a2a2a", // dark garnet
  "#1a4050", // deep petrol
  "#2d2850", // dark amethyst
];

const FINANCE_EMISSIVES = [
  "#4da6ff", // steel glow
  "#50d4a0", // jade glow
  "#9b7aff", // plum glow
  "#5ce0d0", // teal glow
  "#e8a54d", // bronze glow
  "#5f9aff", // sapphire glow
  "#ff7070", // garnet glow
  "#60c8e0", // petrol glow
  "#8a6fff", // amethyst glow
];

const _hc = new THREE.Color();
function nodeColor(deptIdx: number, ratio: number): { base: string; emissive: string } {
  const idx = deptIdx % FINANCE_TONES.length;
  const base = FINANCE_TONES[idx];
  const emissive = FINANCE_EMISSIVES[idx];
  // If over budget, shift towards a warmer/hotter variant
  if (ratio > 1.0) {
    _hc.set(base);
    _hc.lerp(new THREE.Color("#5c1010"), Math.min((ratio - 1) * 0.6, 0.5));
    return { base: `#${_hc.getHexString()}`, emissive };
  }
  return { base, emissive };
}

/**
 * Map a data point to scene coordinates.
 *   X  → department index  (left-right)
 *   Y  → value / spending  (floor to ceiling)
 *   Z  → month index       (near-far / depth)
 */
function pos(deptIdx: number, monthIdx: number, value: number, maxVal: number) {
  const x = (deptIdx / (DEPARTMENTS.length - 1) - 0.5) * 2 * EXTENT.x;
  const y = (value / maxVal) * EXTENT.y;
  const z = (monthIdx / (MONTH_STARTS.length - 1) - 0.5) * 2 * EXTENT.z;
  return [x, y, z] as const;
}

/* ───────────────────────── Interactive data point ───────────────────────── */

function Dot({
  position,
  color,
  baseColor,
  emissiveColor,
  label,
  department,
  amount,
  onClick,
}: {
  position: readonly [number, number, number];
  color: string;
  baseColor: string;
  emissiveColor: string;
  label: string;
  department: string;
  amount: number;
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
        <sphereGeometry args={[0.44, 32, 32]} />
        <meshStandardMaterial
          color={baseColor}
          emissive={emissiveColor}
          emissiveIntensity={hover ? 1.1 : 0.45}
          roughness={0.08}
          metalness={0.85}
          envMapIntensity={2.0}
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
        opacity={0.12}
        lineWidth={1}
      />
      {/* Small dot on the floor where the drop line lands */}
      <mesh position={[0, -position[1], 0]}>
        <sphereGeometry args={[0.10, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.25} />
      </mesh>
      {hover && (
        <Html position={[0, 1.2, 0]} center distanceFactor={26} zIndexRange={[40, 0]}>
          <div className="dot-tip-finance" style={{ borderColor: color }}>
            <div className="dot-tip-dept" style={{ color }}>{department}</div>
            <div className="dot-tip-amount">{fmtUSD(amount)}</div>
          </div>
        </Html>
      )}
    </group>
  );
}

/* ───────────────── Continuous budget boundary plane ────────────────────── */

function BudgetPlane({ y }: { y: number }) {
  return (
    <group position={[0, y, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2 * EXTENT.x + 2, 2 * EXTENT.z + 2]} />
        <meshStandardMaterial
          color="#ff2040"
          emissive="#ff2040"
          emissiveIntensity={0.12}
          transparent
          opacity={0.06}
          roughness={0.6}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <Line
        points={[
          [-(EXTENT.x + 1), 0.02, -(EXTENT.z + 1)],
          [(EXTENT.x + 1), 0.02, -(EXTENT.z + 1)],
          [(EXTENT.x + 1), 0.02, (EXTENT.z + 1)],
          [-(EXTENT.x + 1), 0.02, (EXTENT.z + 1)],
          [-(EXTENT.x + 1), 0.02, -(EXTENT.z + 1)],
        ]}
        color="#ff3050"
        lineWidth={1}
        transparent
        opacity={0.18}
      />
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

      {/* Y-axis: removed "spend ($)" text per requirements */}
    </>
  );
}

/* ──────────────────────────── Floor grid ────────────────────────────────── */

function FloorGrid() {
  const lines: [number, number, number][][] = [];

  for (let mi = 0; mi < MONTH_STARTS.length; mi++) {
    const z = (mi / (MONTH_STARTS.length - 1) - 0.5) * 2 * EXTENT.z;
    lines.push([[-EXTENT.x, 0, z], [EXTENT.x, 0, z]]);
  }
  for (let di = 0; di < DEPARTMENTS.length; di++) {
    const x = (di / (DEPARTMENTS.length - 1) - 0.5) * 2 * EXTENT.x;
    lines.push([[x, 0, -EXTENT.z], [x, 0, EXTENT.z]]);
  }

  return (
    <>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="#1a3a6a" lineWidth={1} transparent opacity={0.4} />
      ))}
    </>
  );
}

/* ─────────────────────────── Wireframe box ──────────────────────────────── */

function BoxFrame() {
  const lines: [number, number, number][][] = [];
  const xs = [-EXTENT.x, EXTENT.x];
  const ys = [0, EXTENT.y];
  const zs = [-EXTENT.z, EXTENT.z];

  for (const y of ys) for (const z of zs) lines.push([[xs[0], y, z], [xs[1], y, z]]);
  for (const x of xs) for (const y of ys) lines.push([[x, y, zs[0]], [x, y, zs[1]]]);
  for (const x of xs) for (const z of zs) lines.push([[x, ys[0], z], [x, ys[1], z]]);

  return (
    <>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color="#1e3f72" lineWidth={1} transparent opacity={0.35} />
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
            color="#1a3a6a"
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

/* ────────────────────── Camera zoom animator ──────────────────────────── */

/**
 * When a point is clicked, smoothly fly the camera toward the clicked data
 * point at a 90% offset from both price (Y) and department (X), creating a
 * "cinematic zoom" before transitioning to the bar chart view.
 */
function CameraAnimator({
  target,
  onComplete,
}: {
  target: { x: number; y: number; z: number } | null;
  onComplete: () => void;
}) {
  const { camera } = useThree();
  const progressRef = useRef(0);
  const startPosRef = useRef(new THREE.Vector3());
  const targetPosRef = useRef(new THREE.Vector3());
  const animatingRef = useRef(false);
  const prevTarget = useRef<{ x: number; y: number; z: number } | null>(null);

  if (!target) {
    prevTarget.current = null;
    animatingRef.current = false;
  } else if (target !== prevTarget.current) {
    prevTarget.current = target;
    startPosRef.current.copy(camera.position);
    // Position camera at 90% from the data point — looking at it from
    // a close, elevated angle that shows price and department context
    targetPosRef.current.set(
      target.x + 6,
      target.y + 4,
      target.z + 8
    );
    progressRef.current = 0;
    animatingRef.current = true;
  }

  useFrame((_, delta) => {
    if (!animatingRef.current || !target) return;
    progressRef.current += delta * 1.5; // ~0.67s total animation
    const t = Math.min(progressRef.current, 1);
    // Smooth ease-in-out
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    camera.position.lerpVectors(startPosRef.current, targetPosRef.current, ease);
    camera.lookAt(target!.x, target!.y * 0.7, target!.z);

    if (t >= 1) {
      animatingRef.current = false;
      onComplete();
    }
  });

  return null;
}

/**
 * When backing out of a drill-down, fly the camera back to the view that was
 * saved at orb-click time (before the zoom-in animation finished).
 */
function CameraZoomHome({
  active,
  controlsRef,
  onComplete,
}: {
  active: boolean;
  controlsRef: RefObject<OrbitControlsImpl | null>;
  onComplete: () => void;
}) {
  const { camera } = useThree();
  const progressRef = useRef(0);
  const startPosRef = useRef(new THREE.Vector3());
  const endPosRef = useRef(new THREE.Vector3());
  const startTargetRef = useRef(new THREE.Vector3());
  const endTargetRef = useRef(new THREE.Vector3());
  const animatingRef = useRef(false);
  const prevActive = useRef(false);

  useFrame((_, delta) => {
    const controls = controlsRef.current;

    if (active && !prevActive.current) {
      if (!controls) return;
      prevActive.current = true;
      startPosRef.current.copy(camera.position);
      startTargetRef.current.copy(controls.target);
      endPosRef.current.copy(controls.position0);
      endTargetRef.current.copy(controls.target0);
      progressRef.current = 0;
      animatingRef.current = true;
    } else if (!active) {
      prevActive.current = false;
      animatingRef.current = false;
    }

    if (!animatingRef.current || !controls) return;

    progressRef.current += delta * 1.5;
    const t = Math.min(progressRef.current, 1);
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    camera.position.lerpVectors(startPosRef.current, endPosRef.current, ease);
    controls.target.lerpVectors(startTargetRef.current, endTargetRef.current, ease);
    controls.update();

    if (t >= 1) {
      animatingRef.current = false;
      const wasDamping = controls.enableDamping;
      controls.enableDamping = false;
      controls.reset();
      controls.update();
      controls.enableDamping = wasDamping;
      onComplete();
    }
  });

  return null;
}

/* ────────────────────────────── Scene ───────────────────────────────────── */

function Scene() {
  const view = useNav((s) => s.view);
  const selectMonth = useNav((s) => s.selectMonth);
  const budgets = usePolicy((s) => s.config.departmentBudgets);
  const points = useMemo(() => deptDatePoints(), []);
  const maxVal = useMemo(() => maxDeptMonthTotal() * 1.05, []);

  const [zoomTarget, setZoomTarget] = useState<{
    x: number;
    y: number;
    z: number;
    monthStart: string;
  } | null>(null);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const [zoomingHome, setZoomingHome] = useState(false);
  const prevViewRef = useRef(view);

  useEffect(() => {
    if (view === "galaxy" && prevViewRef.current !== "galaxy") {
      setZoomTarget(null);
      setZoomingHome(true);
    }
    prevViewRef.current = view;
  }, [view]);

  const handleZoomHomeComplete = useCallback(() => {
    setZoomingHome(false);
  }, []);

  const handleDotClick = useCallback(
    (monthStart: string, dotPos: readonly [number, number, number]) => {
      // Snapshot the current orbit view before the zoom animation moves the camera.
      controlsRef.current?.saveState();
      setZoomTarget({
        x: dotPos[0],
        y: dotPos[1],
        z: dotPos[2],
        monthStart,
      });
    },
    []
  );

  const handleZoomComplete = useCallback(() => {
    if (zoomTarget) {
      selectMonth(zoomTarget.monthStart);
      setZoomTarget(null);
    }
  }, [zoomTarget, selectMonth]);

  return (
    <>
      <ambientLight intensity={0.6} />
      <pointLight position={[20, 25, 20]} intensity={1.8} />
      <pointLight position={[-15, 5, -15]} intensity={0.4} color="#4da6ff" />
      <directionalLight position={[0, 30, 0]} intensity={0.3} />
      {/* Subtle rim light for metallic feel */}
      <pointLight position={[0, -5, 20]} intensity={0.25} color="#e8a54d" />

      <CameraAnimator
        target={zoomTarget}
        onComplete={handleZoomComplete}
      />
      <CameraZoomHome
        active={zoomingHome}
        controlsRef={controlsRef}
        onComplete={handleZoomHomeComplete}
      />

      {/* Center the plot so it orbits around its visual center (half height) */}
      <group position={[0, -EXTENT.y * 0.45, 0]}>
        <BoxFrame />
        <FloorGrid />
        <AxisLabels />
        <YAxisTicks maxVal={maxVal} />

        {/* Continuous budget boundary plane at average budget height */}
        {(() => {
          const budgetVals = DEPARTMENTS.map(d => budgets[d] ?? 0).filter(b => b > 0);
          if (budgetVals.length === 0) return null;
          const avgBudget = budgetVals.reduce((a, b) => a + b, 0) / budgetVals.length;
          const y = Math.min(avgBudget / maxVal, 1.12) * EXTENT.y;
          return <BudgetPlane y={y} />;
        })()}

        {points.map((p) => {
          const di = DEPARTMENTS.indexOf(p.department);
          const mi = MONTH_STARTS.indexOf(p.date);
          const budget = budgets[p.department] ?? 0;
          const ratio = budget > 0 ? p.total / budget : 0;
          const { base, emissive } = nodeColor(di, ratio);
          const dotPos = pos(di, mi, p.total, maxVal);
          return (
            <Dot
              key={`${p.department}-${p.date}`}
              position={dotPos}
              color={deptColor(p.department)}
              baseColor={base}
              emissiveColor={emissive}
              label={`${p.department} · ${p.monthLabel} · ${fmtUSD(p.total)}`}
              department={p.department}
              amount={p.total}
              onClick={() => handleDotClick(p.date, dotPos)}
            />
          );
        })}
      </group>

      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        minDistance={18}
        maxDistance={70}
        dampingFactor={0.08}
        minPolarAngle={Math.PI * 0.1}
        maxPolarAngle={Math.PI * 0.48}
        enabled={!zoomTarget && !zoomingHome}
      />
    </>
  );
}

/* ──────────────────────────── Canvas root ───────────────────────────────── */

export default function Scatter3D() {
  return (
    <Canvas
      camera={{
        position: INITIAL_CAMERA.position.toArray(),
        fov: 48,
      }}
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
    >
      <color attach="background" args={["#0a1628"]} />
      <fog attach="fog" args={["#0a1628", 70, 130]} />
      <Suspense fallback={null}>
        <Scene />
      </Suspense>
    </Canvas>
  );
}
