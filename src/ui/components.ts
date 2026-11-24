import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Spring, Spring2, clamp, range } from '../spring'

type Tick = (dt: number) => void

// Magnetic buttons: the button follows the pointer on a spring and snaps back.
export function magnetic(): Tick {
  const items = [...document.querySelectorAll<HTMLElement>('[data-magnetic]')].map((el) => ({ el, s: new Spring2(220, 18), on: false }))
  for (const it of items) {
    it.el.addEventListener('pointermove', (e) => {
      const r = it.el.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      it.s.set((x - r.width / 2) * 0.32, (y - r.height / 2) * 0.42)
      it.el.style.setProperty('--mx', `${x}px`)
      it.el.style.setProperty('--my', `${y}px`)
      it.on = true
    })
    it.el.addEventListener('pointerleave', (e) => {
      const r = it.el.getBoundingClientRect()
      it.el.style.setProperty('--mx', `${e.clientX - r.left}px`)
      it.el.style.setProperty('--my', `${e.clientY - r.top}px`)
      it.s.set(0, 0)
    })
    const label = it.el.querySelector<HTMLElement>('.btn__label')
    if (label) label.innerHTML = `<span class="roll" data-text="${label.dataset.text}">${label.textContent}</span>`
  }
  return (dt) => {
    for (const it of items) {
      if (!it.on) continue
      it.s.step(dt)
      it.el.style.translate = `${it.s.x.value.toFixed(2)}px ${it.s.y.value.toFixed(2)}px`
      if (it.s.x.settled && it.s.y.settled && it.s.x.target === 0) it.on = false
    }
  }
}

// Tabs: roving tabindex, arrow keys, a spring-driven indicator that stretches as it travels.
export function tabs(): Tick {
  const root = document.querySelector<HTMLElement>('[data-tabs]')
  if (!root) return () => {}
  const list = root.querySelector<HTMLElement>('[role=tablist]')!
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role=tab]')]
  const ind = root.querySelector<HTMLElement>('.tabs__ind')!
  const left = new Spring(0, 260, 24)
  const right = new Spring(0, 180, 22) // trailing edge lags: the pill stretches
  let current = 0

  const measure = (i: number, snap = false) => {
    const t = tabs[i]
    const a = t.offsetLeft
    const b = a + t.offsetWidth
    const forward = i >= current
    left.stiffness = forward ? 170 : 300
    right.stiffness = forward ? 300 : 170
    left.target = a
    right.target = b
    if (snap) {
      left.snap(a)
      right.snap(b)
    }
  }

  const select = (i: number, focus = true) => {
    if (i === current) return
    const prev = root.querySelector<HTMLElement>(`#${tabs[current].getAttribute('aria-controls')}`)!
    const next = root.querySelector<HTMLElement>(`#${tabs[i].getAttribute('aria-controls')}`)!
    tabs.forEach((t, k) => {
      t.setAttribute('aria-selected', String(k === i))
      t.tabIndex = k === i ? 0 : -1
    })
    measure(i)
    current = i
    if (focus) tabs[i].focus()
    prev.hidden = true
    next.hidden = false
    gsap.fromTo(next, { clipPath: 'inset(0 0 100% 0)', opacity: 0.4 }, { clipPath: 'inset(0 0 0% 0)', opacity: 1, duration: 0.7, ease: 'expo.out' })
    gsap.fromTo(next.querySelector('.panel__text'), { y: 24 }, { y: 0, duration: 0.9, ease: 'expo.out' })
    animateArt(next)
  }

  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(i, false))
    t.addEventListener('keydown', (e) => {
      const k = e.key
      let n = -1
      if (k === 'ArrowRight') n = (current + 1) % tabs.length
      if (k === 'ArrowLeft') n = (current - 1 + tabs.length) % tabs.length
      if (k === 'Home') n = 0
      if (k === 'End') n = tabs.length - 1
      if (n >= 0) {
        e.preventDefault()
        select(n)
      }
    })
  })
  requestAnimationFrame(() => measure(0, true))
  window.addEventListener('resize', () => measure(current, true))
  document.fonts.ready.then(() => measure(current, true))

  // per-panel svg motion
  const dots = root.querySelector('.grid-dots')
  if (dots) {
    let s = ''
    for (let y = 0; y < 9; y++) for (let x = 0; x < 15; x++) s += `<rect x="${20 + x * 20}" y="${20 + y * 20}" width="3" height="3" fill="currentColor" opacity="0.35"/>`
    dots.innerHTML = s
  }
  function animateArt(panel: HTMLElement) {
    gsap.fromTo(panel.querySelector('.panel__art'), { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 1, ease: 'elastic.out(1, 0.6)' })
  }
  ScrollTrigger.create({ trigger: root, start: 'top 75%', once: true, onEnter: () => animateArt(root.querySelector('.panel:not([hidden])')!) })

  return (dt) => {
    left.step(dt)
    right.step(dt)
    ind.style.transform = `translateX(${left.value}px)`
    ind.style.width = `${Math.max(8, right.value - left.value)}px`
    void list
  }
}

