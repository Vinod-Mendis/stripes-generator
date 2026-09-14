export interface ExportStroke {
  id: string;
  d: string; // SVG path data
  color: string;
  fill: string; // perfect-freehand paths are filled, not stroked
  isFading?: boolean;
  fadeColor?: string;
}

/**
 * Build a minimal, clean SVG string from a list of finalized strokes.
 * Each stroke is a single <path> filled with its color.
 * Background is a <rect>.
 */
export function buildSVGString(
  strokes: ExportStroke[],
  bg: string,
  width: number,
  height: number
): string {
  const defs = strokes
    .filter((s) => s.isFading)
    .map((s) => {
      const isTransparent = s.fadeColor === "transparent";
      return `    <linearGradient id="grad-${s.id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stopColor="${s.color}" />
      <stop offset="100%" stopColor="${isTransparent ? s.color : s.fadeColor}" stopOpacity="${isTransparent ? 0 : 1}" />
    </linearGradient>`;
    })
    .join("\n");

  const defsStr = defs ? `\n  <defs>\n${defs}\n  </defs>` : "";

  const paths = strokes
    .map((s) => {
      const fill = s.isFading ? `url(#grad-${s.id})` : s.color;
      return `  <path d="${s.d}" fill="${fill}" stroke="none" />`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defsStr}
  <rect width="${width}" height="${height}" fill="${bg}" />
${paths}
</svg>`;
}

/** Trigger a file download from a string blob. */
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Download the canvas as a clean SVG file. */
export function downloadSVG(
  strokes: ExportStroke[],
  bg: string,
  width: number,
  height: number
) {
  const svg = buildSVGString(strokes, bg, width, height);
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  triggerDownload(blob, "squiggle-studio.svg");
}

/**
 * Rasterize the live SVG element to a PNG at `scale`× resolution (default 2×
 * for retina / high-DPI displays).
 */
export function downloadPNG(svgEl: SVGSVGElement, scale = 2) {
  const { width, height } = svgEl.getBoundingClientRect();
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  // Serialize the SVG including current dimensions
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  const svgString = new XMLSerializer().serializeToString(clone);

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) triggerDownload(blob, "squiggle-studio.png");
    }, "image/png");
  };
  img.src =
    "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
}
