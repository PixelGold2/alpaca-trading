import type {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts";

export interface DrawPoint {
  time: Time;
  price: number;
}

export type DrawLineStyle = "solid" | "dashed" | "dotted";

/** Per-drawing customization — every manual tool (trend line, Fibonacci, etc.) carries one of these. */
export interface DrawStyle {
  color: string;
  lineWidth: 1 | 2 | 3 | 4;
  lineStyle: DrawLineStyle;
}

export const DEFAULT_DRAW_STYLE: DrawStyle = { color: "#3b82f6", lineWidth: 2, lineStyle: "solid" };

/** Canvas dash pattern for a DrawStyle — scales with lineWidth so thicker dashed/dotted lines don't look too fine. */
function applyLineDash(context: CanvasRenderingContext2D, style: DrawStyle) {
  if (style.lineStyle === "dashed") context.setLineDash([style.lineWidth * 3, style.lineWidth * 2]);
  else if (style.lineStyle === "dotted") context.setLineDash([style.lineWidth, style.lineWidth * 1.5]);
  else context.setLineDash([]);
}

/**
 * Shared attach/detach/paneViews boilerplate for the primitives library's
 * ISeriesPrimitive contract (see lightweight-charts' typings.d.ts). Each
 * subclass only implements draw(), given the pixel-space points it needs —
 * time/price -> pixel conversion happens fresh on every render via the
 * chart/series refs captured in attached(), so drawings stay anchored
 * correctly across pan/zoom without any coordinate math in the caller.
 */
abstract class BaseDrawingPrimitive implements ISeriesPrimitive<Time> {
  protected chart: IChartApi | null = null;
  protected series: ISeriesApi<SeriesType, Time> | null = null;
  private requestUpdate: (() => void) | null = null;

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  updateAllViews(): void {}

  paneViews(): readonly IPrimitivePaneView[] {
    return [
      {
        renderer: (): IPrimitivePaneRenderer | null => {
          if (!this.chart || !this.series) return null;
          return { draw: (target) => this.draw(target, this.chart!, this.series!) };
        },
      },
    ];
  }

  /** Call after mutating points (e.g. live preview while placing) to force a repaint. */
  refresh(): void {
    this.requestUpdate?.();
  }

  protected abstract draw(
    target: Parameters<IPrimitivePaneRenderer["draw"]>[0],
    chart: IChartApi,
    series: ISeriesApi<SeriesType, Time>,
  ): void;

  protected toPixel(chart: IChartApi, series: ISeriesApi<SeriesType, Time>, point: DrawPoint) {
    const x = chart.timeScale().timeToCoordinate(point.time);
    const y = series.priceToCoordinate(point.price);
    if (x === null || y === null) return null;
    return { x, y };
  }
}

export class TrendLinePrimitive extends BaseDrawingPrimitive {
  constructor(
    public p1: DrawPoint,
    public p2: DrawPoint,
    private style: DrawStyle = DEFAULT_DRAW_STYLE,
  ) {
    super();
  }

  protected draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0], chart: IChartApi, series: ISeriesApi<SeriesType, Time>) {
    const a = this.toPixel(chart, series, this.p1);
    const b = this.toPixel(chart, series, this.p2);
    if (!a || !b) return;
    target.useMediaCoordinateSpace(({ context }) => {
      context.strokeStyle = this.style.color;
      context.lineWidth = this.style.lineWidth;
      applyLineDash(context, this.style);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
      context.setLineDash([]);
    });
  }
}

export class HorizontalLinePrimitive extends BaseDrawingPrimitive {
  constructor(
    public price: number,
    private style: DrawStyle = DEFAULT_DRAW_STYLE,
  ) {
    super();
  }

  protected draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0], chart: IChartApi, series: ISeriesApi<SeriesType, Time>) {
    const y = series.priceToCoordinate(this.price);
    if (y === null) return;
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      context.strokeStyle = this.style.color;
      context.lineWidth = this.style.lineWidth;
      applyLineDash(context, this.style);
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(mediaSize.width, y);
      context.stroke();
      context.setLineDash([]);

      const label = this.price.toFixed(2);
      context.font = "11px sans-serif";
      const textWidth = context.measureText(label).width;
      context.fillStyle = this.style.color;
      context.fillRect(mediaSize.width - textWidth - 8, y - 8, textWidth + 8, 16);
      context.fillStyle = "#0a0d12";
      context.fillText(label, mediaSize.width - textWidth - 4, y + 4);
    });
  }
}

export class RectanglePrimitive extends BaseDrawingPrimitive {
  constructor(
    public p1: DrawPoint,
    public p2: DrawPoint,
    private style: DrawStyle = DEFAULT_DRAW_STYLE,
  ) {
    super();
  }

