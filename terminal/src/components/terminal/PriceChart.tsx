"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  BarSeries,
  HistogramSeries,
  PriceScaleMode,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Bar, BarTimeframe, ProviderMeta } from "@/lib/market-data/types";
import {
  calculateSMA,
  calculateEMA,
  calculateWMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
  calculateVWAP,
  calculatePSAR,
  calculateStochastic,
  calculateCCI,
  calculateADX,
  calculateWilliamsR,
  calculateOBV,
  calculateROC,
} from "@/lib/indicators/calculate";
import { DEFAULT_INDICATORS, type Indicators } from "@/lib/indicators/config";
import { DataStatusBadge } from "@/components/terminal/DataStatusBadge";
import { IndicatorMenu } from "@/components/terminal/chart/IndicatorMenu";
import {
  DrawingToolbar,
  type DrawingTool,
  type DrawingItem,
  type MagnetMode,
} from "@/components/terminal/chart/DrawingToolbar";
import { AIAnalysisPanel } from "@/components/terminal/chart/AIAnalysisPanel";
import { ChartSettingsMenu } from "@/components/terminal/chart/ChartSettingsMenu";
import {
  TrendLinePrimitive,
  HorizontalLinePrimitive,
  RectanglePrimitive,
  EllipsePrimitive,
  FibonacciPrimitive,
  MeasurePrimitive,
  TextPrimitive,
  ZonePrimitive,
  PatternLinePrimitive,
  DEFAULT_DRAW_STYLE,
  type DrawPoint,
  type DrawStyle,
  type DrawingPrimitive,
} from "@/lib/charting/drawing-primitives";
import { loadChartSettings, saveChartSettings, type ChartSettings } from "@/lib/preferences/chart-settings";
import type { Zone, ZoneKind } from "@/lib/patterns/types";
import type { ChartPatternMatch } from "@/lib/patterns/chart-patterns";
import { averageRange } from "@/lib/patterns/utils";

type ChartType = "candlestick" | "line" | "area" | "bar";
type Timeframe = BarTimeframe;

type Drawing =
  | { id: string; source: "manual"; type: Exclude<DrawingTool, "cursor">; points: DrawPoint[]; style: DrawStyle; text?: string }
  | { id: string; source: "ai"; zone: Zone }
  | { id: string; source: "ai"; pattern: ChartPatternMatch };

const PATTERN_COLOR = "#ec4899";

const ZONE_COLORS: Record<ZoneKind, string> = {
  "fvg-bullish": "#16c784",
  "fvg-bearish": "#ef4444",
  "orderblock-bullish": "#3b82f6",
  "orderblock-bearish": "#f59e0b",
  "liquidity-high": "#a78bfa",
  "liquidity-low": "#38bdf8",
};

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: "1Min", label: "1m" },
  { value: "5Min", label: "5m" },
  { value: "15Min", label: "15m" },
  { value: "30Min", label: "30m" },
  { value: "1Hour", label: "1H" },
  { value: "4Hour", label: "4H" },
  { value: "1Day", label: "1D" },
  { value: "1Week", label: "1W" },
  { value: "1Month", label: "1M" },
];

const COLORS = {
  border: "#232a37",
  text: "#8b93a3",
  positive: "#16c784",
  negative: "#ef4444",
  accent: "#3b82f6",
  panel: "#10141b",
  overlay1: "#f59e0b",
  overlay2: "#a78bfa",
  overlay3: "#60a5fa",
  overlay4: "#eab308",
  overlay5: "#38bdf8",
};

function defaultStartFor(timeframe: Timeframe): string {
  const now = new Date();
  const days: Record<Timeframe, number> = {
    "1Min": 5,
    "5Min": 10,
    "15Min": 20,
    "30Min": 40,
    "1Hour": 60,
    "4Hour": 180,
    "1Day": 730,
    "1Week": 1825,
    "1Month": 3650,
  };
  now.setDate(now.getDate() - days[timeframe]);
  return now.toISOString();
}

