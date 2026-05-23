#!/usr/bin/env node
import path from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { listAnimationNames, parseScml } from "./parseScml";
import type { AnimationBounds } from "./parseScml";
import {
  allAnimations,
  findAnimationByName,
  gifPathForAnimation,
  renderAnimation,
  sanitizePathPart,
  spritesheetPathForAnimation,
} from "./renderer";
import type { CanvasSize } from "./renderer";

interface CliOptions {
  scml: string;
  assets?: string;
  animation?: string;
  out?: string;
  fps: number;
  scale: number;
  spritesheet?: string;
  gif?: string | boolean;
  listAnimations?: boolean;
  allAnimations?: boolean;
  useScmlBounds?: boolean;
  canvasSize?: CanvasSize;
  shiftX: number;
  shiftY: number;
}

const program = new Command();

program
  .name("scml-frame-exporter")
  .description(
    "Render BrashMonkey Spriter .scml animations into PNG frame sequences.",
  )
  .requiredOption("--scml <path>", "path to the .scml file")
  .option(
    "--assets <dir>",
    "directory containing PNG body-part assets; defaults to the SCML directory",
  )
  .option("--animation <name>", "animation name to render")
  .option(
    "--out <dir>",
    "output directory for frame_0000.png, frame_0001.png, ...",
  )
  .option("--fps <number>", "frames per second", parsePositiveNumber, 12)
  .option("--scale <number>", "output scale multiplier", parsePositiveNumber, 1)
  .option(
    "--canvas-size <size>",
    "fixed output canvas size, as WIDTH,HEIGHT or SIZE for a square",
    parseCanvasSize,
  )
  .option(
    "--shift-x <pixels>",
    "move the rendered animation right/left inside the canvas, in pixels",
    parseFiniteNumber,
    0,
  )
  .option(
    "--shift-y <pixels>",
    "move the rendered animation down/up inside the canvas, in pixels",
    parseFiniteNumber,
    0,
  )
  .option(
    "--spritesheet <path>",
    "optional spritesheet PNG path; with --all-animations this may be a directory",
  )
  .option(
    "--gif [path]",
    "write an animated GIF at the same FPS; optional path",
  )
  .option("--list-animations", "print animation names and exit")
  .option("--all-animations", "render every animation in the SCML file")
  .option(
    "--use-scml-bounds",
    "use the SCML animation l/t/r/b crop instead of computed sprite bounds",
  );

async function main(): Promise<void> {
  program.parse(process.argv);
  const options = program.opts<CliOptions>();
  const scmlPath = path.resolve(options.scml);
  const scml = await parseScml(scmlPath);

  if (options.listAnimations) {
    for (const animationName of listAnimationNames(scml)) {
      console.log(animationName);
    }

    return;
  }

  if (options.animation !== undefined && options.allAnimations) {
    throw new Error("Use either --animation or --all-animations, not both.");
  }

  if (options.animation === undefined && !options.allAnimations) {
    throw new Error(
      "Provide --animation <name>, --all-animations, or --list-animations.",
    );
  }

  if (options.out === undefined) {
    throw new Error("Provide --out <dir> when rendering animations.");
  }

  const assetsDir = path.resolve(options.assets ?? path.dirname(scmlPath));
  const outPath = path.resolve(options.out);
  const spritesheetPath =
    options.spritesheet === undefined
      ? undefined
      : path.resolve(options.spritesheet);
  const gifPath = resolveGifPath(
    options.gif,
    outPath,
    options.allAnimations === true,
  );

  if (options.allAnimations) {
    const animations = allAnimations(scml);
    const canvasAnchorBounds =
      options.canvasSize === undefined
        ? undefined
        : sharedScmlBounds(animations);

    if (animations.length === 0) {
      throw new Error("SCML does not contain any animations to render.");
    }

    for (const { animation } of animations) {
      const animationOutDir = path.join(
        outPath,
        sanitizePathPart(animation.name),
      );
      const animationSpritesheetPath = spritesheetPathForAnimation(
        spritesheetPath,
        animation.name,
        true,
      );
      const animationGifPath = gifPathForAnimation(
        gifPath,
        animation.name,
        true,
      );
      const result = await renderAnimation({
        scml,
        animation,
        assetsDir,
        outDir: animationOutDir,
        fps: options.fps,
        scale: options.scale,
        spritesheetPath: animationSpritesheetPath,
        gifPath: animationGifPath,
        useScmlBounds: options.useScmlBounds,
        canvasSize: options.canvasSize,
        canvasAnchorBounds,
        shiftX: options.shiftX,
        shiftY: options.shiftY,
      });

      printRenderResult(
        result.animationName,
        result.frameCount,
        result.outDir,
        result.spritesheetPath,
        result.gifPath,
      );
    }

    return;
  }

  const { animation } = findAnimationByName(scml, options.animation!);
  const result = await renderAnimation({
    scml,
    animation,
    assetsDir,
    outDir: outPath,
    fps: options.fps,
    scale: options.scale,
    spritesheetPath: spritesheetPathForAnimation(
      spritesheetPath,
      animation.name,
      false,
    ),
    gifPath: gifPathForAnimation(gifPath, animation.name, false),
    useScmlBounds: options.useScmlBounds,
    canvasSize: options.canvasSize,
    canvasAnchorBounds:
      options.canvasSize === undefined ? undefined : animation.bounds,
    shiftX: options.shiftX,
    shiftY: options.shiftY,
  });

  printRenderResult(
    result.animationName,
    result.frameCount,
    result.outDir,
    result.spritesheetPath,
    result.gifPath,
  );
}

