import { describe, expect, it } from 'vitest';
import { buildScenes, omitSceneItems, sceneNavigationPlan } from './collage-policy';
import { DEFAULT_FRAME_SETTINGS, FrameManifest, MediaItem } from './models';
import { orderManifestMedia } from './slideshow-policy';

const item = (
  id: string,
  width = 600,
  height = 1000,
  kind: 'photo' | 'video' = 'photo',
): MediaItem => ({
  id,
  width,
  height,
  kind,
  url: `/${id}`,
  sha256: id,
  posterUrl: null,
  caption: null,
  senderName: null,
  receivedAt: `2026-09-${id.padStart(2, '0')}T00:00:00Z`,
  fitMode: 'inherit',
  rotationDegrees: 0,
  durationSeconds: kind === 'video' ? 10 : null,
  sizeBytes: 1,
  posterSizeBytes: null,
});

describe('collage básico', () => {
  it('mezcla aproximadamente un 25% de escenas individuales, incluyendo fotos y videos', () => {
    const media = Array.from({ length: 4000 }, (_, i) => item(`sample-${i}`, 670, 1000, i % 5 ? 'photo' : 'video'));
    const scenes = buildScenes(media, 'adaptive', 1.6, 12345);
    const solos = scenes.filter((scene) => scene.cells.length === 1);
    expect(solos.length / scenes.length).toBeGreaterThan(0.20);
    expect(solos.length / scenes.length).toBeLessThan(0.30);
    expect(solos.some((scene) => scene.driver.kind === 'photo')).toBe(true);
    expect(solos.some((scene) => scene.driver.kind === 'video')).toBe(true);
    expect(solos.every((scene) => scene.cells[0].width === 1 && scene.cells[0].height === 1)).toBe(true);
    const ids = scenes.flatMap((scene) => scene.cells.map((cell) => cell.item.id));
    expect(ids.length).toBe(media.length);
    expect(new Set(ids).size).toBe(media.length);
    for (const scene of scenes) expect(scene.cells.filter((cell) => cell.item.kind === 'video').length).toBeLessThanOrEqual(1);
  });

  it('fija el sorteo durante la sesión sin que colores o versiones alteren agrupación', () => {
    const media = Array.from({ length: 80 }, (_, i) => item(`sample-${i}`));
    const original = buildScenes(media, 'adaptive', 1.6, 42);
    const decorated = buildScenes(media.map((entry) => ({ ...entry, bandColors: ['#123456', '#654321'] as [string, string] })), 'adaptive', 1.6, 42);
    expect(decorated.map((scene) => scene.key)).toEqual(original.map((scene) => scene.key));
    expect(buildScenes(media, 'adaptive', 1.6, 43).map((scene) => scene.key)).not.toEqual(original.map((scene) => scene.key));
    for (const mode of ['off', 'columns'] as const) {
      expect(buildScenes(media, mode, 1.6, 42)).toEqual(buildScenes(media, mode, 1.6, 43));
    }
  });

  it('elige anchos diferentes sin alterar la prioridad del material inicial', () => {
    const scene = buildScenes([item('1', 480), item('2', 1120)], 'adaptive')[0];
    expect(scene.cells.map((c) => c.width)).toEqual([0.3, 0.7]);
    expect(scene.cells[0].item.id).toBe('1');
  });

  it('puede colocar la columna completa a ambos lados y una horizontal inicial en una fila', () => {
    const scene = buildScenes([item('1', 560), item('2', 2080), item('3', 2080)], 'adaptive')[0];
    expect(scene.cells).toHaveLength(3);
    expect(scene.cells[0].height).toBe(1);
    expect(scene.cells[0].width).toBeLessThan(0.5);
    const otherSide = buildScenes([item('2', 560), item('3', 2080), item('4', 2080)], 'adaptive')[0];
    expect(scene.cells[0].left).toBeGreaterThan(0);
    expect(otherSide.cells[0].left).toBe(0);
    const reverse = buildScenes([item('2', 2080), item('1', 560), item('3', 2080)], 'adaptive')[0];
    expect(reverse.cells[0].height).toBe(0.5);
    expect(reverse.cells[1].height).toBe(1);
    expect(reverse.cells[0].item.id).toBe('2');
  });

  it('recompone todos los supervivientes con el selector del modo original', () => {
    const media = [item('1', 400), item('2', 400), item('3', 1600), item('4', 1600)];
    const scene = buildScenes(media, 'adaptive')[0];
    const survivors = omitSceneItems(scene, (entry) => entry.id === '2')!;
    expect(survivors.cells.map((c) => c.item.id)).toEqual(['1', '3', '4']);
    expect(survivors.cells.some((c) => c.height === 0.5)).toBe(true);
    expect(survivors.layoutMode).toBe('adaptive');
  });

  it('conserva el modo individual y los manifiestos sin dimensiones', () => {
    const photos = [item('1'), { ...item('2'), width: undefined }];
    expect(buildScenes(photos).map((scene) => scene.cells.length)).toEqual([1, 1]);
    expect(buildScenes(photos, 'columns').map((scene) => scene.cells.length)).toEqual([1, 1]);
  });

  it('escoge dos o tres columnas según las proporciones', () => {
    expect(
      buildScenes([item('1', 800), item('2', 800), item('3', 800)], 'columns')[0].cells,
    ).toHaveLength(2);
    const narrow = buildScenes([item('1', 530), item('2', 530), item('3', 530)], 'columns');
    expect(narrow[0].cells).toHaveLength(3);
    expect(narrow[0].cells.every((cell) => cell.height === 1)).toBe(true);
  });

  it('muestra horizontales y cuadrados solos en columnas', () => {
    const photos = [item('1', 1600), item('2', 1000), item('3', 1800)];
    expect(buildScenes(photos, 'columns').map((scene) => scene.cells.length)).toEqual([1, 1, 1]);
  });

  it('acepta tres horizontales con una columna completa y otra de dos filas', () => {
    const scenes = buildScenes([item('1', 1600), item('2', 1600), item('3', 1600)], 'adaptive');
    expect(scenes).toHaveLength(1);
    expect(scenes[0].cells.map((cell) => cell.height)).toEqual([1, 0.5, 0.5]);
  });

  it('usa un solo video como reloj y conserva todos los videos pendientes', () => {
    const media = [
      item('1'),
      item('2', 600, 1000, 'video'),
      item('3', 600, 1000, 'video'),
      item('4'),
    ];
    const scenes = buildScenes(media, 'adaptive');
    expect(scenes.flatMap((scene) => scene.cells.map((cell) => cell.item.id)).sort()).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    for (const scene of scenes) {
      const videos = scene.cells.filter((cell) => cell.item.kind === 'video');
      expect(videos.length).toBeLessThanOrEqual(1);
      if (videos.length) expect(scene.driver).toBe(videos[0].item);
    }
  });

  it.each(['newest', 'oldest', 'shuffle'] as const)(
    'parte de %s sin repeticiones ni pérdida de materiales',
    (order) => {
      const media = Array.from({ length: 24 }, (_, index) =>
        item(String(index + 1), index % 3 ? 600 : 1600),
      );
      const ordered = orderManifestMedia(media, order, 3);
      for (const mode of ['columns', 'adaptive'] as const) {
        const scenes = buildScenes(ordered, mode);
        expect(scenes[0].cells[0].item.id).toBe(ordered[0].id);
        const ids = scenes.flatMap((scene) => scene.cells.map((cell) => cell.item.id));
        expect(ids.length).toBe(media.length);
        expect(new Set(ids).size).toBe(media.length);
        const shown = new Set<string>();
        for (const scene of scenes) {
          expect(scene.cells[0].item.id).toBe(ordered.find((entry) => !shown.has(entry.id))!.id);
          scene.cells.forEach((cell) => shown.add(cell.item.id));
        }
      }
    },
  );

  it('no crea celdas fuera de pantalla, solapamientos ni subdivisiones adicionales', () => {
    const media = Array.from({ length: 200 }, (_, index) =>
      item(String(index), 300 + ((index * 73) % 2000)),
    );
    for (const scene of buildScenes(media, 'adaptive')) {
      expect(scene.cells.length).toBeLessThanOrEqual(4);
      const area = scene.cells.reduce((sum, cell) => sum + cell.width * cell.height, 0);
      expect(area).toBeCloseTo(1);
      for (const cell of scene.cells) {
        expect(cell.left + cell.width).toBeLessThanOrEqual(1);
        expect(cell.top + cell.height).toBeLessThanOrEqual(1);
        expect([0.5, 1]).toContain(cell.height);
      }
    }
  });

  it('retira sólo un archivo fallido y da todo el espacio al último válido', () => {
    const [scene] = buildScenes([item('1'), item('2')], 'columns');
    const remainder = omitSceneItems(scene, (entry) => entry.id === '2')!;
    expect(remainder.cells).toHaveLength(1);
    expect(remainder.cells[0].width).toBe(1);
    expect(omitSceneItems(remainder, () => true)).toBeNull();
  });

  it('navega por escenas y permite abrir un acompañante desde la galería', () => {
    const active: FrameManifest = {
      schemaVersion: 1,
      frameId: 'f',
      version: 1,
      publishedAt: '',
      settingsRevision: 0,
      settings: { ...DEFAULT_FRAME_SETTINGS, collageMode: 'columns' },
      media: Array.from({ length: 6 }, (_, index) => item(String(index + 1), 530)),
    };
    const scenesFor = (manifest: FrameManifest) =>
      buildScenes(manifest.media, manifest.settings.collageMode);
    const input = {
      active,
      pending: null,
      currentIndex: 0,
      currentMediaId: '1',
      direction: 1 as const,
    };
    const next = sceneNavigationPlan(input, scenesFor)[0];
    expect(next.scene.cells.map((cell) => cell.item.id)).toEqual(['4', '5', '6']);
    expect(next.manifest).toBe(active);
    expect(
      sceneNavigationPlan(
        { ...input, currentIndex: 1, currentMediaId: '4', direction: -1 },
        scenesFor,
      )[0].item.id,
    ).toBe('1');
    expect(sceneNavigationPlan({ ...input, preferredMediaId: '3' }, scenesFor)[0].item.id).toBe(
      '1',
    );
  });
});