function toUnixTime(iso: string): UTCTimestamp {
  return Math.floor(new Date(iso).getTime() / 1000) as UTCTimestamp;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function buildPrimitive(drawing: Drawing): DrawingPrimitive {
  if (drawing.source === "ai") {
    if ("zone" in drawing) {
      const { zone } = drawing;
      return new ZonePrimitive(zone.startTime, zone.topPrice, zone.bottomPrice, ZONE_COLORS[zone.kind], zone.label);
    }
    return new PatternLinePrimitive(drawing.pattern.points, PATTERN_COLOR, drawing.pattern.label);
  }
  const { style, points } = drawing;
  switch (drawing.type) {
    case "trendline":
      return new TrendLinePrimitive(points[0], points[1], style);
    case "hline":
      return new HorizontalLinePrimitive(points[0].price, style);
    case "rectangle":
      return new RectanglePrimitive(points[0], points[1], style);
    case "ellipse":
      return new EllipsePrimitive(points[0], points[1], style);
    case "fib":
      return new FibonacciPrimitive(points[0], points[1], style, false);
    case "fibext":
      return new FibonacciPrimitive(points[0], points[1], style, true);
    case "measure":
      return new MeasurePrimitive(points[0], points[1], style);
    case "text":
      return new TextPrimitive(points[0], drawing.text ?? "", style);
  }
}

function drawingLabel(drawing: Drawing): string {
  if (drawing.source === "ai") {
    if ("zone" in drawing) return `${drawing.zone.label} (${drawing.zone.kind.split("-")[1]})`;
    return drawing.pattern.label;
  }
  switch (drawing.type) {
    case "hline":
      return `H-line @ ${drawing.points[0].price.toFixed(2)}`;
    case "trendline":
      return "Trend line";
    case "rectangle":
      return "Rectangle";
    case "ellipse":
      return "Ellipse";
    case "fib":
      return "Fibonacci retracement";
    case "fibext":
      return "Fibonacci extension";
    case "measure":
      return "Measure";
    case "text":
      return `Text: ${(drawing.text ?? "").slice(0, 20)}`;
  }
}

/**
 * Snaps a raw clicked price to the nearest candle's O/H/L/C when magnet mode
 * is on — "strong" always snaps to the closest of those four values, "weak"
 * only snaps if the raw click already landed close to one (within a fraction
 * of the loaded series' typical candle range, so — like the pattern-
 * credibility thresholds — it scales with whatever timeframe is loaded).
 */
function snapPrice(rawPrice: number, time: Time, bars: Bar[], mode: MagnetMode): number {
  if (mode === "off" || bars.length === 0) return rawPrice;

  const targetSec = time as number;
  let nearest = bars[0];
  let nearestDiff = Infinity;
  for (const bar of bars) {
    const diff = Math.abs(toUnixTime(bar.time) - targetSec);
    if (diff < nearestDiff) {
      nearestDiff = diff;
      nearest = bar;
    }
  }

  const candidates = [nearest.open, nearest.high, nearest.low, nearest.close];
  let closest = candidates[0];
  let closestDist = Math.abs(closest - rawPrice);
  for (const candidate of candidates) {
    const dist = Math.abs(candidate - rawPrice);
    if (dist < closestDist) {
      closestDist = dist;
      closest = candidate;
    }
  }

  if (mode === "strong") return closest;
  const threshold = averageRange(bars) * 0.25;
  return closestDist <= threshold ? closest : rawPrice;
}

export function PriceChart({
  symbol,
  initialTimeframe,
}: {
  symbol: string;
  initialTimeframe: Timeframe;
}) {
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);
  const [chartType, setChartType] = useState<ChartType>("candlestick");
  const [logScale, setLogScale] = useState(false);
  const [indicators, setIndicators] = useState<Indicators>(DEFAULT_INDICATORS);
  const [activeTool, setActiveTool] = useState<DrawingTool>("cursor");
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [magnetMode, setMagnetMode] = useState<MagnetMode>("weak");
  const [drawStyle, setDrawStyle] = useState<DrawStyle>(DEFAULT_DRAW_STYLE);
  const [chartSettings, setChartSettings] = useState<ChartSettings>(() => loadChartSettings());

  const [bars, setBars] = useState<Bar[] | null>(null);
  const [meta, setMeta] = useState<ProviderMeta | null>(null);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<SeriesType, Time> | null>(null);
  const primitivesRef = useRef<Map<string, DrawingPrimitive>>(new Map());

  // Refs kept current for the click handler (registered once, below) so it
  // never closes over stale state — same pattern as WorldMap.tsx's event handlers.
  const activeToolRef = useRef(activeTool);
  const drawingsRef = useRef(drawings);
  const barsRef = useRef(bars);
  const magnetModeRef = useRef(magnetMode);
  const drawStyleRef = useRef(drawStyle);
  // Read (not reacted to) inside the mount-once chart-creation effect and the
  // data/series-rebuild effect, so tweaking a setting doesn't need either of
  // those effects in its dependency array — a separate effect below applies
  // settings changes live via applyOptions() instead of a full rebuild.
  const chartSettingsRef = useRef(chartSettings);
  const pendingPointRef = useRef<DrawPoint | null>(null);
  useEffect(() => {
    activeToolRef.current = activeTool;
    pendingPointRef.current = null; // switching tools cancels an in-progress placement
  }, [activeTool]);
  useEffect(() => {
    drawingsRef.current = drawings;
  }, [drawings]);
  useEffect(() => {
    barsRef.current = bars;
  }, [bars]);
  useEffect(() => {
    magnetModeRef.current = magnetMode;
  }, [magnetMode]);
  useEffect(() => {
    drawStyleRef.current = drawStyle;
  }, [drawStyle]);
  useEffect(() => {
    chartSettingsRef.current = chartSettings;
    saveChartSettings(chartSettings);
  }, [chartSettings]);

  // Keep the URL shareable: /markets?symbol=NVDA&timeframe=1D
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("timeframe", timeframe);
    window.history.replaceState({}, "", url);
  }, [timeframe]);

  // Drawings are per-symbol — starting fresh on a new symbol/timeframe load
  // matches how the chart itself already fully rebuilds on those changes.
  // Reset during render (React's documented pattern for "adjusting state when
  // a prop changes") rather than in an effect, which would cause an extra
  // render pass for something that can be resolved before this one commits.
  const dataKey = `${symbol}:${timeframe}`;
  const [prevDataKey, setPrevDataKey] = useState(dataKey);
  if (dataKey !== prevDataKey) {
    setPrevDataKey(dataKey);
    setDrawings([]);
    setActiveTool("cursor");
  }

  // Fetch bars whenever symbol/timeframe changes.
  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    // This is React's own documented data-fetching pattern (the lint rule's linked
    // guide shows the identical setState-then-fetch shape) — the alternative is a
    // loading spinner that only appears after the request already resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    const params = new URLSearchParams({
      symbol,
      timeframe,
      start: defaultStartFor(timeframe),
      limit: "1000",
    });

    fetch(`/api/market-data/bars?${params}`)
      .then((res) => res.json())
      .then((result: { data: Bar[] | null; meta: ProviderMeta }) => {
        if (cancelled) return;
        setBars(result.data);
        setMeta(result.meta);
      })
      .catch(() => {
        if (cancelled) return;
        setBars(null);
        setMeta({
          provider: "alpaca",
          timestamp: new Date().toISOString(),
          status: "error",
          message: "Network error fetching bars.",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe]);

  function syncDrawingPrimitives(series: ISeriesApi<SeriesType, Time>) {
    primitivesRef.current.forEach((primitive) => series.detachPrimitive(primitive));
    primitivesRef.current.clear();
    for (const drawing of drawingsRef.current) {
      const primitive = buildPrimitive(drawing);
      series.attachPrimitive(primitive);
      primitivesRef.current.set(drawing.id, primitive);
    }
  }

  // Create the chart once on mount, and register the click handler that
  // places drawings. Uses refs (activeToolRef/pendingPointRef/mainSeriesRef)
  // rather than effect deps so this never needs to be torn down and re-bound.
  useEffect(() => {
    if (!containerRef.current) return;
    const initialSettings = chartSettingsRef.current;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: initialSettings.background },
        textColor: COLORS.text,
      },
      grid: {
        vertLines: { color: initialSettings.gridColor, visible: initialSettings.gridVisible },
        horzLines: { color: initialSettings.gridColor, visible: initialSettings.gridVisible },
      },
      crosshair: {
        mode:
          initialSettings.crosshairMode === "normal"
            ? CrosshairMode.Normal
            : initialSettings.crosshairMode === "hidden"
              ? CrosshairMode.Hidden
              : CrosshairMode.Magnet,
      },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: { borderColor: COLORS.border },
      autoSize: true,
    });
    chartRef.current = chart;

    function handleClick(param: MouseEventParams<Time>) {
      const tool = activeToolRef.current;
      const series = mainSeriesRef.current;
      if (tool === "cursor" || !series || !param.point || !param.time || param.paneIndex !== 0) return;

      const rawPrice = series.coordinateToPrice(param.point.y);
      if (rawPrice === null) return;
      const price = snapPrice(rawPrice, param.time, barsRef.current ?? [], magnetModeRef.current);
      const point: DrawPoint = { time: param.time, price };
      const style = drawStyleRef.current;

      if (tool === "hline") {
        const drawing: Drawing = { id: randomId(), source: "manual", type: "hline", points: [point], style };
        setDrawings((prev) => [...prev, drawing]);
        return;
      }

      if (tool === "text") {
        const text = window.prompt("Label text:")?.trim();
        if (!text) return;
        const drawing: Drawing = { id: randomId(), source: "manual", type: "text", points: [point], style, text };
        setDrawings((prev) => [...prev, drawing]);
        setActiveTool("cursor");
        return;
      }

      // Remaining tools (trendline/rectangle/ellipse/fib/fibext/measure) all place two points.
      if (!pendingPointRef.current) {
        pendingPointRef.current = point;
        return;
      }

      const drawing: Drawing = {
        id: randomId(),
        source: "manual",
        type: tool,
        points: [pendingPointRef.current, point],
        style,
      };
      pendingPointRef.current = null;
      setDrawings((prev) => [...prev, drawing]);
      setActiveTool("cursor");
    }

    chart.subscribeClick(handleClick);

    return () => {
      chart.unsubscribeClick(handleClick);
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
    };
  }, []);

  // Reattach drawings whenever the drawings list changes, without touching
  // the chart's series (cheap — no data rebuild needed just to add a line).
  useEffect(() => {
    const series = mainSeriesRef.current;
    if (series) syncDrawingPrimitives(series);
  }, [drawings]);

  // Chart Settings changes apply live via applyOptions() rather than the full
  // data/series rebuild below — same chart/series instances, just restyled.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      layout: { background: { color: chartSettings.background }, textColor: COLORS.text },
      grid: {
        vertLines: { color: chartSettings.gridColor, visible: chartSettings.gridVisible },
        horzLines: { color: chartSettings.gridColor, visible: chartSettings.gridVisible },
      },
      crosshair: {
        mode:
          chartSettings.crosshairMode === "normal"
            ? CrosshairMode.Normal
            : chartSettings.crosshairMode === "hidden"
              ? CrosshairMode.Hidden
              : CrosshairMode.Magnet,
      },
    });
    const series = mainSeriesRef.current;
    if (series && (chartType === "candlestick" || chartType === "bar")) {
      series.applyOptions({
        upColor: chartSettings.upColor,
        downColor: chartSettings.downColor,
        wickUpColor: chartSettings.upColor,
        wickDownColor: chartSettings.downColor,
      });
    }
  }, [chartSettings, chartType]);

  // Rebuild all series/panes whenever data or display settings change. Simpler and more
  // robust than incrementally adding/removing series — pane indices shift as panes are
  // removed, so a full rebuild avoids that whole class of bugs for a dataset this size.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !bars || bars.length === 0) return;

    // Clear existing panes beyond the main one (index 0).
    while (chart.panes().length > 1) {
      chart.removePane(chart.panes().length - 1);
    }
    chart.panes()[0].getSeries().forEach((s) => chart.removeSeries(s));

    chart.priceScale("right").applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });

    const seriesColors = chartSettingsRef.current;
    let mainSeries: ISeriesApi<"Candlestick" | "Line" | "Area" | "Bar">;
    if (chartType === "candlestick") {
      mainSeries = chart.addSeries(CandlestickSeries, {
        upColor: seriesColors.upColor,
        downColor: seriesColors.downColor,
        borderVisible: false,
        wickUpColor: seriesColors.upColor,
        wickDownColor: seriesColors.downColor,
      });
      mainSeries.setData(
        bars.map((b) => ({
          time: toUnixTime(b.time),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }))
      );
    } else if (chartType === "bar") {
      mainSeries = chart.addSeries(BarSeries, {
        upColor: seriesColors.upColor,
        downColor: seriesColors.downColor,
      });
      mainSeries.setData(
        bars.map((b) => ({
          time: toUnixTime(b.time),
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }))
      );
    } else if (chartType === "area") {
      mainSeries = chart.addSeries(AreaSeries, {
        lineColor: COLORS.accent,
        topColor: "rgba(59, 130, 246, 0.3)",
        bottomColor: "rgba(59, 130, 246, 0.0)",
      });
      mainSeries.setData(bars.map((b) => ({ time: toUnixTime(b.time), value: b.close })));
    } else {
      mainSeries = chart.addSeries(LineSeries, { color: COLORS.accent });
      mainSeries.setData(bars.map((b) => ({ time: toUnixTime(b.time), value: b.close })));
    }

    mainSeriesRef.current = mainSeries;
    syncDrawingPrimitives(mainSeries);

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volumeSeries.setData(
      bars.map((b) => ({
        time: toUnixTime(b.time),
        value: b.volume,
        color: b.close >= b.open ? "rgba(22, 199, 132, 0.5)" : "rgba(239, 68, 68, 0.5)",
      }))
    );

    // --- Overlays (drawn on the main price pane) ---
    if (indicators.sma) {
      const points = calculateSMA(bars, 20);
      const series = chart.addSeries(LineSeries, { color: COLORS.overlay1, lineWidth: 1, title: "SMA 20" });
      series.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.value })));
    }
    if (indicators.ema) {
      const points = calculateEMA(bars, 20);
      const series = chart.addSeries(LineSeries, { color: COLORS.overlay2, lineWidth: 1, title: "EMA 20" });
      series.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.value })));
    }
    if (indicators.wma) {
      const points = calculateWMA(bars, 20);
      const series = chart.addSeries(LineSeries, { color: COLORS.overlay5, lineWidth: 1, title: "WMA 20" });
      series.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.value })));
    }
    if (indicators.bb) {
      const points = calculateBollingerBands(bars, 20, 2);
      const upper = chart.addSeries(LineSeries, { color: COLORS.overlay3, lineWidth: 1 });
      const middle = chart.addSeries(LineSeries, { color: COLORS.text, lineWidth: 1 });
      const lower = chart.addSeries(LineSeries, { color: COLORS.overlay3, lineWidth: 1 });
      upper.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.upper })));
      middle.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.middle })));
      lower.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.lower })));
    }
    if (indicators.vwap) {
      const points = calculateVWAP(bars);
      const series = chart.addSeries(LineSeries, { color: COLORS.overlay4, lineWidth: 1, title: "VWAP" });
      series.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.value })));
    }
    if (indicators.psar) {
      const points = calculatePSAR(bars);
      const series = chart.addSeries(LineSeries, {
        color: COLORS.overlay2,
        lineVisible: false,
        pointMarkersVisible: true,
        title: "PSAR",
      });
      series.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.value })));
    }

    // --- Oscillators / volume indicators (own pane) ---
    if (indicators.rsi) {
      const points = calculateRSI(bars, 14);
      const pane = chart.addPane();
      const series = pane.addSeries(LineSeries, { color: COLORS.overlay1, title: "RSI 14" });
      series.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.value })));
    }
    if (indicators.macd) {
      const points = calculateMACD(bars, 12, 26, 9);
      const pane = chart.addPane();
      const macdLine = pane.addSeries(LineSeries, { color: COLORS.accent, title: "MACD" });
      const signalLine = pane.addSeries(LineSeries, { color: COLORS.overlay1, title: "Signal" });
      const histogram = pane.addSeries(HistogramSeries, { color: COLORS.text });
      macdLine.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.macd })));
      signalLine.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.signal })));
      histogram.setData(
        points.map((p) => ({
          time: toUnixTime(p.time),
          value: p.histogram,
          color: p.histogram >= 0 ? "rgba(22, 199, 132, 0.6)" : "rgba(239, 68, 68, 0.6)",
        }))
      );
    }
    if (indicators.atr) {
      const points = calculateATR(bars, 14);
      const pane = chart.addPane();
      const series = pane.addSeries(LineSeries, { color: COLORS.overlay2, title: "ATR 14" });
      series.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.value })));
    }
    if (indicators.stochastic) {
      const points = calculateStochastic(bars, 14, 3);
      const pane = chart.addPane();
      const kLine = pane.addSeries(LineSeries, { color: COLORS.accent, title: "%K" });
      const dLine = pane.addSeries(LineSeries, { color: COLORS.overlay1, title: "%D" });
      kLine.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.k })));
      dLine.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.d })));
    }
    if (indicators.cci) {
      const points = calculateCCI(bars, 20);
      const pane = chart.addPane();
      const series = pane.addSeries(LineSeries, { color: COLORS.overlay5, title: "CCI 20" });
      series.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.value })));
    }
    if (indicators.adx) {
      const points = calculateADX(bars, 14);
      const pane = chart.addPane();
      const adxLine = pane.addSeries(LineSeries, { color: COLORS.accent, title: "ADX" });
      const pdiLine = pane.addSeries(LineSeries, { color: COLORS.positive, title: "+DI" });
      const mdiLine = pane.addSeries(LineSeries, { color: COLORS.negative, title: "-DI" });
      adxLine.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.adx })));
      pdiLine.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.pdi })));
      mdiLine.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.mdi })));
    }
    if (indicators.williamsr) {
      const points = calculateWilliamsR(bars, 14);
      const pane = chart.addPane();
      const series = pane.addSeries(LineSeries, { color: COLORS.overlay4, title: "Williams %R" });
      series.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.value })));
    }
    if (indicators.obv) {
      const points = calculateOBV(bars);
      const pane = chart.addPane();
      const series = pane.addSeries(LineSeries, { color: COLORS.overlay3, title: "OBV" });
      series.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.value })));
    }
    if (indicators.roc) {
      const points = calculateROC(bars, 12);
      const pane = chart.addPane();
      const series = pane.addSeries(LineSeries, { color: COLORS.overlay2, title: "ROC 12" });
      series.setData(points.map((p) => ({ time: toUnixTime(p.time), value: p.value })));
    }

    chart.timeScale().fitContent();
  }, [bars, chartType, logScale, indicators]);

  // The manual drawing toolbar only lists/deletes manual drawings — AI zones
  // can be numerous (even after the credibility filtering in lib/patterns/*)
  // and are managed in bulk via AIAnalysisPanel's own "Clear AI markings"
  // instead, so they don't crowd out the few trend lines/rectangles someone
  // actually drew by hand.
  const manualDrawingItems: DrawingItem[] = drawings
    .filter((d): d is Extract<Drawing, { source: "manual" }> => d.source === "manual")
    .map((d) => ({ id: d.id, label: drawingLabel(d) }));
  const aiZoneCount = drawings.filter((d) => d.source === "ai").length;

  function addZones(zones: Zone[]) {
    setDrawings((prev) => [...prev, ...zones.map((zone) => ({ id: zone.id, source: "ai" as const, zone }))]);
  }

  function addPatterns(patterns: ChartPatternMatch[]) {
    setDrawings((prev) => [
      ...prev,
      ...patterns.map((pattern) => ({ id: pattern.id, source: "ai" as const, pattern })),
    ]);
  }

  function clearAiZones() {
    setDrawings((prev) => prev.filter((d) => d.source !== "ai"));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf.value)}
              className={`rounded px-2 py-1 text-[11px] ${
                timeframe === tf.value
                  ? "bg-accent text-white"
                  : "text-text-secondary hover:bg-bg-hover"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <select
          value={chartType}
          onChange={(e) => setChartType(e.target.value as ChartType)}
          className="rounded-md border border-border bg-bg-panel-raised px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
        >
          <option value="candlestick">Candlestick</option>
          <option value="line">Line</option>
          <option value="area">Area</option>
          <option value="bar">Bar (OHLC)</option>
        </select>

        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={logScale}
            onChange={(e) => setLogScale(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border-strong bg-bg-panel-raised accent-accent"
          />
          Log scale
        </label>

        <IndicatorMenu indicators={indicators} onChange={setIndicators} />
        <ChartSettingsMenu settings={chartSettings} onChange={setChartSettings} />

        {meta && <DataStatusBadge status={meta.status} />}
      </div>

      <DrawingToolbar
        activeTool={activeTool}
        onSelectTool={setActiveTool}
        drawings={manualDrawingItems}
        onDelete={(id) => setDrawings((prev) => prev.filter((d) => d.id !== id))}
        onClearAll={() => setDrawings((prev) => prev.filter((d) => d.source !== "manual"))}
        magnetMode={magnetMode}
        onChangeMagnetMode={setMagnetMode}
        style={drawStyle}
        onChangeStyle={setDrawStyle}
      />

      <div className="rounded-lg border border-border bg-bg-panel p-2">
        {loading && <div className="p-4 text-center text-xs text-text-muted">Loading…</div>}
        {!loading && meta?.status === "error" && (
          <div className="p-4 text-center text-xs text-text-muted">
            Data unavailable{meta.message ? ` — ${meta.message}` : "."}
          </div>
        )}
        <div
          ref={containerRef}
          className={`h-[600px] w-full ${loading || meta?.status === "error" ? "hidden" : ""} ${
            activeTool !== "cursor" ? "cursor-crosshair" : ""
          }`}
        />
      </div>

      <AIAnalysisPanel
        symbol={symbol}
        timeframe={timeframe}
        bars={bars}
        aiZoneCount={aiZoneCount}
        onAddZones={addZones}
        onAddPatterns={addPatterns}
        onClearAiZones={clearAiZones}
      />
    </div>
  );
}
