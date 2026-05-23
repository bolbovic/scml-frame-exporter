# scml-frame-exporter

Export BrashMonkey Spriter `.scml` sprite animations to PNG frame sequences, spritesheets, and animated GIFs.

## Run Without Cloning

After the package is published to npm, users can run the CLI directly against their own SCML file and assets:

```bash
npx scml-frame-exporter --scml ./assets/player/Animations.scml --list-animations
```

```bash
bun x scml-frame-exporter --scml ./assets/player/Animations.scml --list-animations
```

The `--assets` directory defaults to the directory that contains the SCML file. Pass it explicitly when the PNG assets live somewhere else.

## Render One Animation

```bash
npx scml-frame-exporter \
  --scml ./assets/player/Animations.scml \
  --assets ./assets/player \
  --animation "Walking" \
  --out ./exports/player/walking \
  --fps 12 \
  --scale 1 \
  --canvas-size 535,499 \
  --spritesheet ./exports/player/walking-sheet.png \
  --gif
```

Frames are written as:

```text
exports/player/walking/frame_0000.png
exports/player/walking/frame_0001.png
exports/player/walking/frame_0002.png
```

With `--gif`, the CLI writes a GIF next to the output directory, such as `exports/player/walking.gif`. Pass a path to choose the GIF filename:

```bash
npx scml-frame-exporter \
  --scml ./assets/player/Animations.scml \
  --assets ./assets/player \
  --animation "Walking" \
  --out ./exports/player/walking \
  --gif ./exports/player/walking-preview.gif
```

## Render All Animations

Use `--all-animations` to export every animation in the SCML file. Each animation is written to its own sanitized subdirectory under `--out`.

```bash
bun x scml-frame-exporter \
  --scml ./assets/player/Animations.scml \
  --assets ./assets/player \
  --all-animations \
  --out ./exports/player \
  --fps 12 \
  --scale 1 \
  --spritesheet ./exports/sheets \
  --gif
```

When `--spritesheet` is a directory in `--all-animations` mode, the CLI writes one sheet per animation, such as `exports/sheets/walking.png`.
When it ends in `.png`, the animation name is added to the filename, such as `exports/sheet-walking.png`.
When `--gif` is used in `--all-animations` mode without a path, the CLI writes one GIF per animation under `--out`, such as `exports/player/walking.gif`. If `--gif` receives a directory, it writes `walking.gif` inside that directory. If `--gif` receives a `.gif` path, the animation name is added to the filename.

By default the renderer computes a stable bounding box from the sampled sprites so exported SCML crops cannot accidentally clip the character. Add `--use-scml-bounds` if you specifically want the animation `l/t/r/b` bounds from the SCML file.

## Fixed Canvas Size

Use `--canvas-size` when every exported frame should have the same PNG dimensions. Pass `WIDTH,HEIGHT`, or pass a single value for a square canvas:

```bash
npx scml-frame-exporter \
  --scml ./assets/player/Animations.scml \
  --assets ./assets/player \
  --all-animations \
  --out ./exports/player \
  --fps 12 \
  --scale 1 \
  --canvas-size 535,499
```

`--canvas-size` is the final PNG size in pixels. When a fixed canvas is set, `--scale` acts like zoom inside that fixed output size. Fixed-canvas renders are anchored to the SCML animation bounds when available. In `--all-animations` mode, the fixed canvas is anchored to the combined SCML animation bounds so different animations do not shift around just because their tight sprite bounds differ.

Use `--shift-x` and `--shift-y` to move the rendered animation inside the fixed canvas. Values are pixels after scaling. Positive `--shift-x` moves the animation right; negative moves it left. Positive `--shift-y` moves it down; negative moves it up.

## Options

```text
--scml <path>          Required path to the .scml file
--assets <dir>         Directory containing PNG assets; defaults to the SCML directory
--animation <name>     Animation name to render
--all-animations       Render every animation in the SCML file
--list-animations      Print animation names and exit
--out <dir>            Output directory for frame_0000.png, frame_0001.png, ...
--fps <number>         Frames per second, default 12
--scale <number>       Output scale multiplier, default 1
--canvas-size <size>   Fixed output size as WIDTH,HEIGHT or SIZE
--shift-x <pixels>     Move the render horizontally inside a fixed canvas
--shift-y <pixels>     Move the render vertically inside a fixed canvas
--spritesheet <path>   Optional spritesheet PNG path or directory
--gif [path]           Optional animated GIF path or directory
--use-scml-bounds      Use SCML l/t/r/b bounds instead of computed sprite bounds
```

## Development

```bash
bun install
bun run build
```

Run from TypeScript during development:

```bash
bun run dev -- --scml ./assets/player/Animations.scml --list-animations
```

Run the built CLI locally:

```bash
node dist/cli.js --scml ./assets/player/Animations.scml --list-animations
```

Check the package contents before publishing:

```bash
npm run pack:dry
```

Publish to npm:

```bash
npm publish
```

## Supported SCML Features

Supported:

- folders/files
- entities and animations
- mainline keys
- `bone_ref` and `object_ref`
- timelines with bones and sprite objects
- `z_index`
- linear interpolation
- Spriter `spin` for angle interpolation
- normalized pivots, where `pivot_x` is left-to-right and `pivot_y` is bottom-to-top
- parent bone transform hierarchy

Not supported:

- mesh deformation or skins
- IK
- character maps
- events
- sounds
- variables
- tags
- non-linear curves
