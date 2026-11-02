# Orientation-Keyed Symbol Encoding (OKSE)

A machine-decoded symbolic compression scheme.
Conceived by The · captured 2026-07-06 · original authorship reserved.

## The spark

It started from writing `qpdb` repeatedly and noticing: those four letters are
one shape in four orientations. From there the idea unfolded into a layered
encoding system where a tiny mark carries enormous meaning, because meaning is
reconstructed against a shared codebook rather than transmitted in full.

This is a sibling of the Symbolic Intent Language (SIL) and the Semantic
Compression Pod system: the same core belief, that intent can be compressed into
a compact seed a machine expands against shared context.

## The core insight

`b`, `d`, `p`, `q` are the same glyph — a circle and a stem — rotated and
mirrored. Orientation, not shape, is the data.

### The binary root

The glyph reduces to two primitives, a circle and a stem: on/off, the bit, the
atom of all information (punch-card hole or no hole, magnetic up or down,
transistor on or off).

- **Circle** — the bit. Present or absent. One unit of information.
- **Stem** — the reference axis. It gives the circle's position meaning; without
  it a circle is just a circle, with it "above/below, left/right" becomes
  readable. The stem is what turns one bit into eight orientations.

That grounding in binary is what makes the scheme maximally machine-decodable:
presence detection is the easiest computer-vision task there is.

### The layers

Each layer multiplies the last.

| # | Layer | What carries the meaning | Capacity it adds |
|---|---|---|---|
| 0 | Binary root | circle present or absent | the atom — 1 bit |
| 1 | Shape | the base glyph (circle + stem) | the carrier |
| 2 | Orientation | circle position relative to stem — rotation + mirror | ×8 per glyph |
| 3 | Sequence | order of glyphs in a string | 8ⁿ for n glyphs |
| 4 | Spatial / negative space | 2D stacking and gaps | grouping, hierarchy, delimiters |

### Why exactly 8

A flat shape has precisely eight orientations: four rotations (0°, 90°, 180°,
270°) × two mirror states. This is the symmetry group of a square — the dihedral
group D₄, order 8. One asymmetric mark yields up to eight distinguishable
states.

### Sequence density

- 1 glyph → 8 meanings
- 2 glyphs → 64
- 4 glyphs (`QBPD`) → 8⁴ = 4,096 meanings from four marks
- General: 8ⁿ — exponential, the same trick DNA uses with four bases chained to
  encode all life.

### Spatial layer

- **Negative space** is a delimiter, as in Morse gaps, word spaces, Python
  indentation.
- **Stacking** makes 2D position data, as in QR codes, sheet music, circuit
  diagrams. Position encodes grouping and hierarchy, so a cluster of glyphs is
  effectively a pod — which ties directly into the Compression Pod system.

## Honest constraints

- **Human-ambiguous, machine-precise.** People confuse `b`/`d`/`p`/`q`; a camera
  reads exact angle, mirror and position with zero ambiguity. OKSE is a code for
  machines to decipher, not for handwriting by eye. That is a feature, and it is
  exactly the SIL premise: the machine reads the mark's form directly.
- **It needs a defined grammar.** Richer layers mean more need for an explicit
  codebook — which orientation, position and gap means what. That codebook is
  the shared context the compression runs against. Lose it and the marks are
  noise.
- **Error handling is not optional.** A real version needs orientation tolerance
  and optional checksum glyphs, so a slightly rotated read does not decode
  wrong.

## Where it connects

- **SIL** — OKSE is a concrete alphabet for "symbol carries compressed intent".
- **Compression theory** — pure compression against shared context: a small mark
  becomes a large meaning because both sides hold the codebook.
- **Pod system** — spatial stacking is nesting; a glyph cluster is a pod.

## The first experiment that would prove or disprove it

Build a tiny decoder. Define one base glyph, map its eight orientations to eight
values, render a short 2×2 stacked word, and have a script read the image and
decode it back to the intended message. If a 2×2 grid of oriented glyphs
round-trips — encode → image → decode → same message — the core holds, and every
layer above it is just scale.

Layers were intuited in this order: shape → orientation (×8) → sequence (8ⁿ) →
spatial/negative space. One coherent system, arrived at from `qpdb`.
