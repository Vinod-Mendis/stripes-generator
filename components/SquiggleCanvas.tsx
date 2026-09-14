"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildStrokePath, type Point, type ThicknessMode } from "@/lib/smoothing";
import { generateRandomStripes } from "@/lib/stripes";
import {
  downloadSVG,
  downloadPNG,
  type ExportStroke,
} from "@/lib/export";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Stroke {
  id: string;
  d: string;
  color: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PALETTE = [
  "#0f0f0f",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

const DEFAULT_COLOR = "#0f0f0f";
const DEFAULT_BG = "#ffffff";
const DEFAULT_WIDTH = 40;
const DEFAULT_SMOOTHING = 0.85;
const DEFAULT_STRIPE_COUNT = 2;

// ─── Component ───────────────────────────────────────────────────────────────

export default function SquiggleCanvas() {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [livePath, setLivePath] = useState("");

  // Tool settings
  const [strokeColor, setStrokeColor] = useState(DEFAULT_COLOR);
  const [bgColor, setBgColor] = useState(DEFAULT_BG);
  const [strokeWidth, setStrokeWidth] = useState(DEFAULT_WIDTH);
  const [smoothing, setSmoothing] = useState(DEFAULT_SMOOTHING);
  const [stripeCount, setStripeCount] = useState(DEFAULT_STRIPE_COUNT);
  const [thicknessMode, setThicknessMode] = useState<ThicknessMode>("uniform");

  // Refs — survive re-renders without stale-closure risk
  const svgRef = useRef<SVGSVGElement>(null);
  const isDrawingRef = useRef(false);
  const livePointsRef = useRef<Point[]>([]);

  // Settings refs so pointer handlers always read latest values
  const strokeColorRef = useRef(strokeColor);
  const strokeWidthRef = useRef(strokeWidth);
  const smoothingRef = useRef(smoothing);
  const thicknessModeRef = useRef(thicknessMode);
  
  strokeColorRef.current = strokeColor;
  strokeWidthRef.current = strokeWidth;
  smoothingRef.current = smoothing;
  thicknessModeRef.current = thicknessMode;

  // Undo / redo stacks
  const undoStack = useRef<Stroke[][]>([]);
  const redoStack = useRef<Stroke[][]>([]);
  const strokesRef = useRef<Stroke[]>([]);
  strokesRef.current = strokes;

  // ── Pointer handlers ─────────────────────────────────────────────────────

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      isDrawingRef.current = true;
      livePointsRef.current = [[e.clientX, e.clientY, e.pressure || 0.5]];
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (!isDrawingRef.current) return;
      e.preventDefault();
      livePointsRef.current = [
        ...livePointsRef.current,
        [e.clientX, e.clientY, e.pressure || 0.5],
      ];
      const d = buildStrokePath(livePointsRef.current, {
        strokeWidth: strokeWidthRef.current,
        smoothing: smoothingRef.current,
        mode: thicknessModeRef.current,
      });
      setLivePath(d);
    },
    []
  );

  const finalize = useCallback(() => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    const points = livePointsRef.current;
    livePointsRef.current = [];
    setLivePath("");

    if (points.length < 2) return;

    const d = buildStrokePath(points, {
      strokeWidth: strokeWidthRef.current,
      smoothing: smoothingRef.current,
      mode: thicknessModeRef.current,
    });
    if (!d) return;

    const newStroke: Stroke = {
      id: crypto.randomUUID(),
      d,
      color: strokeColorRef.current,
    };

    const current = strokesRef.current;
    undoStack.current = [...undoStack.current, current];
    redoStack.current = [];
    setStrokes([...current, newStroke]);
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      e.preventDefault();
      finalize();
    },
    [finalize]
  );

  const handlePointerLeave = useCallback(() => {
    if (isDrawingRef.current) finalize();
  }, [finalize]);

  // ── Undo / Redo / Clear ──────────────────────────────────────────────────

  const undo = useCallback(() => {
    const stack = undoStack.current;
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    redoStack.current = [strokesRef.current, ...redoStack.current];
    undoStack.current = stack.slice(0, -1);
    setStrokes(prev);
  }, []);

  const redo = useCallback(() => {
    const stack = redoStack.current;
    if (stack.length === 0) return;
    const next = stack[0];
    undoStack.current = [...undoStack.current, strokesRef.current];
    redoStack.current = stack.slice(1);
    setStrokes(next);
  }, []);

  const clear = useCallback(() => {
    if (strokesRef.current.length === 0) return;
    undoStack.current = [...undoStack.current, strokesRef.current];
    redoStack.current = [];
    setStrokes([]);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in a text input
      if (
        e.target instanceof HTMLInputElement &&
        e.target.type !== "range" &&
        e.target.type !== "color" &&
        e.target.type !== "checkbox"
      ) {
        return;
      }

      const modifier = e.ctrlKey || e.metaKey;
      if (modifier) {
        const key = e.key.toLowerCase();
        
        // Undo: Ctrl+Z (without shift)
        if (key === "z" && !e.shiftKey) {
          e.preventDefault();
          undo();
        }
        
        // Redo: Ctrl+Shift+Y, Ctrl+Y, or Ctrl+Shift+Z
        if (
          (key === "y" && e.shiftKey) || 
          (key === "y" && !e.shiftKey) || 
          (key === "z" && e.shiftKey)
        ) {
          e.preventDefault();
          redo();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  // ── Generate random stripes ──────────────────────────────────────────────

  const handleGenerate = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();

    const generated = generateRandomStripes({
      count: stripeCount,
      canvasWidth: width,
      canvasHeight: height,
      strokeWidth: strokeWidthRef.current,
      smoothing: smoothingRef.current,
      mode: thicknessModeRef.current,
      colors: PALETTE,
    });

    const newStrokes: Stroke[] = generated.map((g) => ({
      id: crypto.randomUUID(),
      d: g.d,
      color: g.color,
    }));

    const current = strokesRef.current;
    undoStack.current = [...undoStack.current, current];
    redoStack.current = [];
    setStrokes([...current, ...newStrokes]);
  }, [stripeCount]);

  // ── Export ───────────────────────────────────────────────────────────────

  const handleExportSVG = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const exportStrokes: ExportStroke[] = strokes.map((s) => ({
      d: s.d,
      color: s.color,
      fill: s.color,
    }));
    downloadSVG(exportStrokes, bgColor, Math.round(width), Math.round(height));
  }, [strokes, bgColor]);

  const handleExportPNG = useCallback(() => {
    if (svgRef.current) downloadPNG(svgRef.current, 2);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  return (
    <div className="flex flex-col h-screen md:flex-row overflow-hidden">
      {/* ── Drawing surface ── */}
      <div className="relative flex-1 overflow-hidden">
        <svg
          ref={svgRef}
          className="absolute inset-0 w-full h-full"
          style={{
            touchAction: "none",
            cursor: "crosshair",
            background: bgColor,
            userSelect: "none",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        >
          {strokes.map((s) => (
            <path key={s.id} d={s.d} fill={s.color} stroke="none" />
          ))}
          {livePath && <path d={livePath} fill={strokeColor} stroke="none" />}
        </svg>

        {strokes.length === 0 && !livePath && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ color: bgColor === "#ffffff" ? "#d1d5db" : "#6b7280" }}
          >
            <p className="text-lg font-medium select-none tracking-wide">
              Draw here · or Generate ↓
            </p>
          </div>
        )}
      </div>

      {/* ── Control panel ── */}
      <aside className="flex flex-col gap-5 p-4 shrink-0 bg-white border-t border-zinc-200 md:w-64 md:border-t-0 md:border-l md:overflow-y-auto">

        {/* Generate stripes */}
        <Section label={`Generate — ${stripeCount} stripe${stripeCount !== 1 ? "s" : ""}`}>
          <input
            type="range"
            min={1}
            max={20}
            value={stripeCount}
            onChange={(e) => setStripeCount(Number(e.target.value))}
            className="w-full accent-zinc-800"
          />
          <button
            onClick={handleGenerate}
            className="
              w-full mt-1 py-2 px-3 rounded-lg text-sm font-semibold
              bg-zinc-900 text-white
              hover:bg-zinc-700 active:bg-zinc-800
              transition-colors tracking-wide
            "
          >
            ✦ Generate Stripes
          </button>
        </Section>

        <div className="border-t border-zinc-100" />

        {/* Stroke color */}
        <Section label="Stroke color">
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((c) => (
              <ColorSwatch
                key={c}
                color={c}
                selected={strokeColor === c}
                onClick={() => setStrokeColor(c)}
              />
            ))}
            <label
              className="relative w-7 h-7 rounded-full overflow-hidden border-2 border-zinc-300 cursor-pointer flex-shrink-0"
              title="Custom color"
            >
              <span className="sr-only">Custom color</span>
              <span
                className="absolute inset-0 rounded-full"
                style={{
                  background:
                    "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)",
                }}
              />
              <input
                type="color"
                value={strokeColor}
                onChange={(e) => setStrokeColor(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
            </label>
          </div>
        </Section>



        {/* Background */}
        <Section label="Background">
          <label className="flex items-center gap-3 cursor-pointer w-fit">
            <span
              className="w-7 h-7 rounded-full border border-zinc-300 flex-shrink-0 block"
              style={{ background: bgColor }}
            />
            <span className="text-sm text-zinc-500 font-mono">{bgColor}</span>
            <input
              type="color"
              value={bgColor}
              onChange={(e) => setBgColor(e.target.value)}
              className="sr-only"
            />
          </label>
        </Section>

        {/* Width */}
        <Section label={`Width — ${strokeWidth}px`}>
          <input
            type="range"
            min={4}
            max={80}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            className="w-full accent-zinc-800"
          />
        </Section>

        {/* Thickness mode */}
        <Section label="Thickness">
          <div className="flex rounded-lg border border-zinc-200 overflow-hidden">
            {(["uniform", "variable"] as ThicknessMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setThicknessMode(m)}
                className={`
                  flex-1 py-1.5 text-sm font-medium capitalize transition-colors
                  ${thicknessMode === m
                    ? "bg-zinc-900 text-white"
                    : "bg-white text-zinc-500 hover:bg-zinc-50"}
                `}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-400 leading-snug">
            {thicknessMode === "uniform"
              ? "Constant width — ribbon / brand style"
              : "Width varies with drawing speed"}
          </p>
        </Section>

        {/* Smoothing */}
        <Section label={`Smoothing — ${Math.round(smoothing * 100)}%`}>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(smoothing * 100)}
            onChange={(e) => setSmoothing(Number(e.target.value) / 100)}
            className="w-full accent-zinc-800"
          />
        </Section>

        {/* History */}
        <Section label="History">
          <div className="flex gap-2">
            <ToolButton onClick={undo} disabled={!canUndo} title="Undo">
              ↩ Undo
            </ToolButton>
            <ToolButton onClick={redo} disabled={!canRedo} title="Redo">
              ↪ Redo
            </ToolButton>
          </div>
          <ToolButton
            onClick={clear}
            disabled={strokes.length === 0}
            className="w-full mt-2"
            title="Clear canvas"
          >
            🗑 Clear
          </ToolButton>
        </Section>

        {/* Export */}
        <Section label="Export">
          <div className="flex flex-col gap-2">
            <ToolButton
              onClick={handleExportSVG}
              disabled={strokes.length === 0}
              className="w-full"
            >
              ↓ SVG
            </ToolButton>
            <ToolButton
              onClick={handleExportPNG}
              disabled={strokes.length === 0}
              className="w-full"
            >
              ↓ PNG (2×)
            </ToolButton>
          </div>
        </Section>

        <p className="text-xs text-zinc-400 mt-auto text-center">
          {strokes.length} stroke{strokes.length !== 1 ? "s" : ""}
        </p>
      </aside>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
        {label}
      </span>
      {children}
    </div>
  );
}

function ColorSwatch({
  color,
  selected,
  onClick,
}: {
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={color}
      className="w-7 h-7 rounded-full flex-shrink-0 transition-transform hover:scale-110 focus:outline-none"
      style={{
        background: color,
        boxShadow: selected
          ? `0 0 0 2px white, 0 0 0 4px ${color}`
          : "0 0 0 1px rgba(0,0,0,0.12)",
      }}
    />
  );
}

function ToolButton({
  children,
  onClick,
  disabled,
  className = "",
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`
        flex-1 py-1.5 px-3 rounded-lg text-sm font-medium
        border border-zinc-200 bg-white text-zinc-700
        hover:bg-zinc-50 active:bg-zinc-100
        disabled:opacity-40 disabled:cursor-not-allowed
        transition-colors ${className}
      `}
    >
      {children}
    </button>
  );
}