// Draggable slider with spring inertia, snap to cards, keyboard and buttons.
export function slider(): Tick {
  const root = document.querySelector<HTMLElement>('[data-slider]')
  if (!root) return () => {}
  const track = root.querySelector<HTMLElement>('[data-track]')!
  const cards = [...track.children] as HTMLElement[]
  const iEl = document.querySelector('[data-slide-i]')!
  const nEl = document.querySelector('[data-slide-n]')!
  const bar = document.querySelector<HTMLElement>('[data-slide-bar]')!
  const prevB = document.querySelector<HTMLButtonElement>('[data-prev]')!
  const nextB = document.querySelector<HTMLButtonElement>('[data-next]')!
  nEl.textContent = String(cards.length).padStart(2, '0')

  const x = new Spring(0, 140, 22)
  let index = 0
  let dragging = false
  let startX = 0
  let startVal = 0
  let lastX = 0
  let lastT = 0
  let vel = 0
  let moved = 0

  const max = () => Math.max(0, track.scrollWidth - root.clientWidth + parseFloat(getComputedStyle(root).paddingLeft))
  const offsetOf = (i: number) => Math.min(cards[i].offsetLeft, max())

  const go = (i: number) => {
    index = clamp(i, 0, cards.length - 1)
    x.target = -offsetOf(index)
    iEl.textContent = String(index + 1).padStart(2, '0')
    prevB.disabled = index === 0
    nextB.disabled = index === cards.length - 1 || (offsetOf(index) >= max() - 1 && index > 0)
  }

  root.addEventListener('pointerdown', (e) => {
    dragging = true
    moved = 0
    startX = lastX = e.clientX
    startVal = x.value
    lastT = performance.now()
    vel = 0
    root.setPointerCapture(e.pointerId)
  })
  root.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const now = performance.now()
    const dx = e.clientX - startX
    moved = Math.max(moved, Math.abs(dx))
    let v = startVal + dx
    const m = max()
    if (v > 0) v *= 0.35 // rubber band at the edges
    if (v < -m) v = -m + (v + m) * 0.35
    x.target = v
    x.value = v
    vel = ((e.clientX - lastX) / Math.max(1, now - lastT)) * 1000
    lastX = e.clientX
    lastT = now
  })
  const release = () => {
    if (!dragging) return
    dragging = false
    x.velocity = vel
    const projected = x.value + vel * 0.25
    let best = 0
    let bd = Infinity
    cards.forEach((_, i) => {
      const d = Math.abs(-offsetOf(i) - projected)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    go(best)
  }
  root.addEventListener('pointerup', release)
  root.addEventListener('pointercancel', release)
  root.addEventListener('click', (e) => moved > 6 && e.preventDefault(), true)
  root.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') (go(index + 1), e.preventDefault())
    if (e.key === 'ArrowLeft') (go(index - 1), e.preventDefault())
  })
  prevB.addEventListener('click', () => go(index - 1))
  nextB.addEventListener('click', () => go(index + 1))
  window.addEventListener('resize', () => go(index))
  go(0)

  return (dt) => {
    if (!dragging) x.step(dt)
    track.style.transform = `translate3d(${x.value.toFixed(2)}px,0,0)`
    const m = max() || 1
    bar.style.scale = `${clamp(0.12 + (-x.value / m) * 0.88, 0.05, 1)} 1`
    // slight skew from velocity, springs back
    const skew = clamp(x.velocity / 4000, -0.06, 0.06)
    for (const c of cards) c.style.transform = `skewX(${(-skew * 20).toFixed(2)}deg)`
  }
}

