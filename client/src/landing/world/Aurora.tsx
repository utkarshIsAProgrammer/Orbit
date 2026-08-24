import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { world } from "../store";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uMouse;
uniform float uScroll;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(3.7, 1.9);
    a *= 0.5;
  }
  return v;
}

void main() {
  // mouse parallax on the light fields — responsive, clearly alive
  vec2 uv = vUv + uMouse * vec2(0.13, 0.09);

  // slow breathing zoom so the field never sits still
  float zoom = 1.0 + 0.05 * sin(uTime * 0.14);
  uv = (uv - 0.5) * zoom + 0.5;

  // time speeds up with scroll velocity — a soft surge, kept gentle
  float t = uTime * (0.05 + uScroll * 0.32);
  vec2 p = uv * 1.9;

  float n1 = fbm(p + vec2(t, t * 0.7));
  float n2 = fbm(p * 1.45 - vec2(t * 0.8, t * 0.5) + n1 * 0.6);
  float n3 = fbm(p * 2.3 + vec2(-t * 0.5, t * 0.45) + n2 * 0.4);
  // fast shimmer layer — moves quicker than the rest for visible life
  float n4 = fbm(p * 3.2 - vec2(t * 1.7, t * 1.1) + n2 * 0.5);

  // deep black base (the app's stellar #000000)
  vec3 col = vec3(0.02, 0.02, 0.022);

  // stellar light washes — neutral white/zinc only, like the app's
  // stellar animation: strict black/white palette
  col += vec3(1.0, 1.0, 1.0) * smoothstep(0.52, 0.98, n1) * 0.10;
  col += vec3(0.86, 0.86, 0.9) * smoothstep(0.5, 0.94, n2) * 0.08;
  col += vec3(0.72, 0.72, 0.78) * smoothstep(0.52, 0.98, n3) * 0.05;
  col += vec3(0.95, 0.95, 0.98) * smoothstep(0.58, 0.98, n4) * 0.04;

  // soft vignette — edges settle into darkness
  float vig = 1.0 - length(vUv - 0.5) * 0.78;
  col *= smoothstep(0.18, 1.0, vig);

  // subtle grain
  float g = hash(vUv * vec2(1200.0, 700.0) + uTime * 0.6) - 0.5;
  col += g * 0.02;

  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Background: a living, flowing field of warm golden light — soft washes
 * drifting over deep zinc, calm and peaceful. No shapes, no particles —
 * just light. It breathes, shimmers, and leans toward the cursor.
 */
export function Aurora() {
  const mat = useRef<THREE.ShaderMaterial>(null!);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uScroll: { value: 0 },
    }),
    [],
  );

  useFrame((state) => {
    const m = mat.current;
    if (!m) return;
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uMouse.value.set(state.pointer.x, state.pointer.y);
    // damp toward the page's scroll velocity (set in App.tsx)
    uniforms.uScroll.value += (world.scrollVel - uniforms.uScroll.value) * 0.07;
  });

  return (
    <mesh frustumCulled={false} renderOrder={-999} raycast={() => null}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={mat}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
