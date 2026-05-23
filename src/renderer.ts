import { promises as fs } from "node:fs";
import path from "node:path";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import type { GifPalette } from "gifenc";
import sharp from "sharp";
import { sampleTimeline } from "./interpolate";
import type {
  Animation,
  AnimationBounds,
  BoneRef,
  FolderFile,
  MainlineKey,
  ObjectRef,
  ScmlFile,
  Timeline,
} from "./parseScml";
import { folderFileKey } from "./parseScml";
import type { Transform } from "./transform";
import {
  clampAlpha,
  combineTransforms,
  IDENTITY_TRANSFORM,
  transformPoint,
} from "./transform";

export interface RenderAnimationOptions {
  scml: ScmlFile;
  animation: Animation;
  assetsDir: string;
  outDir: string;
  fps: number;
  scale: number;
  spritesheetPath?: string;
  gifPath?: string;
  useScmlBounds?: boolean;
  canvasSize?: CanvasSize;
  canvasAnchorBounds?: AnimationBounds;
  shiftX?: number;
  shiftY?: number;
}

export interface RenderResult {
  animationName: string;
  outDir: string;
  framePaths: string[];
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
  spritesheetPath?: string;
  gifPath?: string;
}

export interface CanvasSize {
  width: number;
  height: number;
}

interface SpriteInstance {
  zIndex: number;
  transform: Transform;
  file: FolderFile;
  pivotX: number;
  pivotY: number;
}

interface AssetCacheEntry {
  href: string;
}

type AssetCache = Map<string, Promise<AssetCacheEntry>>;

interface RenderArea {
  bounds: AnimationBounds;
  frameWidth: number;
  frameHeight: number;
}

export function findAnimationByName(
  scml: ScmlFile,
  animationName: string,
): { entityName: string; animation: Animation } {
  const matches = scml.entities.flatMap((entity) =>
    entity.animations
      .filter((animation) => animation.name === animationName)
      .map((animation) => ({
        entityName: entity.name,
        animation,
      })),
  );

  if (matches.length === 0) {
    const available = scml.entities
      .flatMap((entity) => entity.animations.map((animation) => animation.name))
      .join(", ");
    throw new Error(
      `Unknown animation "${animationName}". Available animations: ${available}`,
    );
  }

  if (matches.length > 1) {
    const entities = matches.map((match) => match.entityName).join(", ");
    throw new Error(
      `Animation name "${animationName}" is ambiguous across entities: ${entities}.`,
    );
  }

  return matches[0];
}

export function allAnimations(
  scml: ScmlFile,
): Array<{ entityName: string; animation: Animation }> {
  return scml.entities.flatMap((entity) =>
    entity.animations.map((animation) => ({
      entityName: entity.name,
      animation,
    })),
  );
}

export async function renderAnimation(
  options: RenderAnimationOptions,
): Promise<RenderResult> {
  validateRenderOptions(options);

  const frameTimes = animationFrameTimes(options.animation, options.fps);
  const contentBounds =
    options.useScmlBounds === true && options.animation.bounds !== undefined
      ? options.animation.bounds
      : computeAnimationBounds(options.scml, options.animation, frameTimes);
  const renderArea = resolveRenderArea(contentBounds, options);
  const framePaths: string[] = [];
  const assetCache: AssetCache = new Map();

  await prepareFrameDirectory(options.outDir);

  for (let index = 0; index < frameTimes.length; index += 1) {
    const time = frameTimes[index];
    const sprites = sampleAnimationSprites(
      options.scml,
      options.animation,
      time,
    );
    const svg = await buildFrameSvg(
      sprites,
      renderArea.bounds,
      renderArea.frameWidth,
      renderArea.frameHeight,
      options.assetsDir,
      assetCache,
    );
    const framePath = path.join(
      options.outDir,
      `frame_${String(index).padStart(4, "0")}.png`,
    );

    await sharp(Buffer.from(svg)).png().toFile(framePath);
    framePaths.push(framePath);
  }

  if (options.spritesheetPath !== undefined) {
    await createSpritesheet(
      framePaths,
      renderArea.frameWidth,
      renderArea.frameHeight,
      options.spritesheetPath,
    );
  }

  if (options.gifPath !== undefined) {
    await createGif(
      framePaths,
      renderArea.frameWidth,
      renderArea.frameHeight,
      options.fps,
      options.gifPath,
    );
  }

  return {
    animationName: options.animation.name,
    outDir: options.outDir,
    framePaths,
    frameCount: framePaths.length,
    frameWidth: renderArea.frameWidth,
    frameHeight: renderArea.frameHeight,
    spritesheetPath: options.spritesheetPath,
    gifPath: options.gifPath,
  };
}

