import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { world } from "../store";

/**
 * Calm, fixed camera. Damped toward `world.camTargetZ` (GSAP moves it from
 * the hero position through the door), with gentle mouse parallax. No
 * scroll flight — the page scrolls over the living aurora instead.
 */
export function CameraRig() {
  const look = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const cam = state.camera;
    const px = state.pointer.x;
    const py = state.pointer.y;

    cam.position.z = THREE.MathUtils.damp(cam.position.z, world.camTargetZ, 2, dt);
    cam.position.x = THREE.MathUtils.damp(cam.position.x, px * 0.5, 1.6, dt);
    cam.position.y = THREE.MathUtils.damp(cam.position.y, 0.5 + -py * 0.25, 1.6, dt);

    look.set(cam.position.x * 0.5, 0.25, cam.position.z - 7);
    cam.lookAt(look);
  });

  return null;
}
