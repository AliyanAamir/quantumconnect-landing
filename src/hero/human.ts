import * as THREE from 'three'
import { FINGERS, PALM_AXIS, segT, type Seg, type Skeleton } from './anatomy'

// Human hand: a signed distance sculpt in the rest pose, meshed with surface nets,
// then skinned to the shared skeleton.

type SDF = (x: number, y: number, z: number) => number

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

// round cone between a (radius ra) and b (radius rb), with the cross-section squashed in z
function roundCone(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, squashZ = 1): SDF {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const abz = b.z - a.z
  const l2 = abx * abx + aby * aby + abz * abz
  return (x, y, z) => {
    const px = x - a.x
    const py = y - a.y
    const pz = z - a.z
    let t = (px * abx + py * aby + pz * abz) / l2
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const qx = px - abx * t
    const qy = py - aby * t
    const qz = (pz - abz * t) / squashZ
    // ellipse section: x radius r, z radius r * squashZ (distance scaled back to stay a bound)
    return (Math.sqrt(qx * qx + qy * qy + qz * qz) - (ra + (rb - ra) * t)) * Math.min(1, squashZ)
  }
}

function ellipsoid(c: THREE.Vector3, r: THREE.Vector3): SDF {
  return (x, y, z) => {
    const px = (x - c.x) / r.x
    const py = (y - c.y) / r.y
    const pz = (z - c.z) / r.z
    const k0 = Math.sqrt(px * px + py * py + pz * pz)
    const k1 = Math.sqrt((px / r.x) ** 2 + (py / r.y) ** 2 + (pz / r.z) ** 2)
    return k1 === 0 ? -Math.min(r.x, r.y, r.z) : (k0 * (k0 - 1)) / k1
  }
}

const V = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z)