export function sanitizePathPart(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized.length > 0 ? sanitized : "animation";
}

export function spritesheetPathForAnimation(
  basePath: string | undefined,
  animationName: string,
  isAllAnimations: boolean,
): string | undefined {
  return animationOutputPathForAnimation(
    basePath,
    animationName,
    isAllAnimations,
    ".png",
  );
}

export function gifPathForAnimation(
  basePath: string | undefined,
  animationName: string,
  isAllAnimations: boolean,
): string | undefined {
  return animationOutputPathForAnimation(
    basePath,
    animationName,
    isAllAnimations,
    ".gif",
  );
}

function animationOutputPathForAnimation(
  basePath: string | undefined,
  animationName: string,
  isAllAnimations: boolean,
  expectedExtension: ".png" | ".gif",
): string | undefined {
  if (basePath === undefined) {
    return undefined;
  }

  if (!isAllAnimations) {
    return basePath;
  }

  const extension = path.extname(basePath).toLowerCase();
  const safeName = sanitizePathPart(animationName);

  if (extension === expectedExtension) {
    return path.join(
      path.dirname(basePath),
      `${path.basename(basePath, extension)}-${safeName}${expectedExtension}`,
    );
  }

  return path.join(basePath, `${safeName}${expectedExtension}`);
}

function validateRenderOptions(options: RenderAnimationOptions): void {
  if (!Number.isFinite(options.fps) || options.fps <= 0) {
    throw new Error(`FPS must be a positive number. Received ${options.fps}.`);
  }

  if (!Number.isFinite(options.scale) || options.scale <= 0) {
    throw new Error(
      `Scale must be a positive number. Received ${options.scale}.`,
    );
  }

  if (options.canvasSize !== undefined) {
    if (
      !Number.isFinite(options.canvasSize.width) ||
      options.canvasSize.width <= 0
    ) {
      throw new Error(
        `Canvas width must be a positive number. Received ${options.canvasSize.width}.`,
      );
    }

    if (
      !Number.isFinite(options.canvasSize.height) ||
      options.canvasSize.height <= 0
    ) {
      throw new Error(
        `Canvas height must be a positive number. Received ${options.canvasSize.height}.`,
      );
    }
  }

  if (!Number.isFinite(options.shiftX ?? 0)) {
    throw new Error(
      `Shift X must be a finite number. Received ${options.shiftX}.`,
    );
  }

  if (!Number.isFinite(options.shiftY ?? 0)) {
    throw new Error(
      `Shift Y must be a finite number. Received ${options.shiftY}.`,
    );
  }
}

function resolveRenderArea(
  contentBounds: AnimationBounds,
  options: RenderAnimationOptions,
): RenderArea {
  const shiftX = options.shiftX ?? 0;
  const shiftY = options.shiftY ?? 0;

  if (options.canvasSize === undefined) {
    const shiftedBounds = shiftBounds(
      contentBounds,
      shiftX / options.scale,
      shiftY / options.scale,
    );

    return {
      bounds: shiftedBounds,
      frameWidth: Math.max(1, Math.ceil(contentBounds.width * options.scale)),
      frameHeight: Math.max(1, Math.ceil(contentBounds.height * options.scale)),
    };
  }

  const frameWidth = Math.max(1, Math.round(options.canvasSize.width));
  const frameHeight = Math.max(1, Math.round(options.canvasSize.height));
  const worldWidth = frameWidth / options.scale;
  const worldHeight = frameHeight / options.scale;
  const anchorBounds = options.canvasAnchorBounds ?? contentBounds;
  const centerX = (anchorBounds.left + anchorBounds.right) / 2;
  const centerY = (anchorBounds.top + anchorBounds.bottom) / 2;
  const left = centerX - worldWidth / 2 - shiftX / options.scale;
  const top = centerY - worldHeight / 2 - shiftY / options.scale;

  return {
    bounds: {
      left,
      top,
      right: left + worldWidth,
      bottom: top + worldHeight,
      width: worldWidth,
      height: worldHeight,
    },
    frameWidth,
    frameHeight,
  };
}

function shiftBounds(
  bounds: AnimationBounds,
  shiftX: number,
  shiftY: number,
): AnimationBounds {
  if (shiftX === 0 && shiftY === 0) {
    return bounds;
  }

  return {
    left: bounds.left - shiftX,
    top: bounds.top - shiftY,
    right: bounds.right - shiftX,
    bottom: bounds.bottom - shiftY,
    width: bounds.width,
    height: bounds.height,
  };
}