// Popovers: native [popover], positioned next to the trigger, open on hover (with
// intent delay) or click, close on Esc/outside (native light dismiss).
export function popovers() {
  const supports = HTMLElement.prototype.hasOwnProperty('popover')
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-pop]')) {
    const pop = document.getElementById(btn.getAttribute('popovertarget')!) as HTMLElement | null
    if (!pop || !supports) continue
    btn.removeAttribute('popovertarget')
    btn.setAttribute('aria-expanded', 'false')
    btn.setAttribute('aria-controls', pop.id)
    let timer = 0
    const place = () => {
      const r = btn.getBoundingClientRect()
      const pw = pop.offsetWidth
      const ph = pop.offsetHeight
      let left = r.left + r.width / 2 - pw / 2
      left = clamp(left, 16, innerWidth - pw - 16)
      let top = r.top - ph - 12
      let oy = '100%'
      if (top < 16) {
        top = r.bottom + 12
        oy = '0%'
      }
      pop.style.left = `${left}px`
      pop.style.top = `${top}px`
      pop.style.setProperty('--ox', `${r.left + r.width / 2 - left}px`)
      pop.style.setProperty('--oy', oy)
    }
    const open = () => {
      if (pop.matches(':popover-open')) return
      pop.showPopover()
      place()
      btn.setAttribute('aria-expanded', 'true')
    }
    const close = () => pop.matches(':popover-open') && pop.hidePopover()
    pop.addEventListener('toggle', (e) => btn.setAttribute('aria-expanded', String((e as ToggleEvent).newState === 'open')))
    btn.addEventListener('click', () => (pop.matches(':popover-open') ? close() : open()))
    btn.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return
      clearTimeout(timer)
      timer = window.setTimeout(open, 180)
    })
    btn.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return
      clearTimeout(timer)
      timer = window.setTimeout(close, 260)
    })
    pop.addEventListener('pointerenter', () => clearTimeout(timer))
    pop.addEventListener('pointerleave', () => (timer = window.setTimeout(close, 200)))
    window.addEventListener('scroll', () => pop.matches(':popover-open') && place(), { passive: true })
  }
}

// Headings: split into lines, rise on enter, then one RGB-split glitch.
export function headings(motion: boolean) {
  for (const h of document.querySelectorAll<HTMLElement>('[data-split]')) {
    if (!motion) continue
    splitLines(h)
    const inners = h.querySelectorAll('.split-inner')
    gsap.set(inners, { yPercent: 110 })
    ScrollTrigger.create({
      trigger: h,
      start: 'top 82%',
      once: true,
      onEnter: () => {
        gsap.to(inners, { yPercent: 0, duration: 1.2, ease: 'expo.out', stagger: 0.07 })
        setTimeout(() => glitch(h), 520)
      },
    })
    h.addEventListener('pointerenter', () => glitch(h))
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-reveal]')) {
    if (!motion) continue
    ScrollTrigger.create({
      trigger: el,
      start: 'top 88%',
      once: true,
      onEnter: () => gsap.to(el, { opacity: 1, translate: '0 0', duration: 1.3, ease: 'expo.out' }),
    })
  }
}

export function glitch(el: HTMLElement) {
  el.classList.remove('glitching')
  void el.offsetWidth
  el.classList.add('glitching')
  el.addEventListener('animationend', () => el.classList.remove('glitching'), { once: true })
}