export function handSDF(sk: Skeleton): SDF {
  // palm: a slab that narrows toward the wrist, plus the metacarpal rays and the pads
  const slab: SDF = (x, y, z) => {
    const t = Math.min(1, Math.max(0, (y + 0.5) / 0.95))
    const hw = 0.26 + 0.12 * t // half width, wrist to knuckles
    const ht = 0.088 - 0.025 * t // half thickness thins toward the knuckles
    const cx = PALM_AXIS
    const qx = Math.abs(x - cx) - (hw - 0.08)
    const qy = Math.abs(y - 0.0) - 0.42
    const qz = Math.abs(z - 0.02) - (ht - 0.05)
    const ox = Math.max(qx, 0)
    const oy = Math.max(qy, 0)
    const oz = Math.max(qz, 0)
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - 0.08
  }
  const rays = FINGERS.map((f) => {
    const m = sk.byDigit[f][0]
    // rays sit toward the back of the hand; the bumps are the knuckles
    return roundCone(m.a.clone().setZ(-0.04), m.b.clone().setZ(-0.035), 0.07, m.rb * 0.95, 0.9)
  })
  const knuckles = FINGERS.map((f) => {
    const m = sk.byDigit[f][0]
    return ellipsoid(m.b.clone().add(V(0, -0.02, -0.05)), V(m.rb * 0.95, 0.09, 0.08))
  })
  // heel pads mirrored about the palm axis so the hand reads symmetric
  const thenar = ellipsoid(V(PALM_AXIS + 0.2, -0.22, 0.07), V(0.16, 0.27, 0.12))
  const hypo = ellipsoid(V(PALM_AXIS - 0.2, -0.22, 0.07), V(0.16, 0.27, 0.12))
  const heel = ellipsoid(V(PALM_AXIS, -0.38, 0.045), V(0.2, 0.1, 0.08))
  const wrist = roundCone(V(PALM_AXIS, -0.48), V(PALM_AXIS, -0.9), 0.232, 0.218, 0.6)
  const forearm = roundCone(V(PALM_AXIS, -0.9), V(PALM_AXIS, -1.9), 0.218, 0.248, 0.6)
  const palmPad = ellipsoid(V(PALM_AXIS, 0.28, 0.05), V(0.36, 0.11, 0.06))

  const palm: SDF = (x, y, z) => {
    let d = slab(x, y, z)
    for (const r of rays) d = smin(d, r(x, y, z), 0.08)
    for (const k of knuckles) d = smin(d, k(x, y, z), 0.05)
    d = smin(d, thenar(x, y, z), 0.12)
    d = smin(d, hypo(x, y, z), 0.1)
    d = smin(d, heel(x, y, z), 0.1)
    d = smin(d, palmPad(x, y, z), 0.08)
    // wrist and forearm are one limb: joined exactly (a smooth blend would inflate the joint),
    // and only the limb as a whole blends into the palm
    d = smin(d, Math.min(wrist(x, y, z), forearm(x, y, z)), 0.08)
    return d
  }

  const digit = (segs: Seg[], thumb: boolean): SDF => {
    const parts: SDF[] = []
    for (const s of segs) {
      if (s.role === 'meta' && !thumb) continue
      parts.push(roundCone(s.a, s.b, s.ra * 1.04, s.rb * 1.04, thumb ? 0.92 : 0.9))
      // palmar pad on each phalanx, fuller toward the tip
      const mid = s.a.clone().lerp(s.b, 0.55)
      const toPad = thumb ? sk.thumbPad : V(0, 0, 1)
      const len = s.a.distanceTo(s.b)
      const padR = (s.ra + s.rb) * 0.5
      const padC = mid.clone().addScaledVector(toPad, padR * 0.3)
      if (s.role !== 'meta') {
        const pr = V(padR * 0.85, len * 0.32, padR * 0.72)
        if (thumb) parts.push(ellipsoidAlong(padC, s.dir, toPad, pr))
        else parts.push(ellipsoidAlong(padC, s.dir, toPad, pr))
      }
      // joint knuckle bulge on the back
      if (s.role === 'mid' || s.role === 'dist') {
        parts.push(roundCone(s.a.clone().addScaledVector(s.lateral, -s.ra * 0.55), s.a.clone().addScaledVector(s.lateral, s.ra * 0.55), s.ra * 0.62, s.ra * 0.62, 1))
      }
    }
    return (x, y, z) => {
      let d = parts[0](x, y, z)
      for (let i = 1; i < parts.length; i++) d = smin(d, parts[i](x, y, z), 0.035)
      return d
    }
  }
  const fingers = FINGERS.map((f) => digit(sk.byDigit[f], false))
  const thumb = digit(sk.byDigit.thumb, true)
  // web between thumb and index
  const tm = sk.byDigit.thumb[1]
  // web between thumb and index: a full, rounded sheet, thick enough that the mesh never
  // resolves it as a hole and it stretches rather than tears when the thumb moves
  const web = roundCone(tm.a.clone().lerp(tm.b, 0.35).add(V(-0.02, 0, 0.0)), sk.byDigit.index[1].a.clone().add(V(-0.02, -0.1, 0.0)), 0.085, 0.07, 0.8)
  const web2 = ellipsoid(tm.a.clone().lerp(sk.byDigit.index[1].a, 0.45).add(V(0, -0.05, 0)), V(0.12, 0.14, 0.075))

  return (x, y, z) => {
    const p = palm(x, y, z)
    let d = smin(p, thumb(x, y, z), 0.12)
    d = smin(d, web(x, y, z), 0.12)
    d = smin(d, web2(x, y, z), 0.1)
    for (const f of fingers) d = Math.min(d, smin(p, f(x, y, z), 0.06))
    return d
  }
}

// ellipsoid oriented with its y radius along `along` and z radius along `up`
function ellipsoidAlong(c: THREE.Vector3, along: THREE.Vector3, up: THREE.Vector3, r: THREE.Vector3): SDF {
  const ay = along.clone().normalize()
  const az = up.clone().addScaledVector(ay, -up.dot(ay)).normalize()
  const ax = new THREE.Vector3().crossVectors(ay, az)
  return (x, y, z) => {
    const px = x - c.x
    const py = y - c.y
    const pz = z - c.z
    const lx = (px * ax.x + py * ax.y + pz * ax.z) / r.x
    const ly = (px * ay.x + py * ay.y + pz * ay.z) / r.y
    const lz = (px * az.x + py * az.y + pz * az.z) / r.z
    const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz)
    const k1 = Math.sqrt((lx / r.x) ** 2 + (ly / r.y) ** 2 + (lz / r.z) ** 2)
    return k1 === 0 ? -Math.min(r.x, r.y, r.z) : (k0 * (k0 - 1)) / k1
  }
}

