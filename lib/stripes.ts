import { buildStrokePath, type Point, type ThicknessMode } from "./smoothing";

export interface GenerateStripesOptions {
  count: number;
  canvasWidth: number;
  canvasHeight: number;
  strokeWidth: number;
  smoothing: number;
  mode?: ThicknessMode;
  /** Palette to pick colors from — shuffled each call for variety. */
  colors: string[];
}

export interface GeneratedStroke {
  d: string;
  color: string;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate bold, organic ribbon squiggles in the brand-identity style:
 * sweeping diagonal S-curves, big open loops with enclosed negative space,
 * and cursive-like ribbons.
 *
 * Each stripe is truly unique because it's built from random waypoints
 * connected by a Catmull-Rom spline — no repeating parametric functions.
 *
 * Five distinct pattern generators are chosen at random:
 *   • Wandering ribbon – free-flowing random walk across the canvas
 *   • Diagonal sweep – enters one corner, sweeps to the opposite
 *   • Loop cluster – circular loops connected by flowing arcs
 *   • Figure-8 / infinity – path crosses itself making enclosed spaces
 *   • Corner sweep – enters one edge, arcs dramatically, exits another
 */
export function generateRandomStripes(
  opts: GenerateStripesOptions
): GeneratedStroke[] {
  const {
    count,
    canvasWidth: w,
    canvasHeight: h,
    strokeWidth,
    smoothing,
    colors,
    mode,
  } = opts;

  const shuffled = shuffleArray([...colors]);
  const results: GeneratedStroke[] = [];

  const generators = [
    generateWandering,
    generateDiagonalSweep,
    generateLoopCluster,
    generateFigure8,
    generateCornerSweep,
  ];

  for (let i = 0; i < count; i++) {
    // Pick a random generator so consecutive stripes look different
    const gen = generators[Math.floor(Math.random() * generators.length)];
    const waypoints = gen(w, h);
    const points = sampleCatmullRom(waypoints, 400);
    const color = shuffled[i % shuffled.length];
    const d = buildStrokePath(points, { strokeWidth, smoothing, mode });
    if (d) results.push({ d, color });
  }

  return results;
}

// ─── Pattern generators ──────────────────────────────────────────────────────
// Each returns an array of [x, y] waypoints. The Catmull-Rom spline will
// create a smooth, organic curve through them. Waypoints extend past canvas
// edges so the ribbon enters/exits naturally.

/**
 * Free-flowing random walk. Picks 6–9 waypoints at random positions across
 * the canvas with some bias toward spreading out. Because every position is
 * randomized, each invocation produces a truly unique path.
 */
function generateWandering(w: number, h: number): number[][] {
  const numPts = 6 + Math.floor(Math.random() * 4); // 6–9
  const pts: number[][] = [];

  // Start off one of the four edges
  const edge = Math.floor(Math.random() * 4);
  pts.push(edgePoint(w, h, edge));

  for (let i = 1; i < numPts - 1; i++) {
    // Spread waypoints across the canvas with randomness
    const t = (i - 0.5) / (numPts - 2);
    const x = w * (0.1 + 0.8 * (t + (Math.random() - 0.5) * 0.35));
    const y = h * (0.1 + 0.8 * Math.random());
    pts.push([x, y]);
  }

  // End off a different edge
  const exitEdge = (edge + 1 + Math.floor(Math.random() * 3)) % 4;
  pts.push(edgePoint(w, h, exitEdge));

  return pts;
}

/**
 * Diagonal sweep — enters from one corner region, makes 2–3 large S-bends
 * while crossing diagonally, exits at the opposite corner.
 */
function generateDiagonalSweep(w: number, h: number): number[][] {
  const flipX = Math.random() > 0.5;
  const flipY = Math.random() > 0.5;

  const numBends = 2 + Math.floor(Math.random() * 2); // 2–3
  const pts: number[][] = [];

  for (let i = 0; i <= numBends * 2; i++) {
    const t = i / (numBends * 2);
    // Diagonal baseline from corner to corner
    let x = lerp(-w * 0.15, w * 1.15, t);
    let y = lerp(-h * 0.15, h * 1.15, t);

    // Perpendicular offset for S-curve (alternating direction)
    const perpAmp = Math.min(w, h) * (0.2 + Math.random() * 0.2);
    const sign = i % 2 === 0 ? 1 : -1;
    // Perpendicular to the diagonal is (1, -1) normalized
    const norm = 1 / Math.sqrt(2);
    x += sign * perpAmp * norm * (0.6 + Math.random() * 0.4);
    y += sign * perpAmp * -norm * (0.6 + Math.random() * 0.4);

    if (flipX) x = w - x;
    if (flipY) y = h - y;

    pts.push([x, y]);
  }

  return pts;
}

/**
 * Loop cluster — creates 2–3 large circular loops connected by flowing arcs.
 * The loops create the enclosed negative-space look from reference image 3.
 */
function generateLoopCluster(w: number, h: number): number[][] {
  const numLoops = 2 + Math.floor(Math.random() * 2); // 2–3
  const pts: number[][] = [];

  // Entry point from a random edge
  pts.push(edgePoint(w, h, Math.floor(Math.random() * 4)));

  for (let i = 0; i < numLoops; i++) {
    // Center of this loop — spread across canvas
    const cx = w * (0.2 + 0.6 * ((i + Math.random() * 0.5) / numLoops));
    const cy = h * (0.25 + Math.random() * 0.5);
    const r = Math.min(w, h) * (0.15 + Math.random() * 0.15);

    // Generate loop as ~8 waypoints around a circle with some jitter
    const startAngle = Math.random() * Math.PI * 2;
    const dir = Math.random() > 0.5 ? 1 : -1;
    const loopPts = 7 + Math.floor(Math.random() * 3);

    for (let j = 0; j <= loopPts; j++) {
      const angle = startAngle + dir * (j / loopPts) * Math.PI * 2;
      const jitter = r * 0.15 * (Math.random() - 0.5);
      pts.push([
        cx + (r + jitter) * Math.cos(angle),
        cy + (r + jitter) * Math.sin(angle),
      ]);
    }
  }

  // Exit point — different edge
  pts.push(edgePoint(w, h, Math.floor(Math.random() * 4)));

  return pts;
}

/**
 * Figure-8 / infinity shape — the path crosses itself once or twice,
 * creating enclosed spaces. Very characteristic of brand-identity squiggles.
 */
function generateFigure8(w: number, h: number): number[][] {
  const pts: number[][] = [];
  const cx = w * (0.35 + Math.random() * 0.3);
  const cy = h * (0.35 + Math.random() * 0.3);
  const rx = w * (0.25 + Math.random() * 0.15);
  const ry = h * (0.2 + Math.random() * 0.15);

  // Rotate the entire figure-8 by a random angle
  const rotation = Math.random() * Math.PI;

  // Entry from edge
  const edge = Math.floor(Math.random() * 4);
  pts.push(edgePoint(w, h, edge));

  // Transition toward the figure-8 center
  pts.push([
    cx - rx * 0.5 * Math.cos(rotation),
    cy - ry * 0.5 * Math.sin(rotation),
  ]);

  // Number of crossings (1 = figure-8, 2 = more complex)
  const crossings = 1 + Math.floor(Math.random() * 2);
  const totalPts = 12 * crossings;

  for (let i = 0; i <= totalPts; i++) {
    const t = i / totalPts;
    // Lissajous curve: x oscillates 1×, y oscillates 2× (or vice versa)
    const freqA = crossings;
    const freqB = crossings + 1;
    const angle = t * Math.PI * 2 * freqA;
    const angleB = t * Math.PI * 2 * freqB;

    let lx = rx * Math.cos(angle);
    let ly = ry * Math.sin(angleB);

    // Apply rotation
    const rx2 = lx * Math.cos(rotation) - ly * Math.sin(rotation);
    const ry2 = lx * Math.sin(rotation) + ly * Math.cos(rotation);

    pts.push([cx + rx2, cy + ry2]);
  }

  // Transition out and exit from a different edge
  const exitEdge = (edge + 2) % 4;
  pts.push([
    cx + rx * 0.5 * Math.cos(rotation),
    cy + ry * 0.5 * Math.sin(rotation),
  ]);
  pts.push(edgePoint(w, h, exitEdge));

  return pts;
}

/**
 * Corner sweep — enters from one edge, makes a single dramatic sweeping arc
 * that fills a large portion of the canvas, and exits from an adjacent edge.
 * Simple but bold — like the red ribbon in reference image 2.
 */
function generateCornerSweep(w: number, h: number): number[][] {
  const pts: number[][] = [];

  // Pick entry and exit on adjacent edges
  const entryEdge = Math.floor(Math.random() * 4);
  const exitEdge = (entryEdge + 1) % 4;

  pts.push(edgePoint(w, h, entryEdge));

  // 3–5 interior waypoints making a big sweeping arc
  const numInterior = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < numInterior; i++) {
    const t = (i + 1) / (numInterior + 1);

    // Arc from entry side toward center, then toward exit side
    const baseX = lerp(
      edgePoint(w, h, entryEdge)[0],
      edgePoint(w, h, exitEdge)[0],
      t
    );
    const baseY = lerp(
      edgePoint(w, h, entryEdge)[1],
      edgePoint(w, h, exitEdge)[1],
      t
    );

    // Push waypoints outward from the straight line to create the arc
    const bulge = Math.min(w, h) * (0.3 + Math.random() * 0.3);
    // Direction perpendicular to entry→exit line, with alternating sign
    const sign = (i % 2 === 0 ? 1 : -1) * (Math.random() > 0.5 ? 1 : -1);
    const angle = Math.atan2(
      edgePoint(w, h, exitEdge)[1] - edgePoint(w, h, entryEdge)[1],
      edgePoint(w, h, exitEdge)[0] - edgePoint(w, h, entryEdge)[0]
    );
    const perpAngle = angle + Math.PI / 2;

    pts.push([
      baseX + sign * bulge * Math.cos(perpAngle) * (0.5 + Math.random() * 0.5),
      baseY + sign * bulge * Math.sin(perpAngle) * (0.5 + Math.random() * 0.5),
    ]);
  }

