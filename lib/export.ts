export interface ExportStroke {
  d: string; // SVG path data
  color: string;
  fill: string; // perfect-freehand paths are filled, not stroked
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
  const paths = strokes
    .map(
      (s) =>
        `  <path d="${s.d}" fill="${s.color}" stroke="none" />`
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
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
