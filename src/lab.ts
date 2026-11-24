import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildHand, type Pose } from './hero/hands'

// Dev-only turntable for checking hand anatomy in fixed poses and views.
const POSES: Record<string, Pose> = {
  open: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0, spread: 0.6, opp: 0 },
  rest: { thumb: 0.2, index: 0.12, middle: 0.2, ring: 0.28, pinky: 0.36, spread: 0.2, opp: 0.15 },
  point: { thumb: 0.35, index: 0, middle: 0.6, ring: 0.7, pinky: 0.75, spread: 0, opp: 0.4 },
  fist: { thumb: 0.8, index: 1, middle: 1, ring: 1, pinky: 1, spread: 0, opp: 0.7 },
  clasp: { thumb: 0.2, index: 0.62, middle: 0.66, ring: 0.68, pinky: 0.7, spread: -0.2, opp: 0 },
}
const VIEWS: Record<string, [number, number, number]> = {
  palm: [0, 0.3, 5], back: [0, 0.3, -5], side: [5, 0.3, 0], three: [3.2, 2, 3.4], top: [0.01, 5.5, 0.2],
}

const canvas = document.querySelector<HTMLCanvasElement>('[data-c]')!
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.toneMapping = THREE.ACESFilmicToneMapping
const scene = new THREE.Scene()
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.7
scene.add(new THREE.AmbientLight(0xffffff, 0.15))
const key = new THREE.DirectionalLight(0xffffff, 2)
key.position.set(2, 4, 5)
scene.add(key)
const rim = new THREE.PointLight(0x2f5bff, 20, 12)
rim.position.set(-3, 2, -3)
scene.add(rim)
const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
cam.position.set(...VIEWS.three)
const controls = new OrbitControls(cam, canvas)
controls.target.set(0, 0.2, 0)

const [h, s] = await Promise.all([buildHand('human'), buildHand('si')])
h.group.position.x = -1.1
s.group.position.x = 1.1
scene.add(h.group, s.group)

const ui = document.querySelector('[data-ui]')!
const state = { pose: 'rest', view: 'three' }
const apply = () => {
  h.setPose(POSES[state.pose])
  s.setPose(POSES[state.pose])
  cam.position.set(...VIEWS[state.view])
  controls.update()
  ui.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.pose || b.dataset.v === state.view))
}
for (const k of Object.keys(POSES)) ui.insertAdjacentHTML('beforeend', `<button data-k="pose" data-v="${k}">${k}</button>`)
for (const k of Object.keys(VIEWS)) ui.insertAdjacentHTML('beforeend', `<button data-k="view" data-v="${k}">${k}</button>`)
ui.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button')
  if (!b) return
  state[b.dataset.k as 'pose' | 'view'] = b.dataset.v!
  apply()
})
;(window as unknown as { lab: unknown }).lab = { state, apply }
apply()

const resize = () => {
  renderer.setSize(innerWidth, innerHeight, false)
  cam.aspect = innerWidth / innerHeight
  cam.updateProjectionMatrix()
}
resize()
addEventListener('resize', resize)
renderer.setAnimationLoop((t) => {
  s.tick(t / 1000)
  renderer.render(scene, cam)
})
