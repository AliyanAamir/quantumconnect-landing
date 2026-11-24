// Raw WebGL pixel field behind the protocol section. A quantised grid of cells, lit by
// slow noise and by a trail of the last pointer positions, so pixels follow the cursor.
const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`
const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform vec3 uTrail[16]; uniform float uCell;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 cell = floor(frag / uCell);
  vec2 c = (cell + 0.5) * uCell;
  vec2 local = fract(frag / uCell) - 0.5;
  float t = uTime * 0.08;
  float base = n(cell * 0.06 + vec2(t, -t * 0.7)) * n(cell * 0.13 - t);
  base = smoothstep(0.32, 0.62, base) * 0.22;
  float heat = 0.0;
  for (int i = 0; i < 16; i++) {
    vec3 tr = uTrail[i];
    float d = length(c - tr.xy);
    heat += tr.z * smoothstep(uCell * 7.0, 0.0, d);
  }
  heat = clamp(heat, 0.0, 1.0);
  float flick = step(0.5, h(cell + floor(uTime * 6.0)));
  float v = base + heat * (0.55 + 0.45 * flick);
  float size = mix(0.12, 0.42, clamp(v * 1.6, 0.0, 1.0));
  float sq = step(abs(local.x), size) * step(abs(local.y), size);
  vec3 blue = vec3(0.522, 0.82, 0.863); // logo cyan
  vec3 red = vec3(1.0);
  vec3 col = mix(vec3(0.05, 0.3, 0.33), blue, smoothstep(0.05, 0.4, v));
  col = mix(col, red, step(0.94, h(cell * 1.7)) * heat);
  gl_FragColor = vec4(mix(vec3(0.008, 0.169, 0.188), col, sq * clamp(0.25 + v * 1.6, 0.0, 1.0)), 1.0);
}`

export function field(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false })
  if (!gl) return () => {}
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    return s
  }
  const prog = gl.createProgram()!
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT))
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(prog)
  gl.useProgram(prog)
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'p')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const uRes = gl.getUniformLocation(prog, 'uRes')
  const uTime = gl.getUniformLocation(prog, 'uTime')
  const uTrail = gl.getUniformLocation(prog, 'uTrail')
  const uCell = gl.getUniformLocation(prog, 'uCell')

  const trail = new Float32Array(16 * 3)
  let head = 0
  let dpr = 1
  let visible = false
  let time = 0
  let lastPush = 0

  const resize = () => {
    dpr = Math.min(devicePixelRatio, 1.5)
    canvas.width = canvas.clientWidth * dpr
    canvas.height = canvas.clientHeight * dpr
    gl.viewport(0, 0, canvas.width, canvas.height)
  }
  resize()
  window.addEventListener('resize', resize)
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas)

  canvas.parentElement!.addEventListener('pointermove', (e) => {
    if (time - lastPush < 0.016) return
    lastPush = time
    const r = canvas.getBoundingClientRect()
    trail[head * 3] = (e.clientX - r.left) * dpr
    trail[head * 3 + 1] = (r.height - (e.clientY - r.top)) * dpr
    trail[head * 3 + 2] = 1
    head = (head + 1) % 16
  })

  return (dt: number) => {
    if (!visible) return
    time += dt
    for (let i = 0; i < 16; i++) trail[i * 3 + 2] *= Math.exp(-dt * 2.4)
    gl.uniform2f(uRes, canvas.width, canvas.height)
    gl.uniform1f(uTime, time)
    gl.uniform1f(uCell, (canvas.clientWidth < 700 ? 14 : 20) * dpr)
    gl.uniform3fv(uTrail, trail)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
}
