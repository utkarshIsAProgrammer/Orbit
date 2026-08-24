import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { CameraRig } from "./CameraRig";
import { Aurora } from "./Aurora";

/**
 * The fixed background canvas: a flowing warm-gold light-field that drifts
 * gently behind the whole page. No particles, no solid shapes — just light.
 */
export function WorldCanvas() {
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ fov: 55, position: [0, 0.5, 1.1], near: 0.1, far: 80 }}
      gl={{
        antialias: true,
        powerPreference: "high-performance",
        alpha: false,
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      style={{ background: "#09090b" }}
    >
      <CameraRig />
      <Aurora />
      <ambientLight intensity={0.55} />
    </Canvas>
  );
}