  protected draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0], chart: IChartApi, series: ISeriesApi<SeriesType, Time>) {
    const a = this.toPixel(chart, series, this.p1);
    const b = this.toPixel(chart, series, this.p2);
    if (!a || !b) return;
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const width = Math.abs(b.x - a.x);
    const height = Math.abs(b.y - a.y);
    target.useMediaCoordinateSpace(({ context }) => {
      context.fillStyle = `${this.style.color}26`; // ~15% opacity
      context.strokeStyle = this.style.color;
      context.lineWidth = this.style.lineWidth;
      applyLineDash(context, this.style);
      context.fillRect(x, y, width, height);
      context.strokeRect(x, y, width, height);
      context.setLineDash([]);
    });
  }
}

export class EllipsePrimitive extends BaseDrawingPrimitive {
  constructor(
    public p1: DrawPoint,
    public p2: DrawPoint,
    private style: DrawStyle = DEFAULT_DRAW_STYLE,
  ) {
    super();
  }

  protected draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0], chart: IChartApi, series: ISeriesApi<SeriesType, Time>) {
    const a = this.toPixel(chart, series, this.p1);
    const b = this.toPixel(chart, series, this.p2);
    if (!a || !b) return;
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const rx = Math.abs(b.x - a.x) / 2;
    const ry = Math.abs(b.y - a.y) / 2;
    target.useMediaCoordinateSpace(({ context }) => {
      context.fillStyle = `${this.style.color}26`;
      context.strokeStyle = this.style.color;
      context.lineWidth = this.style.lineWidth;
      applyLineDash(context, this.style);
      context.beginPath();
      context.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.setLineDash([]);
    });
  }
}

const FIB_RETRACEMENT_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_EXTENSION_LEVELS = [0, 0.618, 1, 1.272, 1.618, 2, 2.618];

/**
 * Standard 2-point Fibonacci retracement: level 0 sits at p2 (the more recent
 * point), level 1 at p1 — the conventional "retracement back from the move"
 * reading. Lines span from the two anchor points out to the chart's right
 * edge, same convention as ZonePrimitive, so levels stay readable while
 * panning forward.
 */
export class FibonacciPrimitive extends BaseDrawingPrimitive {
  constructor(
    public p1: DrawPoint,
    public p2: DrawPoint,
    private style: DrawStyle = DEFAULT_DRAW_STYLE,
    private extension = false,
  ) {
    super();
  }

  protected draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0], chart: IChartApi, series: ISeriesApi<SeriesType, Time>) {
    const a = this.toPixel(chart, series, this.p1);
    const b = this.toPixel(chart, series, this.p2);
    if (!a || !b) return;
    const diff = this.p2.price - this.p1.price;
    const levels = this.extension ? FIB_EXTENSION_LEVELS : FIB_RETRACEMENT_LEVELS;
    const x1 = Math.min(a.x, b.x);

    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      context.font = "10px sans-serif";
      for (const level of levels) {
        const price = this.p2.price - diff * level;
        const y = series.priceToCoordinate(price);
        if (y === null) continue;
        context.strokeStyle = this.style.color;
        context.lineWidth = this.style.lineWidth;
        applyLineDash(context, this.style);
        context.globalAlpha = level === 0 || level === 1 ? 1 : 0.6;
        context.beginPath();
        context.moveTo(x1, y);
        context.lineTo(mediaSize.width, y);
        context.stroke();
        context.globalAlpha = 1;
        context.setLineDash([]);

        const label = `${(level * 100).toFixed(1)}% — ${price.toFixed(2)}`;
        context.fillStyle = this.style.color;
        context.fillText(label, x1 + 4, y - 3);
      }
    });
  }
}

/**
 * TradingView-style "measure" tool: a shaded box between the two anchor
 * points plus a label showing the price delta, percent change, and bar
 * count — direction-colored (green for a gain from p1 to p2, red for a
 * loss) independent of the drawing's own chosen color, since that's the
 * whole point of a measure readout.
 */
export class MeasurePrimitive extends BaseDrawingPrimitive {
  constructor(
    public p1: DrawPoint,
    public p2: DrawPoint,
    private style: DrawStyle = DEFAULT_DRAW_STYLE,
  ) {
    super();
  }

