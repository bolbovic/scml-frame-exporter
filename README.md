# scml-frame-exporter

`scml-frame-exporter` is a command-line tool that renders BrashMonkey Spriter
`.scml` animations into image files.

It reads:

- one `.scml` file
- the PNG assets referenced by that SCML file
- one animation name, or all animations in the file

It writes:

- PNG frame sequences named `frame_0000.png`, `frame_0001.png`, and so on
- optional PNG spritesheets
- optional animated GIF previews

The tool renders existing Spriter animations. It does not edit SCML files, create
new animations, or support every Spriter feature.

## Requirements

- Node.js 18 or newer
- PNG assets available on disk
- asset paths that match the `folder` and `file` entries in the SCML file

By default, assets are resolved relative to the directory that contains the SCML
file. Use `--assets` when the PNG files are stored somewhere else.

## CLI

Package binary:

```bash
scml-frame-exporter
```

List the animations in an SCML file:

```bash
npx scml-frame-exporter --scml ./assets/player/Animations.scml --list-animations
```

The same command can be run with Bun:

```bash
bun x scml-frame-exporter --scml ./assets/player/Animations.scml --list-animations
```

## Render One Animation

```bash
npx scml-frame-exporter \
  --scml ./assets/player/Animations.scml \
  --assets ./assets/player \
  --animation "Walking" \
  --out ./exports/player/walking \
  --fps 12 \
  --scale 1
```

Output:

```text
exports/player/walking/frame_0000.png
exports/player/walking/frame_0001.png
exports/player/walking/frame_0002.png
```

Write a spritesheet:

```bash
npx scml-frame-exporter \
  --scml ./assets/player/Animations.scml \
  --assets ./assets/player \
  --animation "Walking" \
  --out ./exports/player/walking \
  --spritesheet ./exports/player/walking-sheet.png
```

Write an animated GIF next to the frame directory:

```bash
npx scml-frame-exporter \
  --scml ./assets/player/Animations.scml \
  --assets ./assets/player \
  --animation "Walking" \
  --out ./exports/player/walking \
  --gif
```

With `--gif` and no explicit path, the GIF path is derived from `--out`:

```text
exports/player/walking.gif
```

Pass a path to control the GIF filename:

```bash
npx scml-frame-exporter \
  --scml ./assets/player/Animations.scml \
  --assets ./assets/player \
  --animation "Walking" \
  --out ./exports/player/walking \
  --gif ./exports/player/walking-preview.gif
```

## Render All Animations

Use `--all-animations` to render every animation in the SCML file.

```bash
bun x scml-frame-exporter \
  --scml ./assets/player/Animations.scml \
  --assets ./assets/player \
  --all-animations \
  --out ./exports/player \
  --fps 12 \
  --scale 1
```

Each animation is written to a sanitized subdirectory under `--out`:

```text
exports/player/walking/frame_0000.png
exports/player/jumping/frame_0000.png
```

When `--spritesheet` is used with `--all-animations`:

- a directory path writes one sheet per animation inside that directory
- a `.png` path adds the animation name to the filename

Examples:

```text
--spritesheet ./exports/sheets
exports/sheets/walking.png

--spritesheet ./exports/sheet.png
exports/sheet-walking.png
```

When `--gif` is used with `--all-animations`:

- no path writes one GIF per animation under `--out`
- a directory path writes one GIF per animation inside that directory
- a `.gif` path adds the animation name to the filename

Examples:

```text
--gif
exports/player/walking.gif

--gif ./exports/gifs
exports/gifs/walking.gif

--gif ./exports/preview.gif
exports/preview-walking.gif
```

## Canvas And Bounds

By default, the renderer samples the animation and computes bounds from the
visible sprites. This avoids clipping sprites that move outside the SCML
animation bounds.

Use `--use-scml-bounds` to use the animation `l`, `t`, `r`, and `b` bounds stored
in the SCML file instead.

Use `--canvas-size` to force every exported frame to a fixed output size:

```bash
npx scml-frame-exporter \
  --scml ./assets/player/Animations.scml \
  --assets ./assets/player \
  --all-animations \
  --out ./exports/player \
  --canvas-size 535,499
```

`--canvas-size` accepts `WIDTH,HEIGHT` or a single square size:

```text
--canvas-size 535,499
--canvas-size 512
```

When a fixed canvas is set:

- `--scale` acts as zoom inside the fixed output size
- single-animation renders are anchored to that animation's SCML bounds when
  available
- `--all-animations` renders are anchored to the combined SCML bounds when all
  animations provide bounds

Use `--shift-x` and `--shift-y` to move the render inside a fixed canvas. Values
are pixels after scaling.

```text
--shift-x 10   moves the render right
--shift-x -10  moves the render left
--shift-y 10   moves the render down
--shift-y -10  moves the render up
```

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

Rendering requires one of:

- `--animation <name>`
- `--all-animations`

`--list-animations` only prints animation names and exits. It does not require
`--out`.

## Supported SCML Features

Supported:

- folders and files
- entities and animations
- mainline keys
- `bone_ref` and `object_ref`
- timelines with bones and sprite objects
- `z_index`
- linear interpolation
- Spriter `spin` angle interpolation
- normalized pivots, where `pivot_x` is left-to-right and `pivot_y` is
  bottom-to-top
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
