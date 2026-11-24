import './styles.css'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { createHero } from './hero/scene'
import { dissolves, trail, cardArt, wordmark } from './ui/pixels'
import { field } from './ui/field'
import { magnetic, tabs, slider, popovers, headings, sequence, form, nav, glitch, drawSvgs } from './ui/components'
import { reducedMotion, range, clamp } from './spring'

gsap.registerPlugin(ScrollTrigger)

const motion = !reducedMotion()
document.documentElement.classList.toggle('no-motion', !motion)

// One clock. Everything that moves registers here and runs on gsap's ticker.
const ticks: ((dt: number, t: number) => void)[] = []
let lastT = performance.now() / 1000

let lenis: Lenis | null = null
if (motion) {
  lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9, touchMultiplier: 1.4 })
  lenis.on('scroll', ScrollTrigger.update)
  if (import.meta.env.DEV) (window as unknown as { lenis: Lenis }).lenis = lenis
}

gsap.ticker.lagSmoothing(0)
gsap.ticker.add((time) => {
  lenis?.raf(time * 1000)
  const now = performance.now() / 1000
  const dt = Math.min(now - lastT, 0.1)
  lastT = now
  for (const f of ticks) f(dt, time)
})

// anchor links go through Lenis so they glide
for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href')!
    const target = id === '#top' ? 0 : document.querySelector<HTMLElement>(id)
    if (target === null) return
    e.preventDefault()
    if (lenis) lenis.scrollTo(target, { duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 4) })
    else if (target === 0) scrollTo(0, 0)
    else (target as HTMLElement).scrollIntoView()
    if (typeof target !== 'number') {
      target.setAttribute('tabindex', '-1')
      target.focus({ preventScroll: true })
    }
  })
}

// ---------- hero ----------
const heroEl = document.querySelector<HTMLElement>('[data-hero]')!
const canvas = heroEl.querySelector<HTMLCanvasElement>('[data-hero-canvas]')!
const caps = [...heroEl.querySelectorAll<HTMLElement>('[data-cap]')]
const gapEl = heroEl.querySelector<HTMLElement>('[data-gap]')!
const states = [...heroEl.querySelectorAll<HTMLElement>('[data-state]')]
const bar = heroEl.querySelector<HTMLElement>('[data-progress]')!
const title = heroEl.querySelector<HTMLElement>('.hero__title')!
const hint = heroEl.querySelector<HTMLElement>('.hero__hint')!
const navStatus = document.querySelector<HTMLElement>('[data-nav-status]')!
const navDot = document.querySelector<HTMLElement>('[data-nav-dot]')!
const vit = heroEl.querySelector<SVGSVGElement>('[data-vitruvian]')!
const spin = vit.querySelector<SVGGElement>('.vt__spin')!

let hero: Awaited<ReturnType<typeof createHero>> | null = null
const heroReady = createHero({ canvas, still: !motion })
  .then((h) => {
    hero = h
    if (import.meta.env.DEV) (window as unknown as { hero: typeof hero }).hero = hero
    hero.setProgress(motion ? scrollP : 0.9)
  })
  .catch((e) => {
    console.warn('hero disabled:', e)
    canvas.remove()
  })

let heroVisible = true
new IntersectionObserver(([e]) => (heroVisible = e.isIntersecting)).observe(heroEl)

let scrollP = motion ? 0 : 0.9
if (motion) {
  ScrollTrigger.create({
    trigger: heroEl,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (st) => {
      scrollP = st.progress
      ;(hero as { setProgress(v: number): void } | null)?.setProgress(st.progress)
    },
  })
}

