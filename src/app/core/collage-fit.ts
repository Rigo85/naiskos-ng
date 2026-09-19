import { FitMode, MediaItem } from './models';

export type CollageRectangle = [number, number, number, number];
export interface CollageFit {
  rectangles: CollageRectangle[];
  automaticCover: boolean[];
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
// Geometry only: bounded cache, no media URLs, DOM nodes or image buffers.
const cache = new Map<string, CollageFit>();
const CACHE_LIMIT = 64;

function range(min: number, max: number, original: number): number[] {
  const values = new Set([original]);
  for (let i = Math.ceil(min * 100); i <= Math.floor(max * 100); i++) values.add(i / 100);
  return [...values].sort((a, b) => a - b);
}

/** Refine the selected topology, not the library or its ordering. Two bounded
 * passes retain just one winner, instead of allocating/sorting all candidates. */
export function refineCollageFit(
  items: MediaItem[], original: CollageRectangle[], aspect: number, defaultFit: FitMode,
): CollageFit {
  const unchanged = () => ({ rectangles: original, automaticCover: items.map(() => false) });
  if (items.length < 2 || items.length > 4 || original.length !== items.length ||
    !Number.isFinite(aspect) || aspect <= 0 || items.some((item) =>
      !Number.isFinite(item.width) || !Number.isFinite(item.height) || item.width! <= 0 || item.height! <= 0)) {
    return unchanged();
  }
  const key = JSON.stringify([aspect, defaultFit, original,
    items.map((item) => [item.width, item.height, item.kind, item.fitMode])]);
  const cached = cache.get(key);
  if (cached) return cached;

  const grouped = new Map<string, number[]>();
  original.forEach((r, i) => {
    const key = r[0].toFixed(4);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(i);
  });
  const columns = [...grouped.values()].sort((a, b) => original[a[0]][0] - original[b[0]][0])
    .map((ids) => ids.sort((a, b) => original[a][1] - original[b][1]));
  if (columns.length < 2 || columns.length > 3 || columns.some((c) => c.length > 2)) return unchanged();
  const ratios = items.map((item) => item.width! / item.height!);
  const cover = items.map((item) => (item.fitMode === 'inherit' ? defaultFit : item.fitMode) === 'cover');
  const eligible = items.map((item) => item.fitMode === 'inherit' && item.kind === 'photo');
  const widths = columns.map((c) => original[c[0]][2]);
  const widthOptions = widths.map((w) => range(Math.max(.22, w - .08), Math.min(.78, w + .08), w));
  const heights = columns.map((c) => c.length === 1 ? [1] : range(.35, .65, original[c[0]][3]));
  const rects = original.map((r) => [...r] as CollageRectangle);
  const ws: number[] = [];
  // Score: bands, worst cell's bands, mean crop, maximum crop, movement.
  const score = [0, 0, 0, 0, 0];
  function measure(rs: CollageRectangle[], automatic: boolean): void {
    score.fill(0);
    for (let i = 0; i < items.length; i++) {
      const r = rs[i];
      const cellRatio = aspect * r[2] / r[3];
      const mismatch = 1 - Math.min(ratios[i] / cellRatio, cellRatio / ratios[i]);
      const crop = cover[i] || (automatic && eligible[i] && mismatch <= .08 + 1e-10);
      if (crop) {
        score[2] += mismatch;
        score[3] = Math.max(score[3], mismatch);
      } else {
        score[0] += mismatch * round(r[2]) * round(r[3]);
        score[1] = Math.max(score[1], mismatch);
      }
      for (let j = 0; j < 4; j++) score[4] += Math.abs(r[j] - original[i][j]);
    }
    score[2] /= items.length;
  }
  measure(original, false);
  const initial = [...score];
  let minBands = initial[0];
  let bestScore = initial;
  let best: CollageFit = unchanged();
  let pass = 0;
  function consider(rs: CollageRectangle[]): void {
    measure(rs, true);
    if (score[0] > initial[0] + 1e-9) return;
    if (pass === 0) { minBands = Math.min(minBands, score[0]); return; }
    if (score[0] > minBands + .01 + 1e-9) return;
    let better = bestScore[0] > minBands + .01 + 1e-9;
    if (!better) {
      for (let i = 1; i < score.length; i++) {
        if (score[i] !== bestScore[i]) { better = score[i] < bestScore[i]; break; }
      }
    }
    if (!better) return;
    bestScore = [...score];
    best = {
      rectangles: rs.map((r) => r.map(round) as CollageRectangle),
      automaticCover: rs.map((r, i) => {
        const cellRatio = aspect * r[2] / r[3];
        return !cover[i] && eligible[i] &&
          1 - Math.min(ratios[i] / cellRatio, cellRatio / ratios[i]) <= .08 + 1e-10;
      }),
    };
  }
  function fill(col: number, x: number): void {
    if (col === columns.length) { consider(rects); return; }
    for (const h of heights[col]) {
      columns[col].forEach((index, row) => {
        const r = rects[index];
        r[0] = x; r[1] = row === 0 ? 0 : h; r[2] = ws[col];
        r[3] = columns[col].length === 1 ? 1 : row === 0 ? h : 1 - h;
      });
      fill(col + 1, x + ws[col]);
    }
  }
  function chooseWidths(col: number, total: number): void {
    if (col === columns.length - 1) {
      const last = round(1 - total);
      if (last >= .22 - 1e-9 && last <= .78 + 1e-9 && Math.abs(last - widths[col]) <= .080001) {
        ws[col] = last;
        fill(0, 0);
      }
      return;
    }
    for (const w of widthOptions[col]) { ws[col] = w; chooseWidths(col + 1, total + w); }
  }
  consider(original);
  chooseWidths(0, 0);
  if (minBands < initial[0] - 1e-9) {
    pass = 1;
    consider(original);
    chooseWidths(0, 0);
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, best);
  return best;
}