  protected draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0], chart: IChartApi, series: ISeriesApi<SeriesType, Time>) {
    const a = this.toPixel(chart, series, this.p1);
    const b = this.toPixel(chart, series, this.p2);
    if (!a || !b) return;
    const priceDiff = this.p2.price - this.p1.price;
    const percent = this.p1.price !== 0 ? (priceDiff / this.p1.price) * 100 : 0;
    const color = priceDiff >= 0 ? "#16c784" : "#ef4444";
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const width = Math.abs(b.x - a.x);
    const height = Math.abs(b.y - a.y);

    target.useMediaCoordinateSpace(({ context }) => {
      context.fillStyle = `${color}22`;
      context.strokeStyle = color;
      context.lineWidth = this.style.lineWidth;
      applyLineDash(context, this.style);
      context.fillRect(x, y, width, height);
      context.strokeRect(x, y, width, height);
      context.setLineDash([]);

      const label = `${priceDiff >= 0 ? "+" : ""}${priceDiff.toFixed(2)} (${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%)`;
      context.font = "11px sans-serif";
      const textWidth = context.measureText(label).width;
      const labelX = x + width / 2 - textWidth / 2;
      const labelY = b.y >= a.y ? y - 6 : y + height + 14;
      context.fillStyle = color;
      context.fillRect(labelX - 4, labelY - 12, textWidth + 8, 16);
      context.fillStyle = "#0a0d12";
      context.fillText(label, labelX, labelY);
    });
  }
}

/** A single free-text label anchored to one time/price point. */
export class TextPrimitive extends BaseDrawingPrimitive {
  constructor(
    public point: DrawPoint,
    public text: string,
    private style: DrawStyle = DEFAULT_DRAW_STYLE,
  ) {
    super();
  }

  protected draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0], chart: IChartApi, series: ISeriesApi<SeriesType, Time>) {
    const p = this.toPixel(chart, series, this.point);
    if (!p) return;
    target.useMediaCoordinateSpace(({ context }) => {
      context.font = "600 12px sans-serif";
      context.fillStyle = this.style.color;
      context.fillText(this.text, p.x + 6, p.y - 6);
      context.beginPath();
      context.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      context.fill();
    });
  }
}

/**
 * A rectangle from a fixed start time extended to whatever the chart's
 * current right-edge is — the standard convention for FVG/order-block/
 * liquidity zones (they extend forward until "filled," which this
 * approximates by just always reaching the visible edge; a later phase could
 * clip it once price trades back through the zone). Right edge is
 * recomputed every draw, so it tracks pan/zoom automatically.
 */
export class ZonePrimitive extends BaseDrawingPrimitive {
  constructor(
    public startTime: Time,
    public topPrice: number,
    public bottomPrice: number,
    private color: string,
    private label: string,
  ) {
    super();
  }

  protected draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0], chart: IChartApi, series: ISeriesApi<SeriesType, Time>) {
    const x1 = chart.timeScale().timeToCoordinate(this.startTime);
    const yTop = series.priceToCoordinate(this.topPrice);
    const yBottom = series.priceToCoordinate(this.bottomPrice);
    if (x1 === null || yTop === null || yBottom === null) return;

    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      const x2 = mediaSize.width;
      const y = Math.min(yTop, yBottom);
      const height = Math.abs(yBottom - yTop);
      context.fillStyle = `${this.color}22`; // ~13% opacity
      context.strokeStyle = this.color;
      context.lineWidth = 1;
      context.fillRect(x1, y, x2 - x1, height);
      context.strokeRect(x1, y, x2 - x1, height);

      context.font = "10px sans-serif";
      context.fillStyle = this.color;
      context.fillText(this.label, x1 + 4, y + 11);
    });
  }
}

/**
 * A connected polyline through 3+ time/price points, with a label at the
 * first vertex — used to draw detected chart-pattern shapes (double top/
 * bottom, head-and-shoulders) directly through their defining swing points,
 * rather than a rectangle/zone.
 */
export class PatternLinePrimitive extends BaseDrawingPrimitive {
  constructor(
    public points: DrawPoint[],
    private color: string,
    private label: string,
  ) {
    super();
  }

  protected draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0], chart: IChartApi, series: ISeriesApi<SeriesType, Time>) {
    const pixelPoints: NonNullable<ReturnType<typeof this.toPixel>>[] = [];
    for (const point of this.points) {
      const pixel = this.toPixel(chart, series, point);
      if (pixel) pixelPoints.push(pixel);
    }
    if (pixelPoints.length < 2) return;

    target.useMediaCoordinateSpace(({ context }) => {
      context.strokeStyle = this.color;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(pixelPoints[0].x, pixelPoints[0].y);
      for (let i = 1; i < pixelPoints.length; i++) context.lineTo(pixelPoints[i].x, pixelPoints[i].y);
      context.stroke();

      for (const p of pixelPoints) {
        context.beginPath();
        context.arc(p.x, p.y, 3, 0, Math.PI * 2);
        context.fillStyle = this.color;
        context.fill();
      }

      context.font = "10px sans-serif";
      context.fillStyle = this.color;
      context.fillText(this.label, pixelPoints[0].x + 4, pixelPoints[0].y - 6);
    });
  }
}

export type DrawingPrimitive =
  | TrendLinePrimitive
  | HorizontalLinePrimitive
  | RectanglePrimitive
  | EllipsePrimitive
  | FibonacciPrimitive
  | MeasurePrimitive
  | TextPrimitive
  | ZonePrimitive
  | PatternLinePrimitive;
