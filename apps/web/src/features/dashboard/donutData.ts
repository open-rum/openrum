import { countryLabel, deviceLabel } from "@/features/filters/dimensionLabels";
import type { PlotData } from "./adapters";

export function donutData(data: PlotData) {
  const key = data.series[0]?.key;
  const dimension = data.distribution?.dimension;
  const rows = data.rows
    .flatMap((row, index) => {
      const value = key ? row[key] : null;
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return [];
      const name = String(row.label || "未知");
      return [
        {
          id: `group-${index}`,
          label:
            dimension === "country"
              ? countryLabel(name)
              : dimension === "device"
                ? deviceLabel(name)
                : name,
          value,
        },
      ];
    })
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const grouped = rows.length > 6;
  const visible = grouped
    ? [
        ...rows.slice(0, 5),
        {
          id: "remainder",
          label: `其他（${rows.length - 5} 项）`,
          value: rows.slice(5).reduce((sum, row) => sum + row.value, 0),
        },
      ]
    : rows;
  return {
    total,
    items: visible.map((row, index) => ({
      ...row,
      share: total > 0 ? row.value / total : 0,
      fill: `var(--ds-chart-${row.id === "remainder" ? 10 : index + 1})`,
    })),
  };
}

export function donutShare(share: number) {
  return share > 0 && share < 0.001 ? "<0.1%" : `${(share * 100).toFixed(1)}%`;
}
