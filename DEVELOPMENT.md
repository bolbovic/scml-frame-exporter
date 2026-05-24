# Development

Development instructions for maintainers of `scml-frame-exporter`.

## Install

```bash
bun install
```

## Build

```bash
bun run build
```

## Run Locally

Run from TypeScript during development:

```bash
bun run dev -- --scml ./assets/player/Animations.scml --list-animations
```

Run the built CLI:

```bash
node dist/cli.js --scml ./assets/player/Animations.scml --list-animations
```

## Package

Check the package contents before publishing:

```bash
npm run pack:dry
```

Publish to npm:

```bash
npm publish
```