function animationFrameTimes(animation: Animation, fps: number): number[] {
  if (!Number.isFinite(animation.length) || animation.length < 0) {
    throw new Error(
      `Animation "${animation.name}" has invalid length ${animation.length}.`,
    );
  }

  if (animation.length === 0) {
    return [0];
  }

  const frameDuration = 1000 / fps;
  const frameCount = Math.max(1, Math.ceil(animation.length / frameDuration));

  return Array.from({ length: frameCount }, (_, index) =>
    Math.min(index * frameDuration, animation.length),
  );
}

function sampleAnimationSprites(
  scml: ScmlFile,
  animation: Animation,
  time: number,
): SpriteInstance[] {
  const normalizedTime = normalizeTime(time, animation.length);
  const mainlineKey = findMainlineKey(animation.mainlineKeys, normalizedTime);
  const timelinesById = new Map(
    animation.timelines.map((timeline) => [timeline.id, timeline]),
  );
  const boneRefsById = new Map(
    mainlineKey.boneRefs.map((boneRef) => [boneRef.id, boneRef]),
  );
  const boneWorldCache = new Map<number, Transform>();

  const resolveTimeline = (timelineId: number): Timeline => {
    const timeline = timelinesById.get(timelineId);

    if (timeline === undefined) {
      throw new Error(
        `Animation "${animation.name}" references missing timeline ${timelineId}.`,
      );
    }

    return timeline;
  };

  const resolveBoneWorld = (boneRef: BoneRef): Transform => {
    const cached = boneWorldCache.get(boneRef.id);

    if (cached !== undefined) {
      return cached;
    }

    const timeline = resolveTimeline(boneRef.timeline);

    if (timeline.objectType !== "bone") {
      throw new Error(
        `Animation "${animation.name}" bone_ref ${boneRef.id} points to timeline "${timeline.name}", which is not a bone timeline.`,
      );
    }

    const local = sampleTimeline(
      timeline,
      normalizedTime,
      animation.length,
      boneRef.key,
    ).transform;
    const world =
      boneRef.parent === undefined
        ? local
        : combineTransforms(
            resolveParentBoneWorld(
              boneRef,
              boneRefsById,
              resolveBoneWorld,
              animation.name,
            ),
            local,
          );

    boneWorldCache.set(boneRef.id, world);
    return world;
  };

  const sprites = mainlineKey.objectRefs.map((objectRef) =>
    sampleObjectRef(
      scml,
      animation,
      objectRef,
      resolveTimeline,
      boneRefsById,
      resolveBoneWorld,
      normalizedTime,
    ),
  );

  return sprites.sort((a, b) => a.zIndex - b.zIndex || a.file.id - b.file.id);
}

function sampleObjectRef(
  scml: ScmlFile,
  animation: Animation,
  objectRef: ObjectRef,
  resolveTimeline: (timelineId: number) => Timeline,
  boneRefsById: Map<number, BoneRef>,
  resolveBoneWorld: (boneRef: BoneRef) => Transform,
  normalizedTime: number,
): SpriteInstance {
  const timeline = resolveTimeline(objectRef.timeline);

  if (timeline.objectType !== "sprite") {
    throw new Error(
      `Animation "${animation.name}" object_ref ${objectRef.id} points to timeline "${timeline.name}", which is not a sprite timeline.`,
    );
  }

  const sampled = sampleTimeline(
    timeline,
    normalizedTime,
    animation.length,
    objectRef.key,
  );

  if (sampled.folderId === undefined || sampled.fileId === undefined) {
    throw new Error(
      `Animation "${animation.name}" timeline "${timeline.name}" key ${sampled.key.id} is missing folder/file sprite references.`,
    );
  }

  const file = scml.fileMap.get(
    folderFileKey(sampled.folderId, sampled.fileId),
  );

  if (file === undefined) {
    throw new Error(
      `Animation "${animation.name}" references missing folder/file ${sampled.folderId}:${sampled.fileId} in timeline "${timeline.name}".`,
    );
  }

  const parentWorld =
    objectRef.parent === undefined
      ? IDENTITY_TRANSFORM
      : resolveParentBoneWorld(
          objectRef,
          boneRefsById,
          resolveBoneWorld,
          animation.name,
        );

  return {
    zIndex: objectRef.zIndex,
    transform: combineTransforms(parentWorld, sampled.transform),
    file,
    pivotX: sampled.pivotX ?? file.pivotX,
    pivotY: sampled.pivotY ?? file.pivotY,
  };
}

