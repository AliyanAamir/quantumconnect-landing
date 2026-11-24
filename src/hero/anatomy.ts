import * as THREE from 'three'

// Shared skeleton for both hands. See docs/HAND.md for where the numbers come from.
// Frame: right hand, +Y along fingers, +Z out of the palm, +X toward the thumb.
// Wrist at y = -0.5, middle MCP at y = 0.5. Bones have identity rest rotations, so a
// bone's local axes are the hand axes at rest.

export type Digit = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky'
export const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const

export interface Pose {
  thumb: number
  index: number
  middle: number
  ring: number
  pinky: number
  spread: number
  opp: number
}

export const mixPose = (a: Pose, b: Pose, t: number): Pose => {
  const o = {} as Pose
  for (const k of Object.keys(a) as (keyof Pose)[]) o[k] = a[k] + (b[k] - a[k]) * t
  return o
}

export interface Seg {
  digit: Digit | 'palm'
  bone: THREE.Bone
  parent: Seg | null
  child: Seg | null
  a: THREE.Vector3 // rest, hand space
  b: THREE.Vector3
  ra: number
  rb: number
  dir: THREE.Vector3
  lateral: THREE.Vector3 // flexion axis
  role: 'meta' | 'prox' | 'mid' | 'dist' | 'wrist'
}

const V = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z)

const SPEC = {
  // knuckles evenly spaced (0.21) on an arc symmetric about the palm axis x = -0.025
  index: { mcp: V(0.29, 0.47), lens: [0.42, 0.24, 0.2], r: [0.097, 0.078] },
  middle: { mcp: V(0.08, 0.5), lens: [0.47, 0.28, 0.21], r: [0.1, 0.08] },
  ring: { mcp: V(-0.13, 0.48), lens: [0.44, 0.27, 0.2], r: [0.097, 0.078] },
  pinky: { mcp: V(-0.34, 0.4), lens: [0.34, 0.2, 0.18], r: [0.085, 0.068] },
}
export const PALM_AXIS = -0.025
const THUMB = { cmc: V(0.16, -0.4, 0.07), lens: [0.46, 0.32, 0.27], r: [0.118, 0.084] }

const FLEX = { prox: THREE.MathUtils.degToRad(90), mid: THREE.MathUtils.degToRad(105), dist: THREE.MathUtils.degToRad(72) }

export interface Skeleton {
  root: THREE.Bone
  bones: THREE.Bone[]
  segs: Seg[]
  byDigit: Record<Digit, Seg[]> // thumb: [meta, prox, dist], fingers: [meta, prox, mid, dist]
  tips: Record<Digit, THREE.Bone>
  wristSeg: Seg
  thumbPad: THREE.Vector3
  setPose(p: Pose): void
}

