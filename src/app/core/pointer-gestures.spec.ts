import { classifyGesture } from './pointer-gestures';

describe('classifyGesture', () => {
  it('opens settings only for a sufficiently vertical downward swipe', () => {
    expect(classifyGesture({ x: 500, y: 20, at: 0 }, { x: 505, y: 130, at: 400 }, 1280)).toBe(
      'open-settings',
    );
  });

  it('navigates forward on a left swipe and backward on a right swipe', () => {
    expect(classifyGesture({ x: 800, y: 400, at: 0 }, { x: 680, y: 405, at: 250 }, 1280)).toBe(
      'next',
    );
    expect(classifyGesture({ x: 400, y: 400, at: 0 }, { x: 520, y: 395, at: 250 }, 1280)).toBe(
      'previous',
    );
  });

  it('classifies clean taps by screen half', () => {
    expect(classifyGesture({ x: 300, y: 400, at: 0 }, { x: 304, y: 404, at: 120 }, 1280)).toBe(
      'tap-left',
    );
    expect(classifyGesture({ x: 900, y: 400, at: 0 }, { x: 902, y: 402, at: 120 }, 1280)).toBe(
      'tap-right',
    );
  });

  it('ignores ambiguous diagonal movement', () => {
    expect(classifyGesture({ x: 300, y: 300, at: 0 }, { x: 370, y: 370, at: 300 }, 1280)).toBe(
      'none',
    );
  });
});
