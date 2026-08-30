import {
  IDENTITY_PHOTO_TRANSFORM,
  MAX_PHOTO_ZOOM,
  panTransform,
  pinchTransform,
  pointDistance,
  pointMidpoint,
} from './photo-zoom';

const surface = { width: 1280, height: 800 };

describe('photo zoom', () => {
  it('calcula distancia y punto medio entre los dedos', () => {
    expect(pointDistance({ x: 100, y: 100 }, { x: 400, y: 500 })).toBe(500);
    expect(pointMidpoint({ x: 100, y: 200 }, { x: 300, y: 600 })).toEqual({
      x: 200,
      y: 400,
    });
  });

  it('amplía alrededor del punto medio del gesto', () => {
    expect(
      pinchTransform(
        IDENTITY_PHOTO_TRANSFORM,
        200,
        { x: 600, y: 400 },
        400,
        { x: 700, y: 400 },
        surface,
      ),
    ).toEqual({ scale: 2, x: 140, y: 0 });
  });

  it('limita el zoom y evita desplazar la fotografía fuera de la pantalla', () => {
    const zoomed = pinchTransform(
      IDENTITY_PHOTO_TRANSFORM,
      100,
      { x: 640, y: 400 },
      1_000,
      { x: 640, y: 400 },
      surface,
    );
    expect(zoomed.scale).toBe(MAX_PHOTO_ZOOM);
    expect(panTransform(zoomed, 10_000, -10_000, surface)).toEqual({
      scale: MAX_PHOTO_ZOOM,
      x: 1_920,
      y: -1_200,
    });
  });

  it('vuelve a identidad al reducir hasta escala natural', () => {
    expect(
      pinchTransform(
        { scale: 2, x: 100, y: 50 },
        400,
        { x: 640, y: 400 },
        100,
        { x: 640, y: 400 },
        surface,
      ),
    ).toEqual(IDENTITY_PHOTO_TRANSFORM);
  });
});
