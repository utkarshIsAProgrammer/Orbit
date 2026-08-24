import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { hasWebGL } from "../utils/hasWebGL";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface BackgroundGradientsProps {
}

/**
 * Liquid-obsidian WebGL background (ported from orbit-client-main).
 *
 * Performance notes (the "why"):
 * - The wave math runs in the GPU VERTEX SHADER (onBeforeCompile), so the
 *   main thread never touches geometry — no per-frame vertex loop, no
 *   computeVertexNormals(). The render loop just advances the time uniform
 *   and draws, so it comfortably runs at 60fps on desktop.
 * - `transmission` stays on (it's part of the original look) — the opaque
 *   canvas keeps it from ever washing out.
 * - Adaptive pixel ratio: a FPS watchdog steps the resolution down if the
 *   GPU struggles and back up when it recovers.
 * - The static CSS glow layers are plain radial-gradients (no `blur()`
 *   filter), so the compositor doesn't re-blur huge areas every frame.
 */
export default function BackgroundGradients({}: BackgroundGradientsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseCoordsRef = useRef({ x: 0, y: 0 });
  const interpMouseRef = useRef({ x: 0, y: 0 });
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 768 || window.matchMedia("(pointer: coarse)").matches;
  });

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(
        window.innerWidth < 768 ||
        window.matchMedia("(pointer: coarse)").matches
      );
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    if (isMobile) return;
    const handleMouseMove = (e: MouseEvent) => {
      // Normalize coordinate drift (-1 to 1)
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = -(e.clientY / window.innerHeight) * 2 + 1;
      mouseCoordsRef.current = { x, y };
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasWebGL()) return;

    let width = window.innerWidth;
    let height = window.innerHeight;

    // 1. Initialize ThreeJS Scene
    const scene = new THREE.Scene();

    // 2. Camera Setup
    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 1000);
    camera.position.set(0, 0, 24);

    // 3. WebGL Renderer with High-Reflectivity Glass configurations (wrapped in try-catch for headless compat)
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        // Opaque canvas — with alpha:true, a transmission material samples
        // the transparent clear color and washes out white. Opaque keeps
        // the obsidian look and makes the canvas itself the black base.
        alpha: false,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      // WebGL not available (e.g. headless Chromium)
      return;
    }

    // Adaptive pixel ratio — start high, let the FPS watchdog tune it.
    const MAX_PIXEL_RATIO = isMobile ? 1.0 : 1.5;
    let pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);
    // Match the obsidian material so the canvas never flashes white.
    renderer.setClearColor(0x0c0c13, 1);

    const gl = renderer.getContext();
    if (gl) gl.getExtension("EXT_float_blend");

    // 4. Create Liquid Glass Organic Wave Mesh
    // Original density (restored) — the displacement runs on the GPU so it
    // stays smooth without any main-thread cost.
    const cols = isMobile ? 14 : 24;
    const rows = isMobile ? 10 : 18;
    const geometry = new THREE.PlaneGeometry(60, 42, cols, rows);

    // Premium glossy space-liquid material — original recipe restored
    // exactly (transmission included, since the opaque canvas keeps it dark).
    const material = new THREE.MeshPhysicalMaterial({
      color: 0x0c0c13, // Obsidian black core
      roughness: 0.08,
      metalness: 0.82, // metallic dark liquid sheen
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      transmission: 0.08, // solid obsidian reflecting environment
      ior: 1.55, // realistic reflective refractions
      thickness: 1.5,
      specularIntensity: 1.8, // crisp highlights on wave peaks
      flatShading: false,
    });

    // ── GPU-side liquid simulation ─────────────────────────────────────
    // The wave + mouse-ripple math runs in the vertex shader. Normals are
    // rebuilt analytically (finite differences of the wave function) so
    // lighting stays correct without ever touching the CPU geometry.
    const shaderUniforms = {
      uLiquidTime: { value: 0 },
      uLiquidMouse: { value: new THREE.Vector2(0, 0) },
    };

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uLiquidTime = shaderUniforms.uLiquidTime;
      shader.uniforms.uLiquidMouse = shaderUniforms.uLiquidMouse;

      // Shared wave function + inputs injected at the top of the vertex stage.
      const liquidGlsl = /* glsl */ `
        uniform float uLiquidTime;
        uniform vec2 uLiquidMouse;

        float liquidWave(vec2 p) {
          float t = uLiquidTime;
          // EXACT original wave math — w1+w2+w3+ripple only (no extra swell,
          // so the pattern matches the pre-upgrade background exactly).
          float w1 = sin(p.x * 0.12 + t) * 1.6;
          float w2 = cos(p.y * 0.14 + t * 1.15) * 1.6;
          float w3 = sin((p.x + p.y) * 0.07 + t * 0.72) * 1.25;
          float dist = distance(p, uLiquidMouse);
          float ripple = sin(dist * 0.28 - t * 2.8) * max(0.0, 4.5 - dist * 0.15) * 0.35;
          return w1 + w2 + w3 + ripple;
        }
      `;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${liquidGlsl}`)
        // Displace the plane along Z — pure GPU, zero main-thread work.
        .replace(
          "#include <displacementmap_vertex>",
          `#include <displacementmap_vertex>
          transformed.z += liquidWave(transformed.xy);`,
        )
        // Rebuild the geometric normal from the displaced surface so the
        // clearcoat + env reflections light the waves correctly.
        // NOTE: in three 0.184 `normal_vertex` runs BEFORE `begin_vertex`,
        // so only the `position` attribute + `normalMatrix` are available
        // here — no `transformed`/`mvPosition` yet.
        .replace(
          "#include <normal_vertex>",
          /* glsl */ `
          vec2 lp = position.xy;
          float h0 = liquidWave(lp);
          float eps = 0.08;
          float hx = liquidWave(lp + vec2(eps, 0.0));
          float hy = liquidWave(lp + vec2(0.0, eps));
          vec3 liquidN = normalize(vec3((h0 - hx) / eps, (h0 - hy) / eps, 1.0));
          vNormal = normalize(normalMatrix * liquidN);`,
        );
    };

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // 5. Lighting — neutral white/zinc only (strict black/white palette).
    const ambientLight = new THREE.AmbientLight(0x1c1c24, 1.3);
    scene.add(ambientLight);

    const keyLight = new THREE.SpotLight(0xffffff, 320, 150, Math.PI / 3, 0.6, 1.2);
    keyLight.position.set(-15, 15, 10);
    scene.add(keyLight);

    const fillLight = new THREE.SpotLight(0xf4f4f5, 240, 150, Math.PI / 3, 0.6, 1.2);
    fillLight.position.set(15, -15, 10);
    scene.add(fillLight);

    const rimLight = new THREE.SpotLight(0x9ca3af, 250, 150, Math.PI / 3, 0.6, 1.2);
    rimLight.position.set(5, 5, 12);
    scene.add(rimLight);

    // 6. Timer for smooth time-based animation increments
    const timer = new THREE.Timer();
    timer.connect(document);

    // 7. Handle Window Resize
    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener("resize", handleResize);

    // 8. Performance guards: pause when hidden, adaptive resolution.
    let tabHidden = false;
    let contextLost = false;

    const handleVisibility = () => {
      tabHidden = document.hidden;
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // FPS watchdog — if the GPU can't hold ~55fps, step the pixel ratio
    // down (each step ≈ halved fill cost); restore it when it recovers.
    const ratios = isMobile
      ? [1.0, 0.9, 0.75, 0.6]
      : [1.5, 1.25, 1.0, 0.8, 0.65];
    let ratioIndex = ratios.indexOf(pixelRatio);
    if (ratioIndex < 0) ratioIndex = 0;
    let fpsFrames = 0;
    let lastFpsTime = performance.now();

    // 9. Main Render Loop — waves are GPU-side, so render every frame.
    let animationFrameId: number;

    const animateScene = (timestamp?: number) => {
      // Pause entirely when tab is hidden — saves GPU + CPU
      if (tabHidden) {
        animationFrameId = requestAnimationFrame(animateScene);
        return;
      }

      // WebGL context lost (GPU reset / driver hiccup) — pause the loop;
      // onContextRestored restarts it when the browser recovers.
      if (contextLost) {
        animationFrameId = requestAnimationFrame(animateScene);
        return;
      }

      timer.update(timestamp);
      const timeVal = timer.getElapsed() * 0.45;

      // Smooth mouse coordinate interpolation for organic response dynamics
      interpMouseRef.current.x += (mouseCoordsRef.current.x - interpMouseRef.current.x) * 0.05;
      interpMouseRef.current.y += (mouseCoordsRef.current.y - interpMouseRef.current.y) * 0.05;

      // Slight rotation of the mesh to mimic space-flow dynamics
      mesh.rotation.y = interpMouseRef.current.x * 0.14;
      mesh.rotation.x = -interpMouseRef.current.y * 0.14;

      // Subtle mouse-follow on the lights — no orbiting corner sweeps.
      keyLight.position.x = -15 + interpMouseRef.current.x * 8;
      keyLight.position.y = 15 + interpMouseRef.current.y * 8;

      fillLight.position.x = 15 + interpMouseRef.current.x * 8;
      fillLight.position.y = -15 + interpMouseRef.current.y * 8;

      // Feed the shader: time + mouse ripple center (plane units).
      shaderUniforms.uLiquidTime.value = timeVal;
      shaderUniforms.uLiquidMouse.value.set(
        interpMouseRef.current.x * 20,
        interpMouseRef.current.y * 15,
      );

      renderer.render(scene, camera);

      // Adaptive resolution watchdog (evaluated ~once per second)
      fpsFrames++;
      const now = performance.now();
      const elapsed = now - lastFpsTime;
      if (elapsed >= 1000) {
        const fps = (fpsFrames * 1000) / elapsed;
        if (fps < 38 && ratioIndex < ratios.length - 1) {
          ratioIndex++;
          renderer.setPixelRatio(ratios[ratioIndex]);
        } else if (fps > 56 && ratioIndex > 0) {
          ratioIndex--;
          renderer.setPixelRatio(ratios[ratioIndex]);
        }
        fpsFrames = 0;
        lastFpsTime = now;
      }

      animationFrameId = requestAnimationFrame(animateScene);
    };

    animateScene();

    // React StrictMode double-mounts effects in dev on the SAME canvas.
    // NEVER call renderer.forceContextLoss() in cleanup — it poisons the
    // canvas so the remount's renderer lands on a lost context (the
    // "THREE.WebGLRenderer: Context Lost" console spam). Instead, pause
    // gracefully if the GPU genuinely drops the context and resume when
    // the browser restores it.
    const onContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
      cancelAnimationFrame(animationFrameId);
    };
    const onContextRestored = () => {
      contextLost = false;
      animateScene();
    };
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    canvas.addEventListener("webglcontextrestored", onContextRestored, false);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("resize", handleResize);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      timer.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 -z-30 select-none pointer-events-none bg-[#000000] overflow-hidden"
    >
      {/* High-Contrast grid network lines layer (underneath water, highly translucent) */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.005)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.005)_1px,transparent_1px)] bg-size[50px_50px] opacity-10" />

      {/* Static ambient glows — plain radial-gradients (no blur() filter,
          so the compositor never re-blurs these areas). Neutral zinc only. */}
      <div className="absolute w-[60vw] h-[60vw] max-w-150 max-h-150 rounded-full opacity-8 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.05),rgba(39,39,42,0.06)_40%,transparent_72%)] left-[15%] top-[10%]" />
      <div className="absolute w-[50vw] h-[50vw] max-w-125 max-h-125 rounded-full opacity-8 bg-[radial-gradient(circle_at_50%_50%,rgba(180,180,190,0.05),rgba(24,24,27,0.06)_42%,transparent_72%)] right-[15%] bottom-[10%]" />

      {/* WebGL ThreeJS Liquid Canvas — GPU-side waves, adaptive resolution */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />
    </div>
  );
}