// Surface nets over a box. Returns an indexed geometry with gradient normals.
export function surfaceNets(f: SDF, min: THREE.Vector3, max: THREE.Vector3, h: number) {
  const nx = Math.ceil((max.x - min.x) / h) + 1
  const ny = Math.ceil((max.y - min.y) / h) + 1
  const nz = Math.ceil((max.z - min.z) / h) + 1
  const vals = new Float32Array(nx * ny * nz)
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k)
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) vals[idx(i, j, k)] = f(min.x + i * h, min.y + j * h, min.z + k * h)

  const cell = new Int32Array((nx - 1) * (ny - 1) * nz).fill(-1)
  const cidx = (i: number, j: number, k: number) => i + (nx - 1) * (j + (ny - 1) * k)
  const pos: number[] = []
  const corners = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ]
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
  ]
  const cv = new Float32Array(8)
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0
        for (let c = 0; c < 8; c++) {
          const [a, b, d] = corners[c]
          cv[c] = vals[idx(i + a, j + b, k + d)]
          if (cv[c] < 0) mask |= 1 << c
        }
        if (mask === 0 || mask === 255) continue
        let sx = 0
        let sy = 0
        let sz = 0
        let n = 0
        for (const [e0, e1] of edges) {
          const v0 = cv[e0]
          const v1 = cv[e1]
          if (v0 < 0 === v1 < 0) continue
          const t = v0 / (v0 - v1)
          const c0 = corners[e0]
          const c1 = corners[e1]
          sx += c0[0] + (c1[0] - c0[0]) * t
          sy += c0[1] + (c1[1] - c0[1]) * t
          sz += c0[2] + (c1[2] - c0[2]) * t
          n++
        }
        cell[cidx(i, j, k)] = pos.length / 3
        pos.push(min.x + (i + sx / n) * h, min.y + (j + sy / n) * h, min.z + (k + sz / n) * h)
      }

  const index: number[] = []
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (flip) index.push(a, d, c, a, c, b)
    else index.push(a, b, c, a, c, d)
  }
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const v0 = vals[idx(i, j, k)] < 0
        if (v0 !== vals[idx(i + 1, j, k)] < 0)
          quad(cell[cidx(i, j - 1, k - 1)], cell[cidx(i, j, k - 1)], cell[cidx(i, j, k)], cell[cidx(i, j - 1, k)], !v0)
      }
  for (let k = 1; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const v0 = vals[idx(i, j, k)] < 0
        if (v0 !== vals[idx(i, j + 1, k)] < 0)
          quad(cell[cidx(i - 1, j, k - 1)], cell[cidx(i - 1, j, k)], cell[cidx(i, j, k)], cell[cidx(i, j, k - 1)], !v0)
      }
  for (let k = 0; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const v0 = vals[idx(i, j, k)] < 0
        if (v0 !== vals[idx(i, j, k + 1)] < 0)
          quad(cell[cidx(i - 1, j - 1, k)], cell[cidx(i, j - 1, k)], cell[cidx(i, j, k)], cell[cidx(i - 1, j, k)], !v0)
      }

  // project onto the surface and take normals from the field gradient
  const p = new Float32Array(pos)
  const nrm = new Float32Array(p.length)
  const e = h * 0.5
  for (let v = 0; v < p.length; v += 3) {
    let x = p[v]
    let y = p[v + 1]
    let z = p[v + 2]
    let gx = 0
    let gy = 0
    let gz = 0
    for (let it = 0; it < 3; it++) {
      gx = f(x + e, y, z) - f(x - e, y, z)
      gy = f(x, y + e, z) - f(x, y - e, z)
      gz = f(x, y, z + e) - f(x, y, z - e)
      const gl = Math.hypot(gx, gy, gz) || 1
      gx /= gl
      gy /= gl
      gz /= gl
      if (it < 2) {
        const d = f(x, y, z)
        x -= gx * d
        y -= gy * d
        z -= gz * d
      }
    }
    p[v] = x
    p[v + 1] = y
    p[v + 2] = z
    nrm[v] = gx
    nrm[v + 1] = gy
    nrm[v + 2] = gz
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(p, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  g.setIndex(index)
  return g
}

// Each vertex follows the bone of its nearest segment, blended with the neighbour bone
// near a joint so knuckles bend instead of shearing.
export function skin(g: THREE.BufferGeometry, sk: Skeleton) {
  const pos = g.attributes.position as THREE.BufferAttribute
  const n = pos.count
  const seg = new Float32Array(n) // distance along the digit to the nearest joint crease
  const si = new Uint16Array(n * 4)
  const sw = new Float32Array(n * 4)
  const boneIndex = new Map(sk.bones.map((b, i) => [b, i]))
  const p = new THREE.Vector3()
  const segs = sk.segs
  for (let v = 0; v < n; v++) {
    p.fromBufferAttribute(pos, v)
    let best: Seg = segs[0]
    let bd = Infinity
    let bt = 0
    for (const s of segs) {
      const t = segT(p, s.a, s.b)
      const cx = s.a.x + (s.b.x - s.a.x) * t
      const cy = s.a.y + (s.b.y - s.a.y) * t
      const cz = s.a.z + (s.b.z - s.a.z) * t
      // metacarpal rays sit inside the palm: bias them so the palm stays with them, not the fingers
      const d = Math.hypot(p.x - cx, p.y - cy, p.z - cz) - (s.ra + (s.rb - s.ra) * t) * (s.role === 'meta' ? 1.6 : 1)
      if (d < bd) {
        bd = d
        best = s
        bt = t
      }
    }
    const len = best.a.distanceTo(best.b)
    seg[v] =
      best.role === 'prox' || best.role === 'mid' ? Math.min(bt, 1 - bt) * len
      : best.role === 'dist' ? bt * len
      : 1
    const w: [Seg, number][] = []
    const blend = 0.28
    if (best.role === 'meta' && best.parent) {
      // metacarpals sit inside the palm: their skin hands over to the wrist gradually,
      // so moving the thumb stretches the palm instead of tearing it off the wrist
      const own = 0.1 + 0.9 * bt * bt
      w.push([best, own], [best.parent, 1 - own])
    } else {
      w.push([best, 1])
      if (bt < blend && best.parent) w.push([best.parent, 0.5 * (1 - bt / blend) ** 1.5])
    }
    if (bt > 1 - blend && best.child) w.push([best.child, 0.5 * ((bt - (1 - blend)) / blend) ** 1.5])
    const sum = w.reduce((a, [, x]) => a + x, 0)
    w.forEach(([s, x], k) => {
      si[v * 4 + k] = boneIndex.get(s.bone)!
      sw[v * 4 + k] = x / sum
    })
  }
  g.setAttribute('aSeg', new THREE.BufferAttribute(seg, 1))
  g.setAttribute('aRest', new THREE.BufferAttribute((pos.array as Float32Array).slice(), 3))
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4))
}

