// Damped spring, integrated in fixed substeps so large frame gaps stay stable.
export class Spring {
  value: number
  target: number
  velocity = 0

  constructor(v = 0, public stiffness = 170, public damping = 26, public mass = 1) {
    this.value = v
    this.target = v
  }

  step(dt: number) {
    dt = Math.min(dt, 0.1)
    const n = Math.ceil(dt / (1 / 240))
    const h = dt / n
    for (let i = 0; i < n; i++) {
      const f = -this.stiffness * (this.value - this.target) - this.damping * this.velocity
      this.velocity += (f / this.mass) * h
      this.value += this.velocity * h
    }
    return this.value
  }

  snap(v: number) {
    this.value = this.target = v
    this.velocity = 0
  }

  get settled() {
    return Math.abs(this.value - this.target) < 1e-4 && Math.abs(this.velocity) < 1e-4
  }
}

export class Spring2 {
  x: Spring
  y: Spring
  constructor(k = 170, c = 26) {
    this.x = new Spring(0, k, c)
    this.y = new Spring(0, k, c)
  }
  set(x: number, y: number) {
    this.x.target = x
    this.y.target = y
  }
  step(dt: number) {
    this.x.step(dt)
    this.y.step(dt)
  }
}

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
// normalized progress of v inside [a, b]
export const range = (v: number, a: number, b: number) => clamp((v - a) / (b - a))
export const smooth = (t: number) => t * t * (3 - 2 * t)
export const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