function parsePositiveNumber(value: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(
      `Expected a positive number, received "${value}".`,
    );
  }

  return parsed;
}

function parseFiniteNumber(value: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new InvalidArgumentError(
      `Expected a finite number, received "${value}".`,
    );
  }

  return parsed;
}

function parseCanvasSize(value: string): CanvasSize {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length !== 1 && parts.length !== 2) {
    throw new InvalidArgumentError(
      `Expected WIDTH,HEIGHT or SIZE, received "${value}".`,
    );
  }

  const width = parsePositiveInteger(parts[0], "canvas width");
  const height =
    parts.length === 1
      ? width
      : parsePositiveInteger(parts[1], "canvas height");

  return { width, height };
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(
      `Expected ${label} to be a positive integer, received "${value}".`,
    );
  }

  return parsed;
}

function sharedScmlBounds(
  animations: Array<{ animation: { bounds?: AnimationBounds } }>,
): AnimationBounds | undefined {
  const bounds = animations.map(({ animation }) => animation.bounds);

  if (bounds.length === 0 || bounds.some((bound) => bound === undefined)) {
    return undefined;
  }

  const definiteBounds = bounds as AnimationBounds[];
  const first = definiteBounds[0];

  const combined = definiteBounds.slice(1).reduce(
    (result, bound) => ({
      left: Math.min(result.left, bound.left),
      top: Math.min(result.top, bound.top),
      right: Math.max(result.right, bound.right),
      bottom: Math.max(result.bottom, bound.bottom),
      width: 0,
      height: 0,
    }),
    {
      left: first.left,
      top: first.top,
      right: first.right,
      bottom: first.bottom,
      width: 0,
      height: 0,
    },
  );

  return {
    ...combined,
    width: combined.right - combined.left,
    height: combined.bottom - combined.top,
  };
}

function resolveGifPath(
  gifOption: string | boolean | undefined,
  outPath: string,
  isAllAnimations: boolean,
): string | undefined {
  if (gifOption === undefined || gifOption === false) {
    return undefined;
  }

  if (gifOption === true) {
    return isAllAnimations ? outPath : `${outPath}.gif`;
  }

  return path.resolve(gifOption);
}

function printRenderResult(
  animationName: string,
  frameCount: number,
  outDir: string,
  spritesheetPath?: string,
  gifPath?: string,
): void {
  console.log(
    `Rendered "${animationName}" (${frameCount} frames) -> ${outDir}`,
  );

  if (spritesheetPath !== undefined) {
    console.log(`Spritesheet -> ${spritesheetPath}`);
  }

  if (gifPath !== undefined) {
    console.log(`GIF -> ${gifPath}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
