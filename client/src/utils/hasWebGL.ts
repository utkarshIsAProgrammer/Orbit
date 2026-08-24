/**
 * Checks if WebGL is supported in the current browser environment.
 * Returns true if WebGL rendering is available, false otherwise.
 * This is useful for gracefully degrading Three.js components in
 * environments like headless Chromium where WebGL may not work.
 */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    const isSupported = !!(gl && gl instanceof WebGLRenderingContext);
    if (gl && (gl as WebGLRenderingContext).getExtension) {
      (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context")?.loseContext();
    }
    return isSupported;
  } catch {
    return false;
  }
}
