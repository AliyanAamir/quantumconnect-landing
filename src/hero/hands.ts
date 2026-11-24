import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { buildSkeleton, FINGERS, PALM_AXIS, type Pose, type Seg, type Skeleton } from './anatomy'
import { handSDF, surfaceNets, skin, nails, segmentSkin } from './human'

export { mixPose, type Pose } from './anatomy'
export type Kind = 'human' | 'si'

export interface Hand {
  group: THREE.Group
  setPose(p: Pose): void
  indexTip: THREE.Object3D
  glow: THREE.Material[]
  tick(t: number): void
  skeleton: Skeleton
}

const V = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z)

// The human mesh is the same for every instance; build it once.
let humanGeo: THREE.BufferGeometry | null = null

export async function buildHand(kind: Kind): Promise<Hand> {
  const sk = buildSkeleton()
  const group = new THREE.Group()
  const glow: THREE.Material[] = []
  const tickers: ((t: number) => void)[] = []

  if (kind === 'human') {
    if (!humanGeo) {
      const t0 = performance.now()
      humanGeo = surfaceNets(handSDF(sk), V(-0.68, -2.1, -0.36), V(0.98, 1.72, 0.66), 0.016)
      skin(humanGeo, sk)
      if (import.meta.env.DEV) console.info(`hand mesh ${humanGeo.attributes.position.count} verts in ${(performance.now() - t0) | 0} ms`)
    }
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xd6c9bf,
      roughness: 0.56,
      sheen: 0.5,
      sheenRoughness: 0.4,
      sheenColor: new THREE.Color(0xffb3a6),
      clearcoat: 0.08,
      clearcoatRoughness: 0.6,
    })
    segmentSkin(mat)
    const mesh = new THREE.SkinnedMesh(humanGeo, mat)
    mesh.frustumCulled = false
    mesh.add(sk.root)
    mesh.bind(new THREE.Skeleton(sk.bones))
    group.add(mesh)
    nails(sk, new THREE.MeshPhysicalMaterial({ color: 0xf3e6e2, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 }))
    // the forearm continues past the sculpt box, same oval section
    group.add(forearmHuman(mat))
  } else {
    group.add(sk.root)
    buildSI(sk, glow, tickers)
  }

  return {
    group,
    setPose: sk.setPose,
    indexTip: sk.tips.index,
    glow,
    tick: (t) => tickers.forEach((f) => f(t)),
    skeleton: sk,
  }
}

function forearmHuman(mat: THREE.Material) {
  const pts: THREE.Vector2[] = []
  // Continues the sculpted forearm with the same taper. It starts 4 mm inside the sculpt
  // and rises 2 mm proud of it by y = -1.9, where the sculpt ends, so the two surfaces
  // cross at a shallow angle and leave no ring.
  for (let i = 0; i <= 60; i++) {
    const y = -1.7 - (i / 60) ** 1.6 * 9
    const dy = -1.7 - y
    const ramp = Math.min(1, dy / 0.2)
    const margin = -0.004 + 0.006 * ramp * ramp * (3 - 2 * ramp)
    const r = Math.min(0.36, 0.218 + 0.03 * (-0.9 - y) + margin)
    pts.push(new THREE.Vector2(r, y))
  }
  // a lathe faces outward only when its profile runs bottom to top
  const geo = new THREE.LatheGeometry(pts.reverse(), 64)
  // the skin shader reads joint data; neutral values keep the tube shaded exactly like the skin
  const n = geo.attributes.position.count
  geo.setAttribute('aSeg', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1))
  geo.setAttribute('aRest', new THREE.BufferAttribute(new Float32Array(n * 3).fill(-9), 3))
  const m = new THREE.Mesh(geo, mat)
  m.scale.z = 0.6
  m.position.x = PALM_AXIS
  return m
}

// ---------- SI hand ----------

const MAT = () => ({
  shell: new THREE.MeshPhysicalMaterial({ color: 0x035f67, metalness: 0.2, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xb9c7c9, metalness: 1, roughness: 0.2 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0b2a2e, metalness: 0.6, roughness: 0.45 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x022b30, metalness: 0, roughness: 0.8 }),
  core: new THREE.MeshStandardMaterial({ color: 0x85d1dc, emissive: 0x85d1dc, emissiveIntensity: 1.1, roughness: 0.3 }),
  led: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x85d1dc, emissiveIntensity: 1.6 }),
})

