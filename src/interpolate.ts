import type { Timeline, TimelineKey } from "./parseScml";
import type { Transform } from "./transform";

export interface SampledTimelineKey {
  key: TimelineKey;
  transform: Transform;
  folderId?: number;
  fileId?: number;
  pivotX?: number;
  pivotY?: number;
}

export function sampleTimeline(
  timeline: Timeline,
  time: number,
  animationLength: number,
  keyId?: number,
): SampledTimelineKey {
  if (timeline.keys.length === 0) {
    throw new Error(`Timeline "${timeline.name}" does not contain any keys.`);
  }

  const startKey =
    keyId === undefined
      ? findKeyAtOrBefore(timeline.keys, time)
      : findKeyById(timeline, keyId);

  if (
    timeline.keys.length === 1 ||
    !Number.isFinite(animationLength) ||
    animationLength <= 0
  ) {
    return sampledFromSingleKey(startKey);
  }

  const nextKey = findNextKey(timeline.keys, startKey);

  if (nextKey === startKey) {
    return sampledFromSingleKey(startKey);
  }

  const startTime = startKey.time;
  let endTime = nextKey.time;
  let sampleTime = time;

  if (endTime <= startTime) {
    endTime += animationLength;
  }

  if (sampleTime < startTime) {
    sampleTime += animationLength;
  }

  const span = endTime - startTime;
  const amount = span <= 0 ? 0 : clamp01((sampleTime - startTime) / span);

  return {
    key: startKey,
    transform: interpolateTransform(
      startKey.transform,
      nextKey.transform,
      amount,
      startKey.spin,
    ),
    folderId: startKey.folderId,
    fileId: startKey.fileId,
    pivotX: startKey.pivotX,
    pivotY: startKey.pivotY,
  };
}

export function interpolateTransform(
  from: Transform,
  to: Transform,
  amount: number,
  spin: number,
): Transform {
  const t = clamp01(amount);

  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    angle: interpolateAngle(from.angle, to.angle, t, spin),
    scaleX: lerp(from.scaleX, to.scaleX, t),
    scaleY: lerp(from.scaleY, to.scaleY, t),
    alpha: lerp(from.alpha, to.alpha, t),
  };
}

export function interpolateAngle(
  from: number,
  to: number,
  amount: number,
  spin: number,
): number {
  if (spin === 0) {
    return from;
  }

  let adjustedTo = to;
  const delta = adjustedTo - from;

  if (spin > 0 && delta < 0) {
    adjustedTo += 360;
  } else if (spin < 0 && delta > 0) {
    adjustedTo -= 360;
  }

  return lerp(from, adjustedTo, amount);
}

export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function sampledFromSingleKey(key: TimelineKey): SampledTimelineKey {
  return {
    key,
    transform: key.transform,
    folderId: key.folderId,
    fileId: key.fileId,
    pivotX: key.pivotX,
    pivotY: key.pivotY,
  };
}

function findKeyById(timeline: Timeline, keyId: number): TimelineKey {
  const key = timeline.keys.find((candidate) => candidate.id === keyId);

  if (key === undefined) {
    throw new Error(
      `Timeline "${timeline.name}" does not contain key ${keyId}.`,
    );
  }

  return key;
}

function findKeyAtOrBefore(keys: TimelineKey[], time: number): TimelineKey {
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

function findNextKey(keys: TimelineKey[], key: TimelineKey): TimelineKey {
  const index = keys.indexOf(key);

  if (index === -1) {
    throw new Error(`Timeline key ${key.id} is not present in its timeline.`);
  }

  return keys[(index + 1) % keys.length];
}

function clamp01(value: number): number {
  if (value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
}