export function nails(sk: Skeleton, mat: THREE.Material) {
  for (const f of [...FINGERS, 'thumb'] as const) {
    const segs = sk.byDigit[f]
    const dist = segs[segs.length - 1]
    const len = dist.a.distanceTo(dist.b)
    const back = f === 'thumb' ? sk.thumbPad.clone().negate() : new THREE.Vector3(0, 0, -1)
    const t = 0.62
    const r = dist.ra + (dist.rb - dist.ra) * t
    const geo = new THREE.SphereGeometry(1, 24, 12)
    const m = new THREE.Mesh(geo, mat)
    m.scale.set(r * 0.8, len * 0.4, 0.03)
    // orient: y along the digit, z along the back of the finger
    const ay = dist.dir.clone()
    const az = back.clone().addScaledVector(ay, -back.dot(ay)).normalize()
    const ax = new THREE.Vector3().crossVectors(ay, az)
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, ay, az))
    m.position.copy(dist.a.clone().lerp(dist.b, t).addScaledVector(az, r * 0.9).sub(dist.a))
    dist.bone.add(m)
  }
}

// Joint creases around every finger segment and the three palm lines, drawn in the
// skin shader from rest-pose data so they stay put as the fingers bend.
export function segmentSkin(mat: THREE.MeshPhysicalMaterial) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSeg; attribute vec3 aRest; varying float vSeg; varying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeg = aSeg; vRest = aRest;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vSeg; varying vec3 vRest;
        float lineTo(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // joint creases: a fine double line, deeper on the palm side
        float palmSide = smoothstep(-0.02, 0.06, vRest.z);
        float c1 = 1.0 - smoothstep(0.0025, 0.007, abs(vSeg - 0.004));
        float c2 = 1.0 - smoothstep(0.002, 0.005, abs(vSeg - 0.02));
        float crease = max(c1, c2 * mix(0.25, 0.6, palmSide));
        // palm lines: heart, head, life
        vec2 q = vRest.xy;
        float onPalm = smoothstep(0.08, 0.13, vRest.z) * step(vRest.y, 0.42) * step(-0.5, vRest.y) * step(0.9, vSeg) * step(vRest.x, 0.16);
        float heart = min(lineTo(q, vec2(-0.4, 0.27), vec2(-0.05, 0.3)), lineTo(q, vec2(-0.05, 0.3), vec2(0.18, 0.36)));
        float head = min(lineTo(q, vec2(0.3, 0.14), vec2(0.0, 0.1)), lineTo(q, vec2(0.0, 0.1), vec2(-0.32, 0.0)));
        float life = abs(length(q - vec2(0.36, -0.28)) - 0.36) + step(q.y, -0.5) + step(0.15, q.y) + step(q.x, 0.02);
        float lines = (1.0 - smoothstep(0.002, 0.008, min(min(heart, head), life))) * onPalm;
        diffuseColor.rgb *= 1.0 - crease * 0.42 - lines * 0.28;`)
  }
}