const capWin = [
  [0.06, 0.24],
  [0.26, 0.42],
  [0.44, 0.58],
  [0.62, 0.84],
]
let lastPhase = -1
let lastGlitchKick = 0
ticks.push((dt) => {
  if (!hero || !heroVisible) return
  const o = hero.frame(dt)
  if (!motion) return
  const p = o.p
  // captions: in with blur, out with blur, driven by the same smoothed progress
  caps.forEach((c, i) => {
    const [a, b] = capWin[i]
    const vin = range(p, a, a + 0.05)
    const vout = range(p, b - 0.04, b)
    const v = vin * (1 - vout)
    c.style.opacity = `${v}`
    c.style.translate = `0 ${(1 - vin) * 24 - vout * 24}px`
    c.style.filter = `blur(${(1 - v) * 8}px)`
  })
  // construction drawing: centred on the contact point, sized so its circle spans ~1.75 units
  const w = o.unit * 1.75 * (1120 / 420)
  vit.style.width = `${w}px`
  vit.style.transform = `translate(${o.sx}px, ${o.sy}px)`
  vit.style.setProperty('--draw', `${Math.min(1, range(p, 0.08, 0.5) * 1.05)}`)
  spin.style.transform = `rotate(${(performance.now() / 1000) * 3 + p * 40}deg)`
  const t = range(p, 0.02, 0.12)
  title.style.opacity = `${1 - t}`
  title.style.translate = `0 ${t * -40}px`
  title.style.filter = `blur(${t * 10}px)`
  hint.style.opacity = `${1 - range(p, 0.01, 0.06)}`
  // HUD
  const mm = o.gap * 95 // 1 unit = palm length, about 95 mm
  gapEl.textContent = p > 0.7 ? 'closed' : `${mm.toFixed(1).padStart(5, '0')} mm`
  const live = p > 0.7
  navStatus.textContent = live ? 'connected' : `${Math.round(mm)} mm apart`
  navDot.classList.toggle('live', live)
  const phase = p < 0.34 ? -1 : p < 0.5 ? 0 : p < 0.7 ? 1 : 2
  states.forEach((s, i) => s.classList.toggle('on', i <= phase))
  bar.style.scale = `${clamp(p)} 1`
  if (phase !== lastPhase) {
    if (phase > lastPhase && phase >= 0) {
      hero.kick(0.9)
      lastGlitchKick = 0.25
    }
    lastPhase = phase
  }
  if (lastGlitchKick > 0) {
    lastGlitchKick -= dt
    if (lastGlitchKick <= 0) hero.kick(0)
  }
  void scrollP
})

// scroll velocity → glitch in the hero
if (lenis) {
  lenis.on('scroll', (l: Lenis) => {
    if (lastGlitchKick <= 0) hero?.kick(clamp(Math.abs(l.velocity) / 90, 0, 0.55))
  })
}

// ---------- the rest ----------
ticks.push(magnetic())
ticks.push(tabs())
ticks.push(slider())
popovers()
headings(motion)
sequence(motion)
drawSvgs(motion)
form()
cardArt()

const navTick = nav()
ticks.push((dt) => navTick(lenis ? lenis.scroll : scrollY, dt))

if (motion) {
  const d = dissolves()
  ticks.push((_, t) => d(t))
  ticks.push(trail(document.querySelector<HTMLCanvasElement>('[data-trail]')!))
  ticks.push(field(document.querySelector<HTMLCanvasElement>('[data-field]')!))
  ticks.push(wordmark(document.querySelector<HTMLCanvasElement>('[data-wordmark]')!))
} else {
  for (const b of document.querySelectorAll<HTMLElement>('[data-dissolve]')) b.style.height = '0'
  const w = document.querySelector<HTMLCanvasElement>('[data-wordmark]')!
  const tick = wordmark(w)
  ticks.push(tick)
}

// footer clock, visitor local time
const clock = document.querySelector<HTMLElement>('[data-clock]')!
setInterval(() => (clock.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false })), 1000)

// ---------- loader: counts real readiness (fonts + first frame), at most ~1.6 s ----------
const loader = document.querySelector<HTMLElement>('[data-loader]')!
const load = loader.querySelector<HTMLElement>('[data-load]')!
const counter = { v: 0 }
const ready = Promise.race([Promise.all([document.fonts.ready, heroReady]), new Promise((r) => setTimeout(r, 2400))])
if (motion) {
  lenis?.stop()
  gsap.to(counter, { v: 80, duration: 0.9, ease: 'power2.out', onUpdate: () => (load.textContent = String(Math.round(counter.v)).padStart(3, '0')) })
  ready.then(() => {
    gsap.to(counter, {
      v: 100,
      duration: 0.35,
      ease: 'power2.out',
      onUpdate: () => (load.textContent = String(Math.round(counter.v)).padStart(3, '0')),
      onComplete: () => {
        loader.classList.add('is-done')
        gsap.to(loader, { clipPath: 'inset(0 0 100% 0)', duration: 0.9, ease: 'expo.inOut', onComplete: () => loader.remove() })
        const word = heroEl.querySelector<HTMLElement>('.hero__word')!
        gsap.from(word, { yPercent: 40, opacity: 0, duration: 1.4, ease: 'expo.out', delay: 0.35, onComplete: () => glitch(word) })
        gsap.from('.hero__sub, .hero__hud', { opacity: 0, y: 16, duration: 1.2, ease: 'expo.out', delay: 0.6, stagger: 0.08 })
        // opacity only: a transform tween would make GSAP clear the CSS translate that centres the nav
        gsap.from('.nav', { opacity: 0, duration: 1, ease: 'expo.out', delay: 0.6 })
        lenis?.start()
        ScrollTrigger.refresh()
      },
    })
  })
} else loader.remove()