// rounded box whose width and depth taper from base (y=0) to top (y=len)
function taperBox(len: number, w0: number, w1: number, d0: number, d1: number, r = 0.25) {
  const g = new RoundedBoxGeometry(1, 1, 1, 4, r)
  const p = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) + 0.5
    p.setXYZ(i, p.getX(i) * (w0 + (w1 - w0) * t), t * len, p.getZ(i) * (d0 + (d1 - d0) * t))
  }
  g.computeVertexNormals()
  return g
}

// orientation with y along the segment, z out of the pad
function segBasis(s: Seg, pad: THREE.Vector3) {
  const ay = s.dir.clone()
  const az = pad.clone().addScaledVector(ay, -pad.dot(ay)).normalize()
  const ax = new THREE.Vector3().crossVectors(ay, az)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, ay, az))
}

function buildSI(sk: Skeleton, glow: THREE.Material[], tickers: ((t: number) => void)[]) {
  const m = MAT()
  glow.push(m.core, m.led)
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, pos: THREE.Vector3, q?: THREE.Quaternion) => {
    const o = new THREE.Mesh(geo, mat)
    o.position.copy(pos)
    if (q) o.quaternion.copy(q)
    parent.add(o)
    return o
  }

  for (const f of [...FINGERS, 'thumb'] as const) {
    const pad = f === 'thumb' ? sk.thumbPad : V(0, 0, 1)
    for (const s of sk.byDigit[f]) {
      if (s.role === 'meta' && f !== 'thumb') continue
      const len = s.a.distanceTo(s.b)
      const q = segBasis(s, pad)
      const gap = s.ra * 0.55 // clearance at each hinge
      const isTip = s.role === 'dist'
      const shellLen = len - gap * (isTip ? 0.6 : 1.2)
      const w0 = s.ra * 1.72
      const w1 = s.rb * (isTip ? 1.5 : 1.7)
      // dorsal shell: the machined cover on the back of each phalanx
      const shell = add(s.bone, taperBox(shellLen, w0, w1, s.ra * 1.25, s.rb * (isTip ? 1.0 : 1.2), isTip ? 0.45 : 0.3), m.shell, new THREE.Vector3(), q)
      shell.position.copy(s.dir).multiplyScalar(gap * 0.6)
      shell.position.addScaledVector(pad, -s.ra * 0.32)
      // palmar grip pad
      const grip = add(s.bone, taperBox(shellLen * 0.86, w0 * 0.78, w1 * 0.78, s.ra * 0.7, s.rb * 0.6, 0.45), m.rubber, new THREE.Vector3(), q)
      grip.position.copy(s.dir).multiplyScalar(gap * 0.6 + shellLen * 0.07).addScaledVector(pad, s.ra * 0.48)
      // structural spine between them
      const spine = add(s.bone, taperBox(len * 0.98, w0 * 0.55, w1 * 0.55, s.ra * 1.1, s.rb * 1.0, 0.3), m.dark, new THREE.Vector3(), q)
      spine.position.set(0, 0, 0)
      // hinge: axle across the joint with glowing ends
      const axle = new THREE.CylinderGeometry(s.ra * 0.62, s.ra * 0.62, s.ra * 1.95, 24)
      const hq = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), s.lateral)
      add(s.bone, axle, m.metal, new THREE.Vector3(), hq)
      add(s.bone, new THREE.CylinderGeometry(s.ra * 0.34, s.ra * 0.34, s.ra * 2.12, 16), m.core, new THREE.Vector3(), hq)
      if (isTip) {
        // fingertip sensor on the pad
        const dot = add(s.bone, new THREE.SphereGeometry(s.rb * 0.28, 16, 10), m.core, new THREE.Vector3())
        dot.position.copy(s.dir).multiplyScalar(len * 0.68).addScaledVector(pad, s.rb * 0.82)
        dot.scale.set(1, 1.3, 0.5)
      }
    }
  }

  // palm chassis, on the wrist bone (positions relative to it)
  const w = sk.root.position
  const rel = (v: THREE.Vector3) => v.clone().sub(w)
  const outline = new THREE.Shape()
  // palm outline in xy, following the knuckle arc
  const pts: [number, number][] = [
    [-0.28, -0.46], [0.24, -0.46], [0.36, -0.1], [0.4, 0.3], [0.33, 0.46], [0.18, 0.5], [0.09, 0.52],
    [-0.02, 0.5], [-0.12, 0.47], [-0.24, 0.42], [-0.33, 0.36], [-0.39, 0.2], [-0.38, -0.2],
  ]
  outline.moveTo(pts[0][0], pts[0][1])
  for (const [x, y] of pts.slice(1)) outline.lineTo(x, y)
  outline.closePath()
  const plate = (depth: number, bevel: number, scale: number) => {
    const g = new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 8 })
    g.scale(scale, scale, 1)
    return g
  }
  const back = add(sk.root, plate(0.07, 0.035, 0.94), m.shell, rel(V(0, -0.0, -0.19)))
  back.scale.y = 1
  add(sk.root, plate(0.05, 0.03, 0.9), m.rubber, rel(V(0, -0.01, 0.07)))
  add(sk.root, plate(0.17, 0.02, 0.86), m.dark, rel(V(0, -0.0, -0.1)))
  // back plate seam lights, one per ray
  for (const f of FINGERS) {
    const meta = sk.byDigit[f][0]
    const len = meta.a.distanceTo(meta.b) * 0.62
    const bar = add(sk.root, new RoundedBoxGeometry(0.022, len, 0.02, 2, 0.008), m.core, rel(meta.a.clone().lerp(meta.b, 0.55).setZ(-0.232)))
    bar.quaternion.setFromUnitVectors(V(0, 1, 0), meta.dir)
    // knuckle housing at each MCP
    const cap = add(sk.root, new THREE.SphereGeometry(meta.rb * 1.05, 20, 12), m.metal, rel(meta.b.clone().setZ(-0.04)))
    cap.scale.set(1, 0.8, 1.1)
  }
  // thenar actuator block
  const tm = sk.byDigit.thumb[0]
  add(sk.root, new RoundedBoxGeometry(0.2, 0.34, 0.2, 3, 0.06), m.shell, rel(V(0.22, -0.24, 0.0))).rotation.z = -0.35
  add(sk.root, new THREE.SphereGeometry(0.1, 20, 12), m.metal, rel(tm.a))

  // wrist gimbal
  const gim = add(sk.root, new THREE.TorusGeometry(0.27, 0.035, 12, 48), m.metal, rel(V(0, -0.58)))
  gim.rotation.x = Math.PI / 2
  gim.scale.set(1, 0.72, 1)
  const ring = add(sk.root, new THREE.TorusGeometry(0.25, 0.014, 8, 48), m.core, rel(V(0, -0.64)))
  ring.rotation.x = Math.PI / 2
  ring.scale.set(1, 0.72, 1)
  const hub = add(sk.root, new THREE.CylinderGeometry(0.2, 0.22, 0.2, 32), m.dark, rel(V(0, -0.66)))
  hub.scale.z = 0.7

  // forearm: tapered sleeve with panel cuts, exposed pistons, status band
  const sleeveG = new THREE.CylinderGeometry(0.27, 0.4, 10, 48, 12)
  const sleeve = add(sk.root, sleeveG, m.shell, rel(V(0, -5.8)))
  sleeve.scale.z = 0.7
  for (let i = 0; i < 6; i++) {
    const y = -1.0 - i * 0.42
    const band = add(sk.root, new THREE.CylinderGeometry(0.287 + i * 0.008, 0.287 + i * 0.008, i === 1 ? 0.03 : 0.014, 48), i === 1 ? m.led : i === 2 ? m.core : m.dark, rel(V(0, y)))
    band.scale.z = 0.71
  }
  for (const side of [-1, 1]) {
    add(sk.root, new THREE.CylinderGeometry(0.045, 0.045, 0.9, 16), m.dark, rel(V(side * 0.29, -1.55, -0.02)))
    add(sk.root, new THREE.CylinderGeometry(0.022, 0.022, 0.6, 12), m.metal, rel(V(side * 0.29, -0.95, -0.02)))
  }
  // tendon cables along the back, from the sleeve to each knuckle
  for (const f of FINGERS) {
    const meta = sk.byDigit[f][0]
    const end = meta.b.clone().setZ(-0.1)
    const curve = new THREE.CatmullRomCurve3([V(meta.a.x * 0.6, -1.1, -0.17), V(meta.a.x * 0.8, -0.62, -0.25), meta.a.clone().setZ(-0.26), end.clone().setZ(-0.24).lerp(meta.a, 0.4), end])
    add(sk.root, new THREE.TubeGeometry(curve, 40, 0.012, 8), m.metal, rel(V(0, 0, 0)))
  }

  tickers.push((t) => {
    m.core.emissiveIntensity = 0.9 + Math.sin(t * 2.2) * 0.25
  })
}
