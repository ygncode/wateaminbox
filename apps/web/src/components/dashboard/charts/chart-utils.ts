export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartBox {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const chartBox = {
  width: 640,
  height: 220,
  left: 46,
  right: 16,
  top: 16,
  bottom: 30,
} as const;

export const plotWidth = chartBox.width - chartBox.left - chartBox.right;
export const plotHeight = chartBox.height - chartBox.top - chartBox.bottom;
export const chartBaseline = chartBox.top + plotHeight;

/** Round a chart maximum to a readable 1/2/5/10 interval. */
export function getNiceMax(values: number[]): number {
  const max = Math.max(...values, 0);
  if (max <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const niceNormalized =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;

  return niceNormalized * magnitude;
}

export function getLinePoints(
  values: number[],
  maxValue: number,
  box: ChartBox = chartBox,
): ChartPoint[] {
  const denominator = Math.max(values.length - 1, 1);
  const width = box.width - box.left - box.right;
  const height = box.height - box.top - box.bottom;

  return values.map((value, index) => ({
    x: box.left + (index / denominator) * width,
    y: box.top + height - (value / Math.max(maxValue, 1)) * height,
  }));
}

/** Catmull-Rom-to-Bezier interpolation for a calm, dashboard-friendly curve. */
export function getSmoothPath(points: ChartPoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const current = points[index];
    const next = points[index + 1];
    const following = points[index + 2] ?? next;
    const controlOneX = current.x + (next.x - previous.x) / 6;
    const controlOneY = current.y + (next.y - previous.y) / 6;
    const controlTwoX = next.x - (following.x - current.x) / 6;
    const controlTwoY = next.y - (following.y - current.y) / 6;

    path += ` C ${controlOneX} ${controlOneY}, ${controlTwoX} ${controlTwoY}, ${next.x} ${next.y}`;
  }

  return path;
}

export function getAreaPath(
  points: ChartPoint[],
  baseline = chartBaseline,
): string {
  if (points.length === 0) return "";
  const line = getSmoothPath(points);
  const first = points[0];
  const last = points[points.length - 1];

  return `${line} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
}

export function getGridTicks(maxValue: number, count = 4): number[] {
  return Array.from(
    { length: count + 1 },
    (_, index) => (maxValue / count) * (count - index),
  );
}

export function formatAxisNumber(value: number): string {
  return Intl.NumberFormat("en", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10 ? 0 : 1,
  }).format(value);
}

export function getLabelIndexes(length: number): Set<number> {
  if (length <= 2) return new Set(Array.from({ length }, (_, index) => index));
  return new Set([0, Math.floor((length - 1) / 2), length - 1]);
}