function resolveParentBoneWorld(
  ref: BoneRef | ObjectRef,
  boneRefsById: Map<number, BoneRef>,
  resolveBoneWorld: (boneRef: BoneRef) => Transform,
  animationName: string,
): Transform {
  if (ref.parent === undefined) {
    return IDENTITY_TRANSFORM;
  }

  const parentRef = boneRefsById.get(ref.parent);

  if (parentRef === undefined) {
    throw new Error(
      `Animation "${animationName}" references missing parent bone_ref ${ref.parent}.`,
    );
  }

  return resolveBoneWorld(parentRef);
}

function findMainlineKey(keys: MainlineKey[], time: number): MainlineKey {
  let selected = keys[0];

  for (const key of keys) {
    if (key.time <= time) {
      selected = key;
    } else {
      break;
    }
  }

  return selected;
}

function normalizeTime(time: number, animationLength: number): number {
  if (!Number.isFinite(animationLength) || animationLength <= 0) {
    return 0;
  }

  const normalized = time % animationLength;
  return normalized < 0 ? normalized + animationLength : normalized;
}

function computeAnimationBounds(
  scml: ScmlFile,
  animation: Animation,
  frameTimes: number[],
): AnimationBounds {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const time of frameTimes) {
    const sprites = sampleAnimationSprites(scml, animation, time);

    for (const sprite of sprites) {
      const localLeft = -sprite.pivotX * sprite.file.width;
      const localTop = -(1 - sprite.pivotY) * sprite.file.height;
      const localRight = localLeft + sprite.file.width;
      const localBottom = localTop + sprite.file.height;
      const rendererTransform = toRendererTransform(sprite.transform);
      const corners = [
        transformPoint(rendererTransform, localLeft, localTop),
        transformPoint(rendererTransform, localRight, localTop),
        transformPoint(rendererTransform, localRight, localBottom),
        transformPoint(rendererTransform, localLeft, localBottom),
      ];

      for (const corner of corners) {
        left = Math.min(left, corner.x);
        top = Math.min(top, corner.y);
        right = Math.max(right, corner.x);
        bottom = Math.max(bottom, corner.y);
      }
    }
  }

  if (![left, top, right, bottom].every(Number.isFinite)) {
    return {
      left: 0,
      top: 0,
      right: 1,
      bottom: 1,
      width: 1,
      height: 1,
    };
  }

  const padding = 2;
  const paddedLeft = Math.floor(left - padding);
  const paddedTop = Math.floor(top - padding);
  const paddedRight = Math.ceil(right + padding);
  const paddedBottom = Math.ceil(bottom + padding);

  return {
    left: paddedLeft,
    top: paddedTop,
    right: paddedRight,
    bottom: paddedBottom,
    width: Math.max(1, paddedRight - paddedLeft),
    height: Math.max(1, paddedBottom - paddedTop),
  };
}

async function buildFrameSvg(
  sprites: SpriteInstance[],
  bounds: AnimationBounds,
  frameWidth: number,
  frameHeight: number,
  assetsDir: string,
  assetCache: AssetCache,
): Promise<string> {
  const parts = await Promise.all(
    sprites.map(async (sprite) => {
      const asset = await loadAsset(sprite.file, assetsDir, assetCache);
      const pivotOffsetX = -sprite.pivotX * sprite.file.width;
      const pivotOffsetY = -(1 - sprite.pivotY) * sprite.file.height;
      const rendererTransform = toRendererTransform(sprite.transform);
      const alpha = clampAlpha(sprite.transform.alpha);

      return [
        `<g opacity="${formatNumber(alpha)}" transform="translate(${formatNumber(rendererTransform.x)} ${formatNumber(
          rendererTransform.y,
        )}) rotate(${formatNumber(rendererTransform.angle)}) scale(${formatNumber(rendererTransform.scaleX)} ${formatNumber(
          rendererTransform.scaleY,
        )})">`,
        `<image href="${asset.href}" x="${formatNumber(pivotOffsetX)}" y="${formatNumber(pivotOffsetY)}" width="${formatNumber(
          sprite.file.width,
        )}" height="${formatNumber(sprite.file.height)}"/>`,
        `</g>`,
      ].join("");
    }),
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${frameWidth}" height="${frameHeight}" viewBox="${formatNumber(
      bounds.left,
    )} ${formatNumber(bounds.top)} ${formatNumber(bounds.width)} ${formatNumber(bounds.height)}">`,
    ...parts,
    `</svg>`,
  ].join("");
}

function toRendererTransform(transform: Transform): Transform {
  return {
    x: transform.x,
    y: -transform.y,
    angle: -transform.angle,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
    alpha: transform.alpha,
  };
}

