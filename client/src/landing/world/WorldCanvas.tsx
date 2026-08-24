import { Canvas, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useEffect } from "react";
import { CameraRig } from "./CameraRig";
import { Aurora } from "./Aurora";

/**
 * Keeps the fixed background canvas alive ON DEMAND only.
 *
 * The canvas uses frameloop="demand", so it renders just one frame when
 * something invalidates it — the user scrolls, moves the mouse, or touches —
 * plus a slow ~8fps drift tick so the light-field still breathes gently.
 * Idle CPU/GPU stays near zero instead of rendering a full-screen shader at
 * 60fps forever. Rendering also pauses entirely while the tab is hidden.
 */
function DemandDriver() {
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    let lastDrift = 0;
    let raf = 0;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // gentle drift — one frame every ~120ms keeps the field alive at a
      // fraction of the cost of a continuous 60fps render loop
      if (now - lastDrift > 120) {
        lastDrift = now;
        invalidate();
      }
    };
    const onInput = () => invalidate();
    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (!raf) {
        lastDrift = 0;
        raf = requestAnimationFrame(tick);
      }
    };

    raf = requestAnimationFrame(tick);
    window.addEventListener("scroll", onInput, { passive: true });
    window.addEventListener("pointermove", onInput, { passive: true });
    window.addEventListener("touchstart", onInput, { passive: true });
    window.addEventListener("touchmove", onInput, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onInput);
      window.removeEventListener("pointermove", onInput);
      window.removeEventListener("touchstart", onInput);
      window.removeEventListener("touchmove", onInput);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [invalidate]);

  return null;
}

/**
 * The fixed background canvas: a flowing light-field that drifts gently
 * behind the whole page. No particles, no solid shapes — just light.
 */
export function WorldCanvas() {
  return (
    <Canvas
      dpr={[1, 1]}
      frameloop="demand"
      camera={{ fov: 55, position: [0, 0.5, 1.1], near: 0.1, far: 80 }}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        alpha: false,
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      style={{ background: "#000000" }}
    >
      <DemandDriver />
      <CameraRig />
      <Aurora />
      <ambientLight intensity={0.55} />
    </Canvas>
  );
}
