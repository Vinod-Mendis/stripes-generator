import getStroke from "perfect-freehand";

export type Point = [number, number, number]; // [x, y, pressure]

export type ThicknessMode = "uniform" | "variable";

export interface StrokeOptions {
  strokeWidth: number;
  smoothing: number; // 0–1
  mode?: ThicknessMode; // default: "uniform"
}

/**
 * Weighted moving-average pre-pass to kill pointer jitter before
 * perfect-freehand ever sees the points.  Run multiple passes for
 * progressively smoother output while keeping end-points fixed.
 */
function smoothPoints(points: Point[], passes = 3): Point[] {
  let pts = [...points];
  for (let p = 0; p < passes; p++) {
    pts = pts.map((pt, i) => {
      if (i === 0 || i === pts.length - 1) return pt;
      return [
        (pts[i - 1][0] + pt[0] * 2 + pts[i + 1][0]) / 4,
        (pts[i - 1][1] + pt[1] * 2 + pts[i + 1][1]) / 4,
        pt[2],
      ] as Point;
    });
  }
  return pts;
}

/**
 * Build a closed SVG path string from raw pointer points using perfect-freehand.
 *
 * Pipeline:
 *   raw points → weighted moving-average (3 passes) → perfect-freehand
 *   (parallel-offset outline, thinning=0) → closed quadratic-Bézier SVG path
 *
 * thinning: 0  → no width variation regardless of pressure / velocity.
 * simulatePressure: false → ignore device pressure entirely.
 * streamline == smoothing (capped at 0.99) → aggressive pre-filter on the
 * point stream before the outline is computed.
 */
export function buildStrokePath(
  points: Point[],
  { strokeWidth, smoothing, mode = "uniform" }: StrokeOptions
): string {
  if (points.length === 0) return "";

  // Extra pre-smoothing pass — reduces jitter before spline fitting
  const preprocessed = points.length > 4 ? smoothPoints(points, 3) : points;

  const isVariable = mode === "variable";

  const outline = getStroke(preprocessed, {
    size: strokeWidth,
    thinning: isVariable ? 0.6 : 0,
    smoothing: Math.max(0, Math.min(1, smoothing)),
    streamline: Math.max(0, Math.min(0.99, smoothing)),
    simulatePressure: isVariable,
    last: true,
    easing: (t) => t,
  });

  return outlineToPath(outline);
}

/**
 * Convert the parallel-offset outline produced by perfect-freehand into a
 * closed quadratic-Bézier SVG path via midpoint-averaging.
 */
function outlineToPath(pts: number[][]): string {
  if (pts.length < 2) return "";

  const d: string[] = [];

  const start = avg(pts[0], pts[1]);
  d.push(`M ${start[0].toFixed(2)} ${start[1].toFixed(2)}`);

  for (let i = 1; i < pts.length - 1; i++) {
    const mid = avg(pts[i], pts[i + 1]);
    d.push(
      `Q ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)} ${mid[0].toFixed(2)} ${mid[1].toFixed(2)}`
    );
  }

  d.push("Z");
  return d.join(" ");
}

function avg(a: number[], b: number[]): number[] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