async function loadAsset(
  file: FolderFile,
  assetsDir: string,
  assetCache: AssetCache,
): Promise<AssetCacheEntry> {
  const cacheKey = folderFileKey(file.folderId, file.id);
  const cached = assetCache.get(cacheKey);

  if (cached !== undefined) {
    return cached;
  }

  const assetPromise = (async (): Promise<AssetCacheEntry> => {
    if (path.extname(file.name).toLowerCase() !== ".png") {
      throw new Error(
        `Unsupported asset "${file.name}". Only PNG sprite files are supported.`,
      );
    }

    const assetPath = path.isAbsolute(file.name)
      ? file.name
      : path.resolve(assetsDir, file.name);
    let data: Buffer;

    try {
      data = await fs.readFile(assetPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Missing sprite asset for folder/file ${file.folderId}:${file.id}: ${assetPath}. ${message}`,
      );
    }

    return {
      href: `data:image/png;base64,${data.toString("base64")}`,
    };
  })();

  assetCache.set(cacheKey, assetPromise);
  return assetPromise;
}

async function prepareFrameDirectory(outDir: string): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  const entries = await fs.readdir(outDir, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^frame_\d+\.png$/u.test(entry.name))
      .map((entry) => fs.unlink(path.join(outDir, entry.name))),
  );
}

async function createSpritesheet(
  framePaths: string[],
  frameWidth: number,
  frameHeight: number,
  spritesheetPath: string,
): Promise<void> {
  if (framePaths.length === 0) {
    return;
  }

  const columns = Math.ceil(Math.sqrt(framePaths.length));
  const rows = Math.ceil(framePaths.length / columns);
  const composite = framePaths.map((input, index) => ({
    input,
    left: (index % columns) * frameWidth,
    top: Math.floor(index / columns) * frameHeight,
  }));

  await fs.mkdir(path.dirname(spritesheetPath), { recursive: true });
  await sharp({
    create: {
      width: columns * frameWidth,
      height: rows * frameHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composite)
    .png()
    .toFile(spritesheetPath);
}

async function createGif(
  framePaths: string[],
  frameWidth: number,
  frameHeight: number,
  fps: number,
  gifPath: string,
): Promise<void> {
  if (framePaths.length === 0) {
    return;
  }

  const frames: Uint8Array[] = [];
  const totalBytes = frameWidth * frameHeight * 4 * framePaths.length;
  const combined = new Uint8Array(totalBytes);
  let offset = 0;

  for (const framePath of framePaths) {
    const { data, info } = await sharp(framePath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (
      info.width !== frameWidth ||
      info.height !== frameHeight ||
      info.channels !== 4
    ) {
      throw new Error(
        `Cannot create GIF because frame "${framePath}" is ${info.width}x${info.height} with ${info.channels} channels; expected ${frameWidth}x${frameHeight} RGBA.`,
      );
    }

    const rgba = normalizeGifAlpha(new Uint8Array(data));
    frames.push(rgba);
    combined.set(rgba, offset);
    offset += rgba.length;
  }

  const palette: GifPalette = [
    [0, 0, 0, 0],
    ...quantize(combined, 255, { format: "rgba4444", oneBitAlpha: 0 }),
  ];
  const gif = GIFEncoder();

  for (let index = 0; index < frames.length; index += 1) {
    gif.writeFrame(
      applyPalette(frames[index], palette, "rgba4444"),
      frameWidth,
      frameHeight,
      {
        palette,
        delay: gifDelayForFrame(index, fps),
        repeat: 0,
        transparent: true,
        transparentIndex: 0,
      },
    );
  }

  gif.finish();

  await fs.mkdir(path.dirname(gifPath), { recursive: true });
  await fs.writeFile(gifPath, Buffer.from(gif.bytes()));
}

function normalizeGifAlpha(rgba: Uint8Array): Uint8Array {
  for (let index = 0; index < rgba.length; index += 4) {
    const alphaIndex = index + 3;

    if (rgba[alphaIndex] === 0) {
      rgba[index] = 0;
      rgba[index + 1] = 0;
      rgba[index + 2] = 0;
    } else {
      rgba[alphaIndex] = 255;
    }
  }

  return rgba;
}

function gifDelayForFrame(frameIndex: number, fps: number): number {
  const startCentiseconds = Math.round((frameIndex * 100) / fps);
  const endCentiseconds = Math.round(((frameIndex + 1) * 100) / fps);
  return Math.max(1, endCentiseconds - startCentiseconds) * 10;
}

function formatNumber(value: number): string {
  if (Object.is(value, -0)) {
    return "0";
  }

  return Number(value.toFixed(6)).toString();
}
