import getStroke from "perfect-freehand";

export type Point = [number, number, number]; // [x, y, pressure]

export type ThicknessMode = "uniform" | "variable";

export interface StrokeOptions {
  strokeWidth: number;
  smoothing: number; // 0–1
  mode?: ThicknessMode; // default: "uniform"
}

// ─── Curve Smoothing Pipeline ────────────────────────────────────────────────
// When drawing with a mouse/cursor, raw pointer events suffer from:
// 1. Hand micro-tremors and friction jitter.
// 2. High density clustering at slow speeds, causing normal vector twisting.
// 3. Angular step discretization on curves.
//
// Pipeline:
//   Raw points
//   → Distance filter (strips micro-steps & zero-distance duplicates)
//   → Ramer-Douglas-Peucker (RDP) simplification (removes wobbles while keeping curve trajectory)
//   → Chaikin corner-cutting (subdivides into smooth quadratic B-spline curves)
//   → Uniform arc-length resampling (equalizes point spacing so perfect-freehand's normals are silky)
//   → perfect-freehand outline → quadratic-Bézier SVG path

/**
 * Filter out points that are too close to the previous point to remove
 * mouse sensor jitter and event flooding.
 */
function filterDistance(pts: Point[], minDistance: number): Point[] {
  if (pts.length <= 2) return pts;
  const result: Point[] = [pts[0]];
  let prev = pts[0];

  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i][0] - prev[0], pts[i][1] - prev[1]);
    if (d >= minDistance) {
      result.push(pts[i]);
      prev = pts[i];
    }
  }

  // Always retain the final point
  result.push(pts[pts.length - 1]);
  return result;
}

/**
 * Ramer-Douglas-Peucker simplification.
 * Eliminates hand tremors and wiggles that deviate less than `epsilon`
 * from the curve's intended path.
 */
function rdp(pts: Point[], epsilon: number): Point[] {
  if (pts.length <= 2) return pts;

  let maxDist = 0;
  let index = 0;
  const start = pts[0];
  const end = pts[pts.length - 1];

  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lenSq = dx * dx + dy * dy;

  for (let i = 1; i < pts.length - 1; i++) {
    let dist = 0;
    if (lenSq === 0) {
      dist = Math.hypot(pts[i][0] - start[0], pts[i][1] - start[1]);
    } else {
      const t = Math.max(
        0,
        Math.min(1, ((pts[i][0] - start[0]) * dx + (pts[i][1] - start[1]) * dy) / lenSq)
      );
      const projX = start[0] + t * dx;
      const projY = start[1] + t * dy;
      dist = Math.hypot(pts[i][0] - projX, pts[i][1] - projY);
    }

    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist > epsilon) {
    const left = rdp(pts.slice(0, index + 1), epsilon);
    const right = rdp(pts.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  } else {
    return [start, end];
  }
}

/**
 * Chaikin's corner-cutting algorithm.
 * Subdivides a polyline into a continuous, flowing quadratic B-spline curve.
 * Bends and curves become perfectly rounded without wild overshooting.
 */
function chaikin(points: Point[], iterations: number): Point[] {
  if (points.length <= 2) return points;

  let current = points;

  for (let it = 0; it < iterations; it++) {
    const next: Point[] = [];
    // Pin stroke start
    next.push(current[0]);

    for (let i = 0; i < current.length - 1; i++) {
      const p0 = current[i];
      const p1 = current[i + 1];

      const q: Point = [
        0.75 * p0[0] + 0.25 * p1[0],
        0.75 * p0[1] + 0.25 * p1[1],
        0.75 * p0[2] + 0.25 * p1[2],
      ];

      const r: Point = [
        0.25 * p0[0] + 0.75 * p1[0],
        0.25 * p0[1] + 0.75 * p1[1],
        0.25 * p0[2] + 0.75 * p1[2],
      ];

      next.push(q);
      next.push(r);
    }

    // Pin stroke end
    next.push(current[current.length - 1]);
    current = next;
  }

  return current;
}

/**
 * Resample points so every segment has uniform arc-length distance.
 * Uniform point spacing is critical for `perfect-freehand`'s normal vector
 * calculation, ensuring smooth, non-pinched ribbon boundaries on curves.
 */
function resampleByLength(points: Point[], step = 4): Point[] {
  if (points.length <= 2) return points;

  const result: Point[] = [points[0]];
  let accumulated = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const segLen = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (segLen === 0) continue;

    let distOnSeg = 0;
    while (accumulated + (segLen - distOnSeg) >= step) {
      const needed = step - accumulated;
      distOnSeg += needed;
      const t = distOnSeg / segLen;
      result.push([
        p0[0] + t * (p1[0] - p0[0]),
        p0[1] + t * (p1[1] - p0[1]),
        p0[2] + t * (p1[2] - p0[2]),
      ]);
      accumulated = 0;
    }
    accumulated += segLen - distOnSeg;
  }

  const last = points[points.length - 1];
  const lastResult = result[result.length - 1];
  if (
    Math.hypot(lastResult[0] - last[0], lastResult[1] - last[1]) > 1
  ) {
    result.push(last);
  }

  return result;
}

/**
 * Build a closed SVG path string from raw pointer points.
 */
export function buildStrokePath(
  points: Point[],
  { strokeWidth, smoothing, mode = "uniform" }: StrokeOptions
): string {
  if (points.length === 0) return "";

  // If only 1 point (a click/tap), duplicate slightly to draw a circular dot
  let inputPoints = points;
  if (inputPoints.length === 1) {
    const p = inputPoints[0];
    inputPoints = [p, [p[0] + 0.1, p[1] + 0.1, p[2]]];
  }

  let processed = inputPoints;

  if (processed.length > 2) {
    // 1. Filter out micro-distance mouse events
    const minDist = 2.0 + smoothing * 3.0; // 2px to 5px
    const filtered = filterDistance(processed, minDist);

    // 2. RDP simplification: eliminate hand tremor & wobble
    const epsilon = 1.0 + smoothing * 3.5; // 1px to 4.5px
    const simplified = rdp(filtered, epsilon);

    // 3. Chaikin corner-cutting: round all corners into flowing arcs
    const iterations = Math.min(4, Math.max(2, Math.round(2 + smoothing * 2)));
    const smoothed = chaikin(simplified, iterations);

    // 4. Uniform arc-length resampling for consistent ribbon normals
    processed = resampleByLength(smoothed, 4);
  }

  const isVariable = mode === "variable";

  const outline = getStroke(processed, {
    size: strokeWidth,
    thinning: isVariable ? 0.6 : 0,
    smoothing: 0.6 + smoothing * 0.35,
    streamline: 0.2 + smoothing * 0.3,
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