// Wraps words into line spans after measuring their top offsets. Keeps the heading's
// text content intact for assistive tech.
function splitLines(el: HTMLElement) {
  const label = el.textContent!.replace(/\s+/g, ' ').trim()
  el.setAttribute('aria-label', label)
  type Tok = { node: HTMLElement; space: boolean }
  const toks: Tok[] = []
  let pending = false
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) {
      for (const w of n.textContent!.split(/(\s+)/)) {
        if (!w) continue
        if (/^\s+$/.test(w)) {
          pending = true
          continue
        }
        const s = document.createElement('span')
        s.textContent = w
        toks.push({ node: s, space: pending })
        pending = false
      }
    } else {
      toks.push({ node: n.cloneNode(true) as HTMLElement, space: pending })
      pending = false
    }
  })
  el.textContent = ''
  for (const t of toks) {
    t.node.style.display = 'inline-block'
    if (t.space) el.appendChild(document.createTextNode(' '))
    el.appendChild(t.node)
  }
  const lines: Tok[][] = []
  let top = -1
  for (const t of toks) {
    if (!lines.length || (t.space && Math.abs(t.node.offsetTop - top) > 4)) {
      lines.push([])
      top = t.node.offsetTop
    }
    lines[lines.length - 1].push(t)
  }
  el.textContent = ''
  for (const line of lines) {
    const outer = document.createElement('span')
    outer.className = 'split-line'
    outer.setAttribute('aria-hidden', 'true')
    const inner = document.createElement('span')
    inner.className = 'split-inner'
    line.forEach((t, i) => {
      if (i > 0 && t.space) inner.appendChild(document.createTextNode(' '))
      inner.appendChild(t.node)
    })
    outer.appendChild(inner)
    el.appendChild(outer)
  }
}

// Self-drawing SVG strokes: measure each path, then draw when the figure enters view.
export function drawSvgs(motion: boolean) {
  for (const svg of document.querySelectorAll<SVGSVGElement>('svg[data-draw]')) {
    for (const el of svg.querySelectorAll<SVGGeometryElement>('.draw')) el.style.setProperty('--len', `${Math.ceil(el.getTotalLength())}`)
    if (!motion) {
      svg.classList.add('is-drawn')
      continue
    }
    ScrollTrigger.create({ trigger: svg, start: 'top 80%', once: true, onEnter: () => svg.classList.add('is-drawn') })
  }
}

// Sequence diagram: lines draw as the section scrolls past.
export function sequence(motion: boolean) {
  const root = document.querySelector<HTMLElement>('[data-sequence]')
  if (!root) return
  // the lifeline group is drawn as one, so measure its lines individually
  const strokes = [...root.querySelectorAll<SVGGeometryElement>('[data-seq]')].flatMap((el) =>
    el.tagName === 'g' ? ([...el.querySelectorAll('line')] as SVGGeometryElement[]).map((l) => Object.assign(l, { _k: el.getAttribute('data-seq') })) : [Object.assign(el, { _k: el.getAttribute('data-seq') })],
  )
  const texts = [...root.querySelectorAll<SVGElement>('[data-seq-t]')]
  for (const s of strokes) {
    const len = s.getTotalLength()
    s.style.strokeDasharray = `${len}`
    s.style.strokeDashoffset = motion ? `${len}` : '0'
  }
  if (!motion) return
  texts.forEach((t) => (t.style.opacity = '0'))
  const mobile = matchMedia('(max-width: 900px)').matches
  ScrollTrigger.create({
    trigger: root,
    start: mobile ? 'top 70%' : 'top top',
    end: mobile ? 'bottom 60%' : 'bottom bottom',
    scrub: true,
    onUpdate: (st) => {
      const p = st.progress
      for (const s of strokes) {
        const k = Number((s as unknown as { _k: string })._k)
        const a = k === 0 ? 0 : 0.08 + (k - 1) * 0.2
        const t = range(p, a, a + 0.16)
        const len = s.getTotalLength()
        s.style.strokeDashoffset = `${(1 - t) * len}`
        // after drawing, the arcs keep a slow signal flow
        if (k > 0 && k < 4) s.style.strokeDasharray = t >= 1 ? '10 6' : `${len}`
      }
      for (const t of texts) {
        const k = Number(t.dataset.seqT)
        const a = 0.16 + (k - 1) * 0.2
        const v = range(p, a, a + 0.08)
        t.style.opacity = `${v}`
        t.style.transform = `translateY(${(1 - v) * 10}px)`
      }
    },
  })
}

