import { clamp } from '../spring'

// Pixel dissolve bands between sections. Every cell has a random threshold, biased by
// row, so the colour change sweeps down while breaking into squares. A few rows tear
// sideways while the band is mid-transition.
export function dissolves() {
  const bands = [...document.querySelectorAll<HTMLElement>('[data-dissolve]')].map((el) => {
    const c = el.querySelector('canvas')!
    const g = c.getContext('2d')!
    return { el, c, g, from: el.dataset.from!, to: el.dataset.to!, seeds: new Float32Array(0), cols: 0, rows: 0, cell: 0, last: -1 }
  })

  const layout = () => {
    for (const b of bands) {
      const w = b.el.clientWidth
      const h = b.el.clientHeight
      b.cell = w < 700 ? 14 : 22
      b.cols = Math.ceil(w / b.cell)
      b.rows = Math.ceil(h / b.cell)
      b.c.width = b.cols
      b.c.height = b.rows
      b.c.style.imageRendering = 'pixelated'
      b.seeds = new Float32Array(b.cols * b.rows)
      for (let y = 0; y < b.rows; y++)
        for (let x = 0; x < b.cols; x++) b.seeds[y * b.cols + x] = (y / b.rows) * 0.62 + Math.random() * 0.38
      b.last = -1
    }
  }
  layout()
  window.addEventListener('resize', layout)

  return (time: number) => {
    const vh = window.innerHeight
    for (const b of bands) {
      const r = b.el.getBoundingClientRect()
      if (r.bottom < -50 || r.top > vh + 50) continue
      // 0 when band enters from below, 1 when it leaves at the top
      const p = clamp((vh - r.top) / (vh + r.height) * 1.5 - 0.25)
      const q = Math.round(p * 400) / 400
      const tear = p > 0.15 && p < 0.85
      if (q === b.last && !tear) continue
      b.last = q
      const { g, cols, rows, seeds } = b
      g.fillStyle = b.from
      g.fillRect(0, 0, cols, rows)
      g.fillStyle = b.to
      const shift = Math.floor(time * 12)
      for (let y = 0; y < rows; y++) {
        let off = 0
        if (tear) {
          const hsh = Math.sin((y + shift) * 91.7) * 43758.5
          if (hsh - Math.floor(hsh) > 0.93) off = Math.round((Math.sin(y * 3.3 + shift) * 0.5) * 6)
        }
        for (let x = 0; x < cols; x++) {
          if (seeds[y * cols + ((x + off + cols) % cols)] < p) g.fillRect(x, y, 1, 1)
        }
      }
      // sparse accent pixels at the frontier
      for (let i = 0; i < cols * 0.6; i++) {
        const x = (Math.random() * cols) | 0
        const y = (Math.random() * rows) | 0
        const s = seeds[y * cols + x]
        if (Math.abs(s - p) < 0.03) {
          g.fillStyle = Math.random() > 0.5 ? '#035f67' : '#85d1dc'
          g.fillRect(x, y, 1, 1)
        }
      }
    }
  }
}

// Cursor trail: a grid of cells lights where the pointer passes and decays. Blue by
// default, a red cell now and then. Runs on the shared clock, sleeps when idle.
export function trail(canvas: HTMLCanvasElement) {
  const g = canvas.getContext('2d')!
  const CELL = 16
  let cols = 0
  let rows = 0
  let heat = new Float32Array(0)
  let tint = new Uint8Array(0)
  let dpr = 1
  let active = 0
  const last = { x: -1, y: -1 }

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio, 2)
    canvas.width = innerWidth * dpr
    canvas.height = innerHeight * dpr
    cols = Math.ceil(innerWidth / CELL)
    rows = Math.ceil(innerHeight / CELL)
    heat = new Float32Array(cols * rows)
    tint = new Uint8Array(cols * rows)
  }
  resize()
  window.addEventListener('resize', resize)

  const light = (x: number, y: number) => {
    const cx = Math.floor(x / CELL)
    const cy = Math.floor(y / CELL)
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return
    const i = cy * cols + cx
    heat[i] = 1
    tint[i] = Math.random() > 0.9 ? 1 : 0
    active = 1.2
  }

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return
    const x = e.clientX
    const y = e.clientY
    if (last.x >= 0) {
      const d = Math.hypot(x - last.x, y - last.y)
      const steps = Math.ceil(d / (CELL * 0.6))
      for (let s = 1; s <= steps; s++) light(last.x + ((x - last.x) * s) / steps, last.y + ((y - last.y) * s) / steps)
    } else light(x, y)
    last.x = x
    last.y = y
  })
  document.addEventListener('pointerleave', () => (last.x = last.y = -1))

  return (dt: number) => {
    if (active <= 0) return
    active -= dt
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, innerWidth, innerHeight)
    const decay = Math.exp(-dt * 3.2)
    for (let i = 0; i < heat.length; i++) {
      const h = heat[i]
      if (h < 0.02) continue
      heat[i] = h * decay
      const x = (i % cols) * CELL
      const y = ((i / cols) | 0) * CELL
      const s = CELL * (0.35 + h * 0.6)
      const o = (CELL - s) / 2
      g.fillStyle = tint[i] ? `rgba(133,209,220,${h})` : `rgba(3,95,103,${h * 0.85})`
      g.fillRect(x + o, y + o, s, s)
      active = Math.max(active, 0.1)
    }
  }
}

