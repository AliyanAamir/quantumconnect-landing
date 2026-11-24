# qconnect.si

## Concept card

Idea:        Fingertips of a person and a super intelligence meeting, staged as a fresco.
Metaphor:    The ceiling fresco gap between two reaching fingers, finished as a network handshake (SYN, SYN-ACK, ACK).
Signature:   Scroll-driven 3D hero. A porcelain human hand and a machined SI hand reach across the dark,
             fingertips stop a few millimetres apart, a spark jumps the gap, then both turn and clasp.
Emotion:     Held breath, then relief.
Motion verb: "close the gap": things approach on a spring, overshoot a hair, settle.
Screenshot:  The two index fingertips with the blue/red arc between them.

## Palette

| role    | hex     |
|---------|---------|
| ground  | #000000 |
| ink     | #ffffff |
| human   | #ff2b2b (red: pulse, blood, the human side) |
| si      | #85d1dc (cyan: the super intelligence side) |
| muted   | rgba(255,255,255,.62) on black / rgba(0,0,0,.62) on white |

Sections alternate black and white. Boundaries are crossed with a pixel dissolve, never a hard cut.

## Type

- Archivo variable (wdth 62..125): expanded and heavy for display, normal width for body. The SI voice.
- Instrument Serif italic: single words inside headings. The human voice.
- JetBrains Mono: only for protocol labels, frame counters and measurements.

## Motion

- One clock: gsap.ticker drives Lenis, the hero, springs, the pixel trail and the shader.
- Springs (stiffness/damping) for cursor-linked UI, tab indicator, slider, magnetic buttons, hero progress.
- Scroll velocity feeds a chromatic glitch pass in the hero and the RGB split on headings.
- Reduced motion: no smooth scroll, no GL animation, hero shows the clasp frame, everything visible.
