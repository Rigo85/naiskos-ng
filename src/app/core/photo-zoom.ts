export interface PhotoTransform {
  scale: number;
  x: number;
  y: number;
}

export interface ZoomPoint {
  x: number;
  y: number;
}

export interface ZoomSurface {
  width: number;
  height: number;
}

export const IDENTITY_PHOTO_TRANSFORM: PhotoTransform = {
  scale: 1,
  x: 0,
  y: 0,
};

export const MAX_PHOTO_ZOOM = 4;

export function pointDistance(left: ZoomPoint, right: ZoomPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

export function pointMidpoint(left: ZoomPoint, right: ZoomPoint): ZoomPoint {
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
  };
}

export function pinchTransform(
  start: PhotoTransform,
  startDistance: number,
  startMidpoint: ZoomPoint,
  currentDistance: number,
  currentMidpoint: ZoomPoint,
  surface: ZoomSurface,
): PhotoTransform {
  if (startDistance <= 0 || surface.width <= 0 || surface.height <= 0) {
    return start;
  }

  const scale = clamp(start.scale * (currentDistance / startDistance), 1, MAX_PHOTO_ZOOM);
  if (scale === 1) {
    return { ...IDENTITY_PHOTO_TRANSFORM };
  }

  const centerX = surface.width / 2;
  const centerY = surface.height / 2;
  const contentX = (startMidpoint.x - centerX - start.x) / start.scale;
  const contentY = (startMidpoint.y - centerY - start.y) / start.scale;

  return clampPhotoTranslation(
    {
      scale,
      x: currentMidpoint.x - centerX - contentX * scale,
      y: currentMidpoint.y - centerY - contentY * scale,
    },
    surface,
  );
}

export function panTransform(
  start: PhotoTransform,
  deltaX: number,
  deltaY: number,
  surface: ZoomSurface,
): PhotoTransform {
  return clampPhotoTranslation(
    {
      scale: start.scale,
      x: start.x + deltaX,
      y: start.y + deltaY,
    },
    surface,
  );
}

export function clampPhotoTranslation(
  transform: PhotoTransform,
  surface: ZoomSurface,
): PhotoTransform {
  if (transform.scale <= 1) {
    return { ...IDENTITY_PHOTO_TRANSFORM };
  }

  const maxX = (surface.width * (transform.scale - 1)) / 2;
  const maxY = (surface.height * (transform.scale - 1)) / 2;
  return {
    scale: transform.scale,
    x: clamp(transform.x, -maxX, maxX),
    y: clamp(transform.y, -maxY, maxY),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
