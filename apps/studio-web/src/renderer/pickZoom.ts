// The pixel-scaling recipe (Story 30.1, D5). Pure: no Pixi, no DOM, so vitest runs it in node.
//
// `zoom` is device pixels per source pixel. The stage is scaled by `zoom / ratio` under
// `resolution = ratio` and `autoDensity`, so one source pixel is exactly `zoom` device pixels
// and a `tile`-pixel tile is `tile * zoom` device pixels, whole by construction. Whole-canvas
// crispness is claimed for the integer ratios 1, 2 and 3 only: at a fractional ratio the canvas
// backing store is rounded and the browser may resample it (unverified).

/** Target number of tiles across the container's short side. */
export const TARGET_TILES = 12;

/**
 * Integer zoom (device pixels per source pixel), at least 1.
 *
 * zoom = max(1, floor(min(width, height) * ratio / (tile * TARGET_TILES)))
 *
 * `width`/`height` are the container's CSS pixels, `ratio` the device pixel ratio, `tile` the
 * source tile size in pixels. Non-finite or non-positive inputs give 1 (never 0, NaN or negative).
 */
export function pickZoom(ratio: number, width: number, height: number, tile: number): number {
  for (const v of [ratio, width, height, tile]) {
    if (!Number.isFinite(v) || v <= 0) return 1;
  }
  const zoom = Math.floor((Math.min(width, height) * ratio) / (tile * TARGET_TILES));
  return Math.max(1, zoom);
}
