"use client";

import { useEffect, useRef } from "react";
import { Chart, registerables } from "chart.js";
import { chartData, type SheetChart } from "@/lib/sheet-charts";
import { useResolvedTheme } from "@/lib/use-theme";

Chart.register(...registerables);

// Calm colours that read on light and dark backgrounds.
const PALETTE = ["#3b82f6", "#f97316", "#22c55e", "#a855f7", "#ef4444", "#14b8a6", "#eab308", "#ec4899", "#64748b", "#84cc16"];

// One chart drawn from the table's current data (Chart.js, MIT).
export default function SheetChartView({ chart, sheets }: { chart: SheetChart; sheets: Record<string, unknown>[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const instance = useRef<Chart | null>(null);
  const theme = useResolvedTheme();
  const data = chartData(sheets as never, chart);

  useEffect(() => {
    if (!canvas.current || !data) return;
    const round = chart.type === "pie" || chart.type === "doughnut";
    const text = theme === "dark" ? "#e5e7eb" : "#374151";
    const grid = theme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)";
    const datasets = data.datasets.map((set, i) => {
      const color = PALETTE[i % PALETTE.length];
      return {
        label: set.label,
        data: chart.type === "scatter" ? set.data.map((y, j) => ({ x: Number(data.labels[j]) || j + 1, y })) : set.data,
        backgroundColor: round ? data.labels.map((_, j) => PALETTE[j % PALETTE.length]) : chart.type === "area" ? `${color}55` : color,
        borderColor: round ? (theme === "dark" ? "#111827" : "#ffffff") : color,
        fill: chart.type === "area",
        tension: 0.25,
      };
    });
    const config = {
      type: chart.type === "area" ? "line" : chart.type === "horizontalBar" ? "bar" : chart.type,
      data: { labels: data.labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false as const,
        indexAxis: chart.type === "horizontalBar" ? ("y" as const) : ("x" as const),
        plugins: { legend: { labels: { color: text } }, title: { display: Boolean(chart.title), text: chart.title, color: text } },
        scales: round ? {} : { x: { ticks: { color: text }, grid: { color: grid } }, y: { ticks: { color: text }, grid: { color: grid } } },
      },
    };
    if (instance.current) instance.current.destroy();
    instance.current = new Chart(canvas.current, config as never);
    return () => {
      instance.current?.destroy();
      instance.current = null;
    };
  }, [chart, data && JSON.stringify(data), theme]); // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={canvas} data-chart-canvas={chart.id} />;
}
