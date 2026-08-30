export interface GesturePoint {
  x: number;
  y: number;
  at: number;
}

export type GestureAction =
  'tap-left' | 'tap-right' | 'next' | 'previous' | 'open-settings' | 'none';

export function classifyGesture(
  start: GesturePoint,
  end: GesturePoint,
  surfaceWidth: number,
): GestureAction {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const elapsed = end.at - start.at;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (dy >= 80 && absY > absX * 1.25 && elapsed <= 700) {
    return 'open-settings';
  }
  if (absX >= 60 && absX > absY * 1.25) {
    return dx < 0 ? 'next' : 'previous';
  }
  if (absX <= 12 && absY <= 12 && elapsed <= 500) {
    return end.x < surfaceWidth / 2 ? 'tap-left' : 'tap-right';
  }
  return 'none';
}
