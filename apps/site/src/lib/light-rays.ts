// React Bits Light Rays shader, copyright 2026 David Haz.
// License: public/licenses/react-bits-LICENSE.md. Native renderer for the public site.
import vertex from "../assets/light-rays/light-rays.vert?raw";
import fragment from "../assets/light-rays/light-rays.frag?raw";

export function mountLightRays(canvas: HTMLCanvasElement): () => void {
  const host = canvas.parentElement;
  const scene = host?.closest<HTMLElement>(".lp-hero");
  if (!host || !scene) return () => {};
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) return () => {};
  const shaders: WebGLShader[] = [];
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Shader unavailable");
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error("Shader compilation failed");
    return shader;
  };
  const program = gl.createProgram();
  if (!program) return () => {};
  try {
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Shader link failed");
  } catch (error) {
    shaders.forEach((shader) => gl.deleteShader(shader));
    gl.deleteProgram(program);
    throw error;
  }
  gl.useProgram(program);
  shaders.forEach((shader) => {
    gl.detachShader(program, shader);
    gl.deleteShader(shader);
  });
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  const names = [
    "iTime",
    "iResolution",
    "rayPos",
    "rayDir",
    "raysColor",
    "raysSpeed",
    "lightSpread",
    "rayLength",
    "pulsating",
    "fadeDistance",
    "saturation",
    "mousePos",
    "mouseInfluence",
    "noiseAmount",
    "distortion",
    "lightMode",
  ];
  names.forEach((name) => {
    uniforms[name] = gl.getUniformLocation(program, name);
  });
  const set = (name: string, value: number) => gl.uniform1f(uniforms[name], value);
  for (const [name, value] of Object.entries({
    raysSpeed: 1,
    lightSpread: 0.5,
    rayLength: 3,
    pulsating: 0,
    fadeDistance: 1,
    mouseInfluence: 0.1,
    noiseAmount: 0,
    distortion: 0,
  }))
    set(name, value);
  gl.uniform2f(uniforms.rayDir, 0, 1);

  let frame = 0,
    lastFrame = 0,
    time = 3.6;
  let inView = false,
    disposed = false,
    lost = false;
  let target = [0.5, 0.5],
    mouse = [0.5, 0.5];
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = colorCanvas.height = 1;
  const context = colorCanvas.getContext("2d", { willReadFrequently: true });
  const draw = () => {
    if (disposed || lost) return;
    set("iTime", time);
    gl.uniform2f(uniforms.mousePos, mouse[0], mouse[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const resize = () => {
    if (disposed || lost) return;
    const ratio = Math.min(devicePixelRatio || 1, innerWidth < 600 ? 1 : 1.25);
    const width = Math.max(1, Math.round(host.clientWidth * ratio));
    const height = Math.max(1, Math.round(host.clientHeight * ratio));
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.uniform2f(uniforms.iResolution, width, height);
    // Keep the convergence point above the viewport, matching the static fallback.
    gl.uniform2f(uniforms.rayPos, width * 0.5, height * -0.2);
    draw();
  };
  const theme = () => {
    if (disposed || lost) return;
    const dark = document.documentElement.classList.contains("dark");
    if (context) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(document.documentElement)
        .getPropertyValue("--ds-light-ray-color")
        .trim();
      context.fillRect(0, 0, 1, 1);
      const color = context.getImageData(0, 0, 1, 1).data;
      gl.uniform3f(uniforms.raysColor, color[0] / 255, color[1] / 255, color[2] / 255);
    }
    set("lightMode", dark ? 0 : 1);
    set("saturation", dark ? 1 : 0.92);
    draw();
  };
  const running = () => !disposed && !lost && inView && !document.hidden && !reduced.matches;
  const tick = (now: number) => {
    frame = 0;
    if (!running()) return;
    if (now - lastFrame >= 1000 / 30) {
      const elapsed = Math.min((now - lastFrame) / 1000, 0.08);
      time += elapsed;
      lastFrame = now;
      const follow = 1 - Math.pow(0.92, elapsed * 60);
      mouse = mouse.map((value, index) => value + (target[index] - value) * follow);
      draw();
    }
    frame = requestAnimationFrame(tick);
  };
  const sync = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (running()) {
      lastFrame = performance.now();
      frame = requestAnimationFrame(tick);
    } else draw();
  };
  const pointer = (event: PointerEvent) => {
    if (event.pointerType === "touch" || reduced.matches) return;
    const bounds = host.getBoundingClientRect();
    target = [
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
    ];
  };
  const contextLost = () => {
    lost = true;
    host.classList.remove("is-ready");
    sync();
  };
  const intersection = new IntersectionObserver(
    ([entry]) => {
      inView = entry.isIntersecting;
      sync();
    },
    { threshold: 0.05 },
  );
  const sizeObserver = new ResizeObserver(resize);
  const themeObserver = new MutationObserver(theme);
  intersection.observe(scene);
  sizeObserver.observe(host);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  window.addEventListener("pointermove", pointer, { passive: true });
  document.addEventListener("visibilitychange", sync);
  reduced.addEventListener("change", sync);
  canvas.addEventListener("webglcontextlost", contextLost);
  resize();
  theme();
  host.classList.add("is-ready");
  sync();
  return () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    intersection.disconnect();
    sizeObserver.disconnect();
    themeObserver.disconnect();
    window.removeEventListener("pointermove", pointer);
    document.removeEventListener("visibilitychange", sync);
    reduced.removeEventListener("change", sync);
    canvas.removeEventListener("webglcontextlost", contextLost);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    host.classList.remove("is-ready");
  };
}