export function buildSkeleton(): Skeleton {
  const root = new THREE.Bone()
  root.name = 'wrist'
  root.position.set(0, -0.5, 0)
  const bones: THREE.Bone[] = [root]
  const segs: Seg[] = []
  const byDigit = {} as Record<Digit, Seg[]>
  const tips = {} as Record<Digit, THREE.Bone>

  // bone at world-rest position `at`, parented to `parent` whose world-rest position is `pAt`
  const bone = (name: string, at: THREE.Vector3, parent: THREE.Bone, pAt: THREE.Vector3) => {
    const b = new THREE.Bone()
    b.name = name
    b.position.copy(at).sub(pAt)
    parent.add(b)
    bones.push(b)
    return b
  }
  const wristAt = root.position.clone()
  const lateralOf = (dir: THREE.Vector3) => new THREE.Vector3(dir.y, -dir.x, 0).normalize()

  const wristSeg: Seg = {
    digit: 'palm', bone: root, parent: null, child: null,
    a: V(0, -1.6), b: V(0, -0.5), ra: 0.32, rb: 0.3, dir: V(0, 1), lateral: V(1, 0), role: 'wrist',
  }
  segs.push(wristSeg)

  for (const f of FINGERS) {
    const s = SPEC[f]
    const base = V(PALM_AXIS + (s.mcp.x - PALM_AXIS) * 0.55, -0.4)
    const dir = s.mcp.clone().sub(base).normalize()
    const lat = lateralOf(dir)
    const joints = [base, s.mcp.clone()]
    let p = s.mcp.clone()
    for (const l of s.lens) {
      p = p.clone().addScaledVector(dir, l)
      joints.push(p)
    }
    // joints: base, mcp, pip, dip, tip
    const meta = bone(`${f}-meta`, joints[0], root, wristAt)
    const prox = bone(`${f}-prox`, joints[1], meta, joints[0])
    const mid = bone(`${f}-mid`, joints[2], prox, joints[1])
    const dist = bone(`${f}-dist`, joints[3], mid, joints[2])
    const tip = bone(`${f}-tip`, joints[4], dist, joints[3])
    tips[f] = tip
    const [r0, r1] = s.r
    const rAt = (t: number) => r0 + (r1 - r0) * t
    const total = s.lens[0] + s.lens[1] + s.lens[2]
    const tAt = (i: number) => (i === 0 ? 0 : s.lens.slice(0, i).reduce((x, y) => x + y, 0) / total)
    const list: Seg[] = [
      { digit: f, bone: meta, parent: wristSeg, child: null, a: joints[0], b: joints[1], ra: 0.11, rb: r0 * 1.15, dir, lateral: lat, role: 'meta' },
      { digit: f, bone: prox, parent: null, child: null, a: joints[1], b: joints[2], ra: rAt(0), rb: rAt(tAt(1)), dir, lateral: lat, role: 'prox' },
      { digit: f, bone: mid, parent: null, child: null, a: joints[2], b: joints[3], ra: rAt(tAt(1)), rb: rAt(tAt(2)), dir, lateral: lat, role: 'mid' },
      { digit: f, bone: dist, parent: null, child: null, a: joints[3], b: joints[4], ra: rAt(tAt(2)), rb: r1, dir, lateral: lat, role: 'dist' },
    ]
    for (let i = 1; i < list.length; i++) {
      list[i].parent = list[i - 1]
      list[i - 1].child = list[i]
    }
    byDigit[f] = list
    segs.push(...list)
  }

  // thumb
  const tdir = new THREE.Vector3(Math.sin(0.62) * Math.cos(0.5), Math.cos(0.62) * Math.cos(0.5), Math.sin(0.5)).normalize()
  // pad faces the index finger and slightly out of the palm
  const pad = new THREE.Vector3(-0.75, 0.05, 0.66)
  pad.addScaledVector(tdir, -pad.dot(tdir)).normalize()
  const tLat = new THREE.Vector3().crossVectors(tdir, pad).normalize()
  const tj = [THUMB.cmc.clone()]
  for (const l of THUMB.lens) tj.push(tj[tj.length - 1].clone().addScaledVector(tdir, l))
  const tMeta = bone('thumb-meta', tj[0], root, wristAt)
  const tProx = bone('thumb-prox', tj[1], tMeta, tj[0])
  const tDist = bone('thumb-dist', tj[2], tProx, tj[1])
  tips.thumb = bone('thumb-tip', tj[3], tDist, tj[2])
  const tr = (t: number) => THUMB.r[0] + (THUMB.r[1] - THUMB.r[0]) * t
  const tList: Seg[] = [
    { digit: 'thumb', bone: tMeta, parent: wristSeg, child: null, a: tj[0], b: tj[1], ra: tr(0), rb: tr(0.38), dir: tdir, lateral: tLat, role: 'meta' },
    { digit: 'thumb', bone: tProx, parent: null, child: null, a: tj[1], b: tj[2], ra: tr(0.38), rb: tr(0.7), dir: tdir, lateral: tLat, role: 'prox' },
    { digit: 'thumb', bone: tDist, parent: null, child: null, a: tj[2], b: tj[3], ra: tr(0.7), rb: tr(1), dir: tdir, lateral: tLat, role: 'dist' },
  ]
  for (let i = 1; i < tList.length; i++) {
    tList[i].parent = tList[i - 1]
    tList[i - 1].child = tList[i]
  }
  byDigit.thumb = tList
  segs.push(...tList)

  root.updateMatrixWorld(true)

  const qa = new THREE.Quaternion()
  const qb = new THREE.Quaternion()
  const Z = V(0, 0, 1)
  const SPREAD = { index: 0.07, middle: 0.0, ring: -0.06, pinky: -0.13 }
  const setPose = (p: Pose) => {
    for (const f of FINGERS) {
      const [meta, prox, mid, dist] = byDigit[f]
      const c = p[f]
      // ring and pinky metacarpals fold a little in a fist, which cups the palm
      const cup = f === 'pinky' ? 0.22 : f === 'ring' ? 0.1 : 0
      meta.bone.quaternion.setFromAxisAngle(meta.lateral, c * cup)
      qa.setFromAxisAngle(prox.lateral, c * FLEX.prox - 0.04)
      qb.setFromAxisAngle(Z, SPREAD[f] * (0.3 + p.spread) * (1 - c * 0.7))
      prox.bone.quaternion.copy(qb).multiply(qa)
      // PIP leads, DIP follows at about two thirds, as real tendons do
      mid.bone.quaternion.setFromAxisAngle(mid.lateral, Math.min(1, c * 1.06) * FLEX.mid)
      dist.bone.quaternion.setFromAxisAngle(dist.lateral, Math.pow(c, 1.2) * FLEX.dist)
    }
    const [tm, tp, td] = byDigit.thumb
    qa.setFromAxisAngle(V(0, 1, 0), -p.opp * 0.85)
    qb.setFromAxisAngle(tm.lateral, p.thumb * 0.25 + p.opp * 0.2)
    tm.bone.quaternion.copy(qa).multiply(qb)
    tp.bone.quaternion.setFromAxisAngle(tp.lateral, p.thumb * 0.9)
    td.bone.quaternion.setFromAxisAngle(td.lateral, p.thumb * 1.05)
  }

  return { root, bones, segs, byDigit, tips, wristSeg, thumbPad: pad, setPose }
}

// closest point parameter on segment ab
export function segT(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const abz = b.z - a.z
  const t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / (abx * abx + aby * aby + abz * abz)
  return Math.min(1, Math.max(0, t))
}
