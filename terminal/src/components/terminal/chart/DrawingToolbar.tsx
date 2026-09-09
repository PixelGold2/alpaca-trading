"use client";

import type { DrawStyle } from "@/lib/charting/drawing-primitives";

export type DrawingTool =
  | "cursor"
  | "trendline"
  | "hline"
  | "rectangle"
  | "ellipse"
  | "fib"
  | "fibext"
  | "measure"
  | "text";
export type MagnetMode = "off" | "weak" | "strong";

const TOOLS: { value: DrawingTool; label: string; icon: string }[] = [
  { value: "cursor", label: "Cursor", icon: "↖" },
  { value: "trendline", label: "Trend line", icon: "╱" },
  { value: "hline", label: "Horizontal line", icon: "—" },
  { value: "rectangle", label: "Rectangle", icon: "▭" },
  { value: "ellipse", label: "Ellipse", icon: "◯" },
  { value: "fib", label: "Fibonacci retracement", icon: "Fib" },
  { value: "fibext", label: "Fibonacci extension", icon: "Fib+" },
  { value: "measure", label: "Measure (price range)", icon: "↔" },
  { value: "text", label: "Text label", icon: "T" },
];

const MAGNET_OPTIONS: { value: MagnetMode; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "weak", label: "Weak" },
  { value: "strong", label: "Strong" },
];

const LINE_WIDTHS = [1, 2, 3, 4] as const;
const LINE_STYLES: { value: DrawStyle["lineStyle"]; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

export interface DrawingItem {
  id: string;
  label: string;
}

export function DrawingToolbar({
  activeTool,
  onSelectTool,
  drawings,
  onDelete,
  onClearAll,
  magnetMode,
  onChangeMagnetMode,
  style,
  onChangeStyle,
}: {
  activeTool: DrawingTool;
  onSelectTool: (tool: DrawingTool) => void;
  drawings: DrawingItem[];
  onDelete: (id: string) => void;
  onClearAll: () => void;
  magnetMode: MagnetMode;
  onChangeMagnetMode: (mode: MagnetMode) => void;
  style: DrawStyle;
  onChangeStyle: (style: DrawStyle) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-wrap items-center gap-1 rounded-md border border-border p-0.5">
        {TOOLS.map((tool) => (
          <button
            key={tool.value}
            title={tool.label}
            onClick={() => onSelectTool(tool.value)}
            className={`flex h-7 min-w-7 items-center justify-center rounded px-1 text-[11px] ${
              activeTool === tool.value
                ? "bg-accent text-white"
                : "text-text-secondary hover:bg-bg-hover"
            }`}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5" title="Style applied to the next drawing you create">
        <span className="text-[10px] uppercase tracking-wide text-text-muted">Style</span>
        <input
          type="color"
          value={style.color}
          onChange={(e) => onChangeStyle({ ...style, color: e.target.value })}
          className="h-6 w-6 cursor-pointer rounded border border-border bg-transparent p-0"
          title="Color"
        />
        <select
          value={style.lineWidth}
          onChange={(e) => onChangeStyle({ ...style, lineWidth: Number(e.target.value) as DrawStyle["lineWidth"] })}
          className="rounded-md border border-border bg-bg-panel-raised px-1.5 py-1 text-[11px] text-text-primary outline-none focus:border-accent"
          title="Line width"
        >
          {LINE_WIDTHS.map((w) => (
            <option key={w} value={w}>
              {w}px
            </option>
          ))}
        </select>
        <select
          value={style.lineStyle}
          onChange={(e) => onChangeStyle({ ...style, lineStyle: e.target.value as DrawStyle["lineStyle"] })}
          className="rounded-md border border-border bg-bg-panel-raised px-1.5 py-1 text-[11px] text-text-primary outline-none focus:border-accent"
          title="Line style"
        >
          {LINE_STYLES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-text-muted">Magnet</span>
        <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
          {MAGNET_OPTIONS.map((option) => (
            <button
              key={option.value}
              title={`Magnet: ${option.label}`}
              onClick={() => onChangeMagnetMode(option.value)}
              className={`rounded px-2 py-0.5 text-[11px] ${
                magnetMode === option.value
                  ? "bg-accent text-white"
                  : "text-text-secondary hover:bg-bg-hover"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {drawings.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {drawings.map((d) => (
            <span
              key={d.id}
              className="flex items-center gap-1 rounded border border-border bg-bg-panel-raised px-1.5 py-0.5 text-[10px] text-text-secondary"
            >
              {d.label}
              <button
                onClick={() => onDelete(d.id)}
                className="text-text-muted hover:text-negative"
                title="Delete"
              >
                ×
              </button>
            </span>
          ))}
          <button onClick={onClearAll} className="text-[10px] text-text-muted hover:text-negative hover:underline">
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
