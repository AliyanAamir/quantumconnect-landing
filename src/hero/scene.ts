import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { buildHand, mixPose, type Pose } from './hands'
import { Spring, range, smooth, easeInOut, lerp, clamp } from '../spring'

// Poses. Human is the relaxed hand from the fresco; SI points with intent.
const HUMAN_REACH: Pose = { thumb: 0.2, index: 0.1, middle: 0.26, ring: 0.34, pinky: 0.42, spread: 0.1, opp: 0.1 }
const SI_REACH: Pose = { thumb: 0.35, index: 0.0, middle: 0.55, ring: 0.68, pinky: 0.74, spread: 0.0, opp: 0.35 }
const HUMAN_TOUCH: Pose = { thumb: 0.22, index: 0.02, middle: 0.3, ring: 0.38, pinky: 0.46, spread: 0.08, opp: 0.12 }

// tip bones sit at the centre of the fingertip; this is the pad radius beyond it
const TIP_R = 0.08

const BG = 0xf7fafb // white with a breath of the logo cyan

const quatFromAxes = (finger: THREE.Vector3, palm: THREE.Vector3) => {
  const y = finger.clone().normalize()
  const z = palm.clone().normalize()
  const x = new THREE.Vector3().crossVectors(y, z).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

const GLITCH = {
  uniforms: { tDiffuse: { value: null }, uAmt: { value: 0 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uAmt; uniform float uTime; uniform vec2 uRes;
    varying vec2 vUv;
    float h(float n){ return fract(sin(n)*43758.5453); }
    void main(){
      vec2 uv = vUv;
      float band = floor(uv.y * 48.0 + floor(uTime * 18.0) * 7.0);
      float on = step(1.0 - uAmt * 0.6, h(band));
      uv.x += (h(band + 3.1) - 0.5) * 0.08 * uAmt * on;
      // pixelate the rows that tear
      float px = mix(1.0, 18.0, on * uAmt);
      vec2 cell = px / uRes;
      vec2 puv = (floor(uv / cell) + 0.5) * cell;
      uv = mix(uv, puv, on);
      float off = 0.004 * uAmt + 0.0006;
      vec4 c;
      c.r = texture2D(tDiffuse, uv + vec2(off, 0.0)).r;
      c.g = texture2D(tDiffuse, uv).g;
      c.b = texture2D(tDiffuse, uv - vec2(off, 0.0)).b;
      c.a = 1.0;
      // scanlines + grain
      c.rgb *= 0.985 + 0.015 * sin(vUv.y * uRes.y * 1.4);
      c.rgb += (h(dot(vUv, vec2(12.9, 78.2)) + uTime) - 0.5) * 0.02;
      // soft teal vignette
      vec2 q = vUv - 0.5; c.rgb = mix(c.rgb, c.rgb * vec3(0.93, 0.965, 0.97), smoothstep(0.15, 0.5, dot(q, q)));
      gl_FragColor = c;
    }`,
}

export async function createHero(opts: { canvas: HTMLCanvasElement; still: boolean }) {
  const { canvas, still } = opts
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1
  renderer.setClearColor(BG, 1)

  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(BG, 9, 22)
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.6

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60)

  // lights: red from the human side, blue from the SI side
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6fa9b1, 0.55))
  const key = new THREE.DirectionalLight(0xffffff, 2.1)
  key.position.set(1, 4, 5)
  scene.add(key)
  const rimR = new THREE.PointLight(0x035f67, 10, 14, 1.6)
  rimR.position.set(-3.5, 1.2, -2.5)
  scene.add(rimR)
  const rimB = new THREE.PointLight(0x85d1dc, 18, 14, 1.6)
  rimB.position.set(3.5, 1.4, -2.5)
  scene.add(rimB)
  const under = new THREE.DirectionalLight(0x85d1dc, 0.4)
  under.position.set(0, -3, 2)
  scene.add(under)

  const [human, si] = await Promise.all([buildHand('human'), buildHand('si')])
  scene.add(human.group, si.group)

  // reach orientation (fingers toward each other, palms down, tilted a touch to camera)
  const qHumanReach = quatFromAxes(V(1, -0.04, 0), V(0, -0.86, 0.5))
  const qSiReach = quatFromAxes(V(-1, 0.05, 0), V(0, -0.92, 0.38))

  // spark between fingertips
  const spark = new THREE.Group()
  scene.add(spark)
  const sparkLight = new THREE.PointLight(0x85d1dc, 0, 4, 1.4)
  spark.add(sparkLight)
  const glowTex = (() => {
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const g = c.getContext('2d')!
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    r.addColorStop(0, 'rgba(255,255,255,1)')
    r.addColorStop(0.16, 'rgba(133,209,220,0.95)')
    r.addColorStop(0.45, 'rgba(3,95,103,0.18)')
    r.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = r
    g.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(c)
  })()
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, depthWrite: false, transparent: true, opacity: 0 }))
  spark.add(glow)

  const ARC_N = 24
  const makeArc = (color: number) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ARC_N * 3), 3))
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 }))
    l.frustumCulled = false
    scene.add(l)
    return l
  }
  const arcs = [makeArc(0x035f67), makeArc(0x85d1dc), makeArc(0x022b30)]

  // shockwave rings at the moment of contact and at the clasp
  const ringGeo = new THREE.RingGeometry(0.96, 1, 96)
  const rings = [0x035f67, 0x85d1dc, 0x035f67].map((c) => {
    const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }))
    scene.add(r)
    return r
  })

  // pixel dust: square points, mostly white, some blue and red
  const N = 1600
  const pos = new Float32Array(N * 3)
  const col = new Float32Array(N * 3)
  const seed = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 26
    pos[i * 3 + 1] = (Math.random() - 0.5) * 14
    pos[i * 3 + 2] = -Math.random() * 14 + 2
    const r = Math.random()
    const c = r < 0.25 ? [0.01, 0.37, 0.4] : r < 0.5 ? [0.52, 0.82, 0.86] : [0.62, 0.72, 0.74]
    col.set(c, i * 3)
    seed[i] = Math.random()
  }
  const dustGeo = new THREE.BufferGeometry()
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  dustGeo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 0.03, vertexColors: true, transparent: true, opacity: 0.55, sizeAttenuation: true, depthWrite: false }))
  scene.add(dust)

  // signal streams: particles run up each arm and out through the index finger
  const STREAM_N = 340
  const bgCol = new THREE.Color(BG)
  const makeStream = (hand: typeof human, color: number) => {
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(STREAM_N * 3)
    const col = new Float32Array(STREAM_N * 3)
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.045, vertexColors: true, sizeAttenuation: true, depthWrite: false }))
    pts.frustumCulled = false
    scene.add(pts)
    const seed = Array.from({ length: STREAM_N }, () => ({
      u: Math.random(),
      speed: 0.05 + Math.random() * 0.07,
      ang: Math.random() * Math.PI * 2,
      rad: 0.34 + Math.random() * 0.24,
    }))
    const idx = hand.skeleton.byDigit.index
    const nodes = [hand.skeleton.root, idx[0].bone, idx[1].bone, idx[2].bone, idx[3].bone, hand.skeleton.tips.index]
    const anchor = new THREE.Object3D()
    anchor.position.set(0, -4.2, 0)
    hand.group.add(anchor)
    const path = Array.from({ length: nodes.length + 1 }, () => new THREE.Vector3())
    const cum = new Float32Array(path.length)
    const base = new THREE.Color(color)
    const tmp = new THREE.Vector3()
    const c = new THREE.Color()
    return (dt: number, strength: number) => {
      anchor.getWorldPosition(path[0])
      nodes.forEach((n, i) => n.getWorldPosition(path[i + 1]))
      cum[0] = 0
      for (let i = 1; i < path.length; i++) cum[i] = cum[i - 1] + path[i].distanceTo(path[i - 1])
      const total = cum[cum.length - 1]
      for (let i = 0; i < STREAM_N; i++) {
        const sd = seed[i]
        sd.u = (sd.u + sd.speed * dt * (0.6 + strength * 1.6)) % 1
        const d = sd.u * total
        let k = 1
        while (k < cum.length - 1 && cum[k] < d) k++
        const t = (d - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1])
        tmp.lerpVectors(path[k - 1], path[k], t)
        // a loose sheath around the arm that tightens into the finger
        const r = 0.11 + (sd.rad - 0.11) * (1 - sd.u) ** 1.2
        tmp.y += Math.sin(sd.ang + sd.u * 9) * r
        tmp.z += Math.cos(sd.ang + sd.u * 9) * r
        pos[i * 3] = tmp.x
        pos[i * 3 + 1] = tmp.y
        pos[i * 3 + 2] = tmp.z
        const fade = Math.sin(sd.u * Math.PI) * strength
        c.copy(bgCol).lerp(base, Math.min(1, fade * 2.2))
        col[i * 3] = c.r
        col[i * 3 + 1] = c.g
        col[i * 3 + 2] = c.b
      }
      geo.attributes.position.needsUpdate = true
      geo.attributes.color.needsUpdate = true
    }
  }
  const streamH = makeStream(human, 0x035f67)
  const streamS = makeStream(si, 0x3fa9b7)

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.45, 1.6)
  composer.addPass(bloom)
  const glitch = new ShaderPass(GLITCH)
  composer.addPass(glitch)
  composer.addPass(new OutputPass())

  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || window.innerHeight
    renderer.setSize(w, h, false)
    composer.setSize(w, h)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    glitch.uniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio())
  }
  resize()
  window.addEventListener('resize', resize)

  // state
  const progress = new Spring(still ? 0.9 : 0, 60, 16)
  const glitchAmt = new Spring(0, 120, 18)
  const pointer = { x: 0, y: 0, sx: new Spring(0, 40, 12), sy: new Spring(0, 40, 12) }
  window.addEventListener('pointermove', (e) => {
    pointer.sx.target = (e.clientX / window.innerWidth - 0.5) * 2
    pointer.sy.target = (e.clientY / window.innerHeight - 0.5) * 2
  })

  // Where each index fingertip sits relative to its hand origin in the reach pose,
  // so the hands can be placed with the tips exactly a few millimetres apart.
  const tipOffset = (hand: typeof human, q: THREE.Quaternion, pose: Pose) => {
    hand.group.position.set(0, 0, 0)
    hand.group.quaternion.copy(q)
    hand.setPose(pose)
    hand.group.updateMatrixWorld(true)
    return hand.indexTip.getWorldPosition(new THREE.Vector3())
  }
  const hTip = tipOffset(human, qHumanReach, HUMAN_REACH)
  const sTip = tipOffset(si, qSiReach, SI_REACH)

  const tmpA = new THREE.Vector3()
  const tmpB = new THREE.Vector3()
  const mid = new THREE.Vector3()
  const camPos = new THREE.Vector3()
  const camLook = new THREE.Vector3()
  const narrow = () => camera.aspect < 0.9

  let time = 0
  let lastGap = 0
  const out = { gap: 0, phase: 0, p: 0, sx: 0, sy: 0, unit: 100, approach: 0 }

  function frame(dt: number) {
    time += dt
    const p = progress.step(dt)
    glitchAmt.step(dt)
    pointer.sx.step(dt)
    pointer.sy.step(dt)

    const approach = smooth(range(p, 0.02, 0.4))
    const charge = range(p, 0.36, 0.56)
    const touch = easeInOut(range(p, 0.54, 0.7)) // the last few millimetres close
    const hold = smooth(range(p, 0.7, 1)) // contact held, camera drifts round it
    const n = narrow()

    // positions: everything is placed from the fingertips, so they meet exactly
    const spread = (1 - approach) * (n ? 0.9 : 3.2)
    const kiss = charge * 0.06
    const breathe = Math.sin(time * 1.1) * 0.025 * (1 - touch)
    const half = lerp(0.05 - kiss * 0.8 + TIP_R, TIP_R - 0.004, touch)
    human.group.position.set(-half - spread, -0.02 - (1 - approach) * 0.35 + breathe, 0).sub(hTip)
    si.group.position.set(half + spread, 0.02 + (1 - approach) * 0.35 - breathe, 0).sub(sTip)
    human.group.quaternion.copy(qHumanReach)
    si.group.quaternion.copy(qSiReach)
    human.setPose(mixPose(HUMAN_REACH, HUMAN_TOUCH, touch))
    si.setPose(SI_REACH)

    scene.updateMatrixWorld()
    human.indexTip.getWorldPosition(tmpA)
    si.indexTip.getWorldPosition(tmpB)
    mid.addVectors(tmpA, tmpB).multiplyScalar(0.5)
    const gap = Math.max(0, tmpA.distanceTo(tmpB) - TIP_R * 2)
    lastGap = gap

    // spark builds across the gap, then settles into a steady link once they touch
    const sparkOn = Math.sin(clamp(charge) * Math.PI * 0.5) * (1 - touch)
    const link = touch * (0.75 + 0.25 * Math.sin(time * 3))
    spark.position.copy(mid)
    sparkLight.intensity = sparkOn * 3.5 + link * 2.2
    glow.material.opacity = Math.max(sparkOn * 0.8, link * 0.7)
    const gs = 0.12 + sparkOn * 0.42 + link * 0.3 + Math.sin(time * 30) * 0.02 * sparkOn
    glow.scale.set(gs, gs, gs)
    arcs.forEach((arc, k) => {
      const a = arc.geometry.attributes.position as THREE.BufferAttribute
      const jitter = 0.035 + k * 0.012
      for (let i = 0; i < ARC_N; i++) {
        const t = i / (ARC_N - 1)
        const env = Math.sin(t * Math.PI)
        a.setXYZ(
          i,
          lerp(tmpA.x, tmpB.x, t) + (Math.random() - 0.5) * jitter * env * 0.3,
          lerp(tmpA.y, tmpB.y, t) + (Math.random() - 0.5) * jitter * env,
          lerp(tmpA.z, tmpB.z, t) + (Math.random() - 0.5) * jitter * env,
        )
      }
      a.needsUpdate = true
      ;(arc.material as THREE.LineBasicMaterial).opacity = sparkOn * (k === 0 ? 1 : 0.8) * (Math.random() > 0.15 ? 1 : 0.2)
    })

    // rings: a burst at contact, then a slow wider one while the contact holds
    const burstA = range(p, 0.6, 0.76)
    const burstB = range(p, 0.8, 0.98)
    rings.forEach((r, i) => {
      const b = i < 2 ? burstA : burstB
      const t = clamp(b - (i === 1 ? 0.06 : 0))
      r.scale.setScalar(0.05 + easeOutExpo(t) * (i === 2 ? 3.2 : 1.8))
      r.position.copy(mid)
      r.lookAt(camera.position)
      ;(r.material as THREE.MeshBasicMaterial).opacity = t > 0 && t < 1 ? (1 - t) * 0.55 : 0
    })

    human.tick(time)
    si.tick(time)
    const flow = 0.35 + approach * 0.4 + charge * 0.25
    streamH(dt, flow)
    streamS(dt, flow)
    si.glow.forEach((m) => ((m as THREE.MeshStandardMaterial).emissiveIntensity = 0.8 + Math.sin(time * 2) * 0.25 + sparkOn * 1.2 + link * 0.5))

    // camera: wide, dolly to the gap, then drift round the point of contact
    const zWide = n ? 13 : 9.2
    const zGap = n ? 7.5 : 5.4
    const camIn = smooth(range(p, 0.12, 0.46))
    const orbit = hold * 0.55 + Math.sin(time * 0.25) * 0.05 * hold
    const dist = lerp(lerp(zWide, zGap, camIn), zGap * 1.12, hold)
    const height = lerp(lerp(0.25, 0.05, camIn), 0.85, hold)
    camLook.set(mid.x * camIn, mid.y * camIn, 0)
    camPos.set(
      camLook.x + Math.sin(orbit) * dist + pointer.sx.value * 0.25,
      height - pointer.sy.value * 0.18,
      Math.cos(orbit) * dist,
    )
    camera.position.copy(camPos)
    camera.lookAt(camLook)

    // dust drift
    dust.rotation.y = time * 0.01 + p * 0.4
    dust.position.y = Math.sin(time * 0.2) * 0.1

    bloom.strength = 0.12 + sparkOn * 0.25 + link * 0.1
    glitch.uniforms.uTime.value = time
    glitch.uniforms.uAmt.value = clamp(glitchAmt.value + sparkOn * 0.12 * (Math.random() > 0.92 ? 1 : 0))

    composer.render()

    // where the contact point lands on screen, and how many px one world unit spans there
    const scr = mid.clone().project(camera)
    const edge = mid.clone().add(new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)).project(camera)
    out.sx = (scr.x * 0.5 + 0.5) * canvas.clientWidth
    out.sy = (-scr.y * 0.5 + 0.5) * canvas.clientHeight
    out.unit = Math.abs(edge.x - scr.x) * 0.5 * canvas.clientWidth
    out.approach = approach
    out.gap = gap
    out.phase = p < 0.4 ? 0 : p < 0.62 ? 1 : 2
    out.p = p
    return out
  }

  function easeOutExpo(t: number) {
    return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
  }

  return {
    frame,
    setProgress(v: number) {
      progress.target = v
    },
    debug: { human, si },
    snap() {
      progress.snap(progress.target)
    },
    kick(v: number) {
      glitchAmt.target = clamp(Math.abs(v))
    },
    get gap() {
      return lastGap
    },
    resize,
  }
}
