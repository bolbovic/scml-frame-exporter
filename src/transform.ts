export interface Transform {
  x: number;
  y: number;
  angle: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
}

export const IDENTITY_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  angle: 0,
  scaleX: 1,
  scaleY: 1,
  alpha: 1,
};

export function normalizeTransform(
  transform: Partial<Transform> = {},
): Transform {
  return {
    x: transform.x ?? 0,
    y: transform.y ?? 0,
    angle: transform.angle ?? 0,
    scaleX: transform.scaleX ?? 1,
    scaleY: transform.scaleY ?? 1,
    alpha: transform.alpha ?? 1,
  };
}

export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function rotatePoint(
  x: number,
  y: number,
  angle: number,
): { x: number; y: number } {
  const radians = degreesToRadians(angle);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}

export function combineTransforms(
  parent: Transform,
  child: Transform,
): Transform {
  const scaledChildX = child.x * parent.scaleX;
  const scaledChildY = child.y * parent.scaleY;
  const rotatedChild = rotatePoint(scaledChildX, scaledChildY, parent.angle);

  return {
    x: parent.x + rotatedChild.x,
    y: parent.y + rotatedChild.y,
    angle: parent.angle + child.angle,
    scaleX: parent.scaleX * child.scaleX,
    scaleY: parent.scaleY * child.scaleY,
    alpha: parent.alpha * child.alpha,
  };
}

export function transformPoint(
  transform: Transform,
  x: number,
  y: number,
): { x: number; y: number } {
  const scaled = {
    x: x * transform.scaleX,
    y: y * transform.scaleY,
  };
  const rotated = rotatePoint(scaled.x, scaled.y, transform.angle);

  return {
    x: transform.x + rotated.x,
    y: transform.y + rotated.y,
  };
}

export function clampAlpha(alpha: number): number {
  if (alpha <= 0) {
    return 0;
  }

  if (alpha >= 1) {
    return 1;
  }

  return alpha;
}
