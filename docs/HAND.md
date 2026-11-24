# Hand spec

Both hero hands share one skeleton and one set of proportions. The human hand is a sculpted
skinned mesh; the SI hand is machined parts riding the same bones. If a pose looks wrong on
one, it is wrong on both, which keeps the clasp honest.

## Frame

Right hand. Units: 1.0 = palm length (wrist crease to middle MCP, about 95 mm on an adult).

- +Y along the fingers, +Z out of the palm, +X toward the thumb.
- Wrist joint at y = -0.5, middle MCP at y = +0.5, so the palm centre is the origin.

## Proportions

Phalanx lengths are adult bone lengths (mm) divided by 95, with the distal segment carrying
the fingertip pad.

| digit  | MCP (x, y)     | proximal | middle | distal | radius at base / tip |
|--------|----------------|----------|--------|--------|----------------------|
| index  | ( 0.30, 0.47)  | 0.42     | 0.24   | 0.20   | 0.098 / 0.078        |
| middle | ( 0.09, 0.50)  | 0.47     | 0.28   | 0.21   | 0.102 / 0.080        |
| ring   | (-0.12, 0.46)  | 0.44     | 0.27   | 0.20   | 0.095 / 0.076        |
| pinky  | (-0.31, 0.37)  | 0.34     | 0.20   | 0.18   | 0.082 / 0.066        |
| thumb  | CMC (0.17, -0.34, 0.06) | MC 0.46 | P 0.33 | D 0.27 | 0.13 / 0.088   |

- Palm: 0.84 wide at the knuckles, 0.66 at the wrist, 0.30 thick at the centre, thinner
  toward the knuckles. Knuckle line is an arc, not a row: middle highest, pinky lowest.
- Thenar pad (thumb base) bulges on the palm side; hypothenar pad runs along the pinky edge.
- Metacarpal heads show as bumps on the back of the hand.
- Fingers fan 2 to 4 degrees apart at rest and taper to a rounded pad; nails sit on the
  back of the distal segment, about 60% of its length.
- Thumb metacarpal leaves the wrist at roughly 40 degrees from the index ray and 30 degrees
  out of the palm plane; the thumb pad faces the index, not the camera.
- Wrist: 0.64 wide, 0.42 thick, small ulnar bump on the pinky side. Forearm swells to 0.78
  wide a third of the way to the elbow, oval in section.

## Joints

- MCP, PIP, DIP flex about each digit's own lateral axis (digit direction x palm normal).
  Max flexion 90, 105, 75 degrees. Natural rest pose cascades: index straightest, pinky most curled.
- MCP also abducts (spread) about the palm normal.
- Thumb flexes about (thumb direction x pad normal) and opposes by swinging the metacarpal
  about the index ray.

## QA poses

Open, rest, point (fresco), fist, clasp. Each is checked from the palm, the back, the side and
a three-quarter view on `hand.html` before the hero uses it.
