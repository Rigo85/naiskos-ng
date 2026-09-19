import { describe, expect, it } from 'vitest';
import { CollageRectangle, refineCollageFit } from './collage-fit';
import { buildScenes, omitSceneItems, refineScene, singleScene } from './collage-policy';
import { MediaItem } from './models';

const item = (width: number, height: number, id = 'sample'): MediaItem => ({
  id, width, height, kind: 'photo', fitMode: 'inherit', sha256: id, url: `/${id}`,
  caption: null, senderName: null, receivedAt: '', rotationDegrees: 0,
  durationSeconds: null, sizeBytes: 1, posterUrl: null, posterSizeBytes: null,
});
const mismatch = (entry: MediaItem, r: CollageRectangle, aspect: number) => {
  const a = entry.width! / entry.height!, b = aspect * r[2] / r[3];
  return 1 - Math.min(a / b, b / a);
};

describe('encuadre acotado del collage', () => {
  it('reproduce la corrección aprobada: no empeora la columna fina por redistribuir bandas', () => {
    const result = refineCollageFit([item(960, 1280), item(577, 1280)],
      [[0, 0, .7, 1], [.7, 0, .30000000000000004, 1]], 1.6, 'contain');
    expect(result.rectangles).toEqual([[0, 0, .7, 1], [.7, 0, .3, 1]]);
    expect(result.automaticCover).toEqual([false, true]);
  });

  it('reproduce la corrección aprobada de dos columnas y una partida', () => {
    const result = refineCollageFit([item(1280, 577), item(1280, 852), item(577, 1280), item(577, 1280)],
      [[0, 0, .5, .5], [0, .5, .5, .5], [.75, 0, .25, 1], [.5, 0, .25, 1]], 1.6, 'contain');
    expect(result.rectangles).toEqual([[0, 0, .48, .37], [0, .37, .48, .63], [.74, 0, .26, 1], [.48, 0, .26, 1]]);
    expect(result.automaticCover).toEqual([true, false, true, true]);
  });

  it('respeta contain explícito, cover y videos sin agregarles recorte automático', () => {
    const original: CollageRectangle[] = [[0, 0, .5, 1], [.5, 0, .5, 1]];
    for (const entry of [{ ...item(760, 1000), fitMode: 'contain' as const },
      { ...item(760, 1000), fitMode: 'cover' as const }, { ...item(760, 1000), kind: 'video' as const }]) {
      expect(refineCollageFit([entry, item(760, 1000)], original, 1.6, 'contain').automaticCover[0]).toBe(false);
    }
    const covered = refineCollageFit([item(760, 1000), item(760, 1000)], original, 1.6, 'cover');
    expect(covered.rectangles).toEqual(original);
    expect(covered.automaticCover).toEqual([false, false]);
  });

  it('no refina toda la biblioteca ni cambia escenas individuales o dimensiones desconocidas', () => {
    const scenes = buildScenes([item(760, 1000, '1'), item(760, 1000, '2')], 'columns');
    expect(scenes[0].fitRefined).toBeUndefined();
    const refined = refineScene(scenes[0], 'contain');
    expect(refined.fitRefined).toBe(true);
    expect(refineScene(refined, 'contain')).toBe(refined);
    const solo = singleScene(item(760, 1000));
    expect(refineScene(solo, 'contain')).toBe(solo);
    const survivor = omitSceneItems(refined, (entry) => entry.id === '2')!;
    expect(refineScene(survivor, 'contain').cells[0].automaticCover).toBeUndefined();
    expect(refineCollageFit([{ ...item(760, 1000), width: undefined }, item(760, 1000)],
      [[0, 0, .5, 1], [.5, 0, .5, 1]], 1.6, 'contain').automaticCover).toEqual([false, false]);
  });

  it('mantiene materiales, driver, área y límites en diferentes proporciones de pantalla', () => {
    for (const aspect of [1.6, 16 / 9, 4 / 3, .625]) {
      const media = Array.from({ length: 90 }, (_, i) => ({
        ...item(350 + i * 43, 1280, `test-${i}`),
        kind: i % 11 === 0 ? 'video' as const : 'photo' as const,
        fitMode: i % 7 === 0 ? 'contain' as const : 'inherit' as const,
      }));
      for (const scene of buildScenes(media, 'adaptive', aspect, 44)) {
        const refined = refineScene(scene, 'contain');
        expect(refined.driver).toBe(scene.driver);
        expect(refined.cells.map((c) => c.item)).toEqual(scene.cells.map((c) => c.item));
        let before = 0, after = 0, area = 0;
        refined.cells.forEach((cell, i) => {
          const r: CollageRectangle = [cell.left, cell.top, cell.width, cell.height];
          const old = scene.cells[i];
          before += mismatch(cell.item, [old.left, old.top, old.width, old.height], aspect) * old.width * old.height;
          const loss = mismatch(cell.item, r, aspect);
          area += cell.width * cell.height;
          if (cell.automaticCover) {
            expect(cell.item.kind).toBe('photo');
            expect(cell.item.fitMode).toBe('inherit');
            expect(loss).toBeLessThanOrEqual(.080002);
          } else after += loss * cell.width * cell.height;
          expect(cell.left + cell.width).toBeLessThanOrEqual(1.000002);
          expect(cell.top + cell.height).toBeLessThanOrEqual(1.000002);
          expect(cell.width).toBeGreaterThan(0);
          expect(cell.height).toBeGreaterThan(0);
          for (const other of refined.cells.slice(i + 1)) {
            expect(Math.min(cell.left + cell.width, other.left + other.width) - Math.max(cell.left, other.left) < .000002 ||
              Math.min(cell.top + cell.height, other.top + other.height) - Math.max(cell.top, other.top) < .000002).toBe(true);
          }
        });
        expect(area).toBeCloseTo(1, 5);
        expect(after).toBeLessThanOrEqual(before + .000002);
      }
    }
  });
});
