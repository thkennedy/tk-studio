import { describe, expect, test } from "vitest";
import { pickZoom } from "./pickZoom";

const TILE = 16;
const RATIOS = [1, 2, 3];
const SIZES: Array<[string, number, number]> = [
  ["desktop 1920x1080", 1920, 1080],
  ["iPad landscape 1180x820", 1180, 820],
  ["iPad portrait 820x1180", 820, 1180],
];

describe("pickZoom over the three ratios and three container sizes", () => {
  for (const [label, w, h] of SIZES) {
    for (const ratio of RATIOS) {
      test(`${label} at ratio ${ratio}: integer zoom >= 1, whole device pixels per tile`, () => {
        const zoom = pickZoom(ratio, w, h, TILE);
        expect(Number.isInteger(zoom)).toBe(true);
        expect(zoom).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(TILE * zoom)).toBe(true);
        expect(Number.isInteger(TILE * zoom * ratio)).toBe(true);
      });
    }

    test(`${label}: non-decreasing in ratio`, () => {
      const zooms = RATIOS.map((r) => pickZoom(r, w, h, TILE));
      for (let i = 1; i < zooms.length; i++) expect(zooms[i]).toBeGreaterThanOrEqual(zooms[i - 1]);
    });
  }

  test("the recipe's values for the grid", () => {
    const table = SIZES.map(([, w, h]) => RATIOS.map((r) => pickZoom(r, w, h, TILE)));
    expect(table).toEqual([
      [5, 11, 16],
      [4, 8, 12],
      [4, 8, 12],
    ]);
  });
});

describe("pickZoom on a tiny or broken container", () => {
  test.each([
    [1, 0, 0],
    [2, 0, 800],
    [3, 800, 0],
    [1, 10, 10],
    [2, 15, 15],
  ])("ratio %d, %dx%d gives 1", (ratio, w, h) => {
    expect(pickZoom(ratio, w, h, TILE)).toBe(1);
  });

  test.each([
    [Number.NaN, 800, 600, TILE],
    [2, Number.NaN, 600, TILE],
    [2, 800, Number.POSITIVE_INFINITY, TILE],
    [-1, 800, 600, TILE],
    [2, -800, 600, TILE],
    [2, 800, 600, 0],
    [0, 800, 600, TILE],
  ])("pickZoom(%s, %s, %s, %s) is 1, never 0, NaN or negative", (ratio, w, h, tile) => {
    expect(pickZoom(ratio, w, h, tile)).toBe(1);
  });
});