  pts.push(edgePoint(w, h, exitEdge));

  return pts;
}

// ─── Catmull-Rom spline sampling ─────────────────────────────────────────────

function catmullRomPoint(
  p0: number[],
  p1: number[],
  p2: number[],
  p3: number[],
  t: number
): [number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 *
      (2 * p1[0] +
        (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 *
      (2 * p1[1] +
        (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

function sampleCatmullRom(waypoints: number[][], totalSamples: number): Point[] {
  const n = waypoints.length;
  if (n < 2) return waypoints.map((p) => [p[0], p[1], 0.5] as Point);

  const pts: Point[] = [];
  const segs = n - 1;
  const stepsPerSeg = Math.ceil(totalSamples / segs);

  for (let i = 0; i < segs; i++) {
    const p0 = waypoints[Math.max(0, i - 1)];
    const p1 = waypoints[i];
    const p2 = waypoints[i + 1];
    const p3 = waypoints[Math.min(n - 1, i + 2)];

    const steps = i === segs - 1 ? stepsPerSeg + 1 : stepsPerSeg;
    for (let j = 0; j < steps; j++) {
      const t = j / stepsPerSeg;
      const [x, y] = catmullRomPoint(p0, p1, p2, p3, t);
      pts.push([x, y, 0.5]);
    }
  }

  return pts;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Return a random point on the given edge of the canvas, extending 15%
 * past the boundary so the ribbon enters/exits naturally instead of
 * starting awkwardly at the exact canvas border.
 */
function edgePoint(w: number, h: number, edge: number): number[] {
  const overshoot = 0.15;
  switch (edge % 4) {
    case 0: // top
      return [w * (0.1 + Math.random() * 0.8), -h * overshoot];
    case 1: // right
      return [w * (1 + overshoot), h * (0.1 + Math.random() * 0.8)];
    case 2: // bottom
      return [w * (0.1 + Math.random() * 0.8), h * (1 + overshoot)];
    case 3: // left
      return [-w * overshoot, h * (0.1 + Math.random() * 0.8)];
    default:
      return [0, 0];
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