// Procedural pixel covers for the slider cards. Deterministic per seed.
export function cardArt() {
  const rand = (s: number) => () => ((s = (s * 16807) % 2147483647), (s - 1) / 2147483646)
  for (const c of document.querySelectorAll<HTMLCanvasElement>('canvas[data-seed]')) {
    const seed = Number(c.dataset.seed)
    const r = rand(seed * 9301 + 49297)
    const W = 64
    const H = 48
    c.width = W
    c.height = H
    const g = c.getContext('2d')!
    g.fillStyle = '#011f23'
    g.fillRect(0, 0, W, H)
    const kind = seed % 3
    // two forms per card: a round human form (red) and a square SI form (blue), joined
    const hx = 14 + r() * 8
    const sx = W - 14 - r() * 8
    const cy = H / 2 + (r() - 0.5) * 8
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const dh = Math.hypot(x - hx, y - cy)
        const ds = Math.max(Math.abs(x - sx), Math.abs(y - cy))
        let col = ''
        if (kind === 0) {
          if (Math.abs(dh - 9) < 0.8) col = '#e6f4f6'
          if (Math.abs(ds - 8) < 0.6) col = '#85d1dc'
        } else if (kind === 1) {
          if (dh < 8 && (x + y) % 2 === 0) col = '#e6f4f6'
          if (ds < 8 && (x * 3 + y) % 4 === 0) col = '#85d1dc'
        } else {
          if (dh < 9 && Math.sin(dh * 1.4 + seed) > 0.2) col = '#e6f4f6'
          if (ds < 9 && Math.sin(ds * 1.6 + seed) > 0.2) col = '#85d1dc'
        }
        // the connection
        if (!col && x > hx + 9 && x < sx - 8) {
          const t = (x - hx) / (sx - hx)
          const yy = cy + Math.sin(t * Math.PI * (1 + seed % 3)) * (4 + seed % 4)
          if (Math.abs(y - yy) < 0.6) col = '#3fa3b0'
        }
        if (!col && r() > 0.985) col = r() > 0.5 ? '#073a40' : '#0a4a51'
        if (col) {
          g.fillStyle = col
          g.fillRect(x, y, 1, 1)
        }
      }
  }
}

// Footer wordmark drawn as pixels that settle onto the letterforms and scatter away
// from the pointer.
export function wordmark(canvas: HTMLCanvasElement) {
  const g = canvas.getContext('2d')!
  type P = { x: number; y: number; tx: number; ty: number; vx: number; vy: number; c: string }
  let pts: P[] = []
  let dpr = 1
  let W = 0
  let H = 0
  let step = 6
  const mouse = { x: -9999, y: -9999 }
  let seen = false

  const build = () => {
    dpr = Math.min(devicePixelRatio, 2)
    W = canvas.clientWidth
    H = canvas.clientHeight
    canvas.width = W * dpr
    canvas.height = H * dpr
    step = W < 700 ? 4 : 6
    const off = document.createElement('canvas')
    off.width = W
    off.height = H
    const o = off.getContext('2d')!
    o.fillStyle = '#fff'
    o.textBaseline = 'middle'
    let size = H * 0.95
    o.font = `900 ${size}px "Archivo Variable", sans-serif`
    ;(o as CanvasRenderingContext2D & { fontStretch?: string }).fontStretch = 'expanded'
    while (o.measureText('qconnect.si').width > W * 0.96 && size > 10) {
      size -= 4
      o.font = `900 ${size}px "Archivo Variable", sans-serif`
    }
    o.fillText('qconnect.si', W * 0.02, H * 0.52)
    const data = o.getImageData(0, 0, W, H).data
    const dotX = o.measureText('qconnect').width + W * 0.02
    const dotW = o.measureText('.').width
    const old = pts
    pts = []
    for (let y = 0; y < H; y += step)
      for (let x = 0; x < W; x += step) {
        if (data[(y * W + x) * 4 + 3] > 128) {
          const prev = old[pts.length]
          const c = x >= dotX && x < dotX + dotW ? '#85d1dc' : Math.random() > 0.96 ? '#85d1dc' : '#ffffff'
          pts.push({ x: prev?.x ?? Math.random() * W, y: prev?.y ?? H + Math.random() * H, tx: x, ty: y, vx: 0, vy: 0, c })
        }
      }
  }
  document.fonts.ready.then(build)
  window.addEventListener('resize', build)
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect()
    mouse.x = e.clientX - r.left
    mouse.y = e.clientY - r.top
  })
  canvas.addEventListener('pointerleave', () => (mouse.x = mouse.y = -9999))
  new IntersectionObserver(([e]) => (seen = e.isIntersecting)).observe(canvas)

  return (dt: number) => {
    if (!seen || !pts.length) return
    const k = 90
    const c = 11
    const h = Math.min(dt, 1 / 30)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)
    for (const p of pts) {
      let fx = -k * (p.x - p.tx) - c * p.vx
      let fy = -k * (p.y - p.ty) - c * p.vy
      const dx = p.x - mouse.x
      const dy = p.y - mouse.y
      const d2 = dx * dx + dy * dy
      if (d2 < 9000) {
        const f = (1 - d2 / 9000) * 9000
        const d = Math.sqrt(d2) || 1
        fx += (dx / d) * f
        fy += (dy / d) * f
      }
      p.vx += fx * h
      p.vy += fy * h
      p.x += p.vx * h
      p.y += p.vy * h
      g.fillStyle = p.c
      g.fillRect(p.x, p.y, step - 1, step - 1)
    }
  }
}