export function form() {
  const f = document.querySelector<HTMLFormElement>('[data-form]')
  if (!f) return
  const input = f.querySelector<HTMLInputElement>('input')!
  const msg = f.querySelector<HTMLElement>('.form__msg')!
  f.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!input.checkValidity() || !input.value) {
      input.setAttribute('aria-invalid', 'true')
      msg.className = 'form__msg err'
      msg.textContent = input.value ? 'That address is missing something. Check the part after the @.' : 'Add an email address first.'
      glitch(input as unknown as HTMLElement)
      input.focus()
      return
    }
    input.removeAttribute('aria-invalid')
    msg.className = 'form__msg ok'
    msg.textContent = 'Opening your mail app with the request filled in.'
    const body = encodeURIComponent(`Please let me know when qconnect opens.\n\nReply to: ${input.value}`)
    window.location.href = `mailto:hello@qconnect.si?subject=${encodeURIComponent('qconnect access')}&body=${body}`
  })
  input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid') && input.checkValidity()) {
      input.removeAttribute('aria-invalid')
      msg.textContent = ''
    }
  })
}

// Nav: hides on scroll down and returns on scroll up, marks the current section, and
// a cyan pill springs between links (to the hovered one, else the current one).
export function nav() {
  const el = document.querySelector<HTMLElement>('[data-nav]')!
  const menu = el.querySelector<HTMLElement>('.nav__menu')!
  const ind = el.querySelector<HTMLElement>('.nav__ind')!
  const bar = el.querySelector<HTMLElement>('[data-nav-progress]')!
  const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-link]')]
  const left = new Spring(0, 260, 24)
  const right = new Spring(0, 200, 22)
  let hovered: HTMLElement | null = null
  let current: HTMLElement | null = null
  let last = 0
  let placed = false
  el.classList.add('at-top')

  for (const a of links) {
    const sec = document.querySelector(a.getAttribute('href')!)
    if (sec)
      ScrollTrigger.create({
        trigger: sec,
        start: 'top 50%',
        end: 'bottom 50%',
        onToggle: (st) => {
          if (st.isActive) {
            a.setAttribute('aria-current', 'true')
            current = a
          } else {
            a.removeAttribute('aria-current')
            if (current === a) current = null
          }
        },
      })
    a.addEventListener('pointerenter', () => (hovered = a))
    a.addEventListener('focus', () => (hovered = a))
    a.addEventListener('blur', () => hovered === a && (hovered = null))
  }
  menu.addEventListener('pointerleave', () => (hovered = null))

  return (y: number, dt: number) => {
    const down = y > last + 2
    const up = y < last - 2
    el.classList.toggle('at-top', y < 40)
    if (down && y > 200) el.classList.add('is-hidden')
    if (up) el.classList.remove('is-hidden')
    last = y
    const max = document.documentElement.scrollHeight - innerHeight
    bar.style.scale = `${max > 0 ? Math.min(1, y / max) : 0} 1`

    const target = hovered ?? current
    ind.classList.toggle('on', !!target)
    if (target) {
      const a = target.offsetLeft + 4
      const b = a + target.offsetWidth
      // the trailing edge lags, so the pill stretches toward where it is going
      const fwd = a >= left.target
      left.stiffness = fwd ? 170 : 300
      right.stiffness = fwd ? 300 : 170
      left.target = a
      right.target = b
      if (!placed) {
        left.snap(a)
        right.snap(b)
        placed = true
      }
    }
    left.step(dt)
    right.step(dt)
    ind.style.transform = `translateX(${left.value.toFixed(2)}px)`
    ind.style.width = `${Math.max(10, right.value - left.value).toFixed(2)}px`
  }
}
