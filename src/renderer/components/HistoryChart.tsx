import React from "react";
import { t } from "../i18n";
import type { HistoryPoint } from "../state/history";

function rangeLabel(spanMs: number): string {
  const min = Math.round(spanMs / 60000);
  if (min < 60) return t("آخر {min} دقيقة", { min });
  const h = Math.round(min / 60);
  return t("آخر {h} ساعة", { h });
}

function LineChart({
  points,
  getValue,
  color,
  label,
  fmt,
}: {
  points: HistoryPoint[];
  getValue: (p: HistoryPoint) => number;
  color: string;
  label: string;
  fmt: (n: number) => string;
}): React.ReactElement {
  const W = 640;
  const H = 130;
  const PAD = 8;
  if (points.length < 2) {
    return (
      <div className="chartcard">
        <div className="charthd">
          <span>{label}</span>
        </div>
        <div style={{ color: "var(--muted)", fontSize: 13, padding: "26px 0", textAlign: "center" }}>
          {t("يحتاج بيانات أكثر — تُسجَّل تلقائياً كل دقيقة، خلّ البرنامج شغّال شوي.")}
        </div>
      </div>
    );
  }
  const vals = points.map(getValue);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const flat = max === min;
  const range = max - min || 1;
  const t0 = points[0]!.t;
  const t1 = points[points.length - 1]!.t;
  const span = t1 - t0 || 1;
  const x = (t: number): number => PAD + ((t - t0) / span) * (W - 2 * PAD);
  // A constant series draws as a horizontal mid-line (not pinned to the bottom).
  const y = (v: number): number => (flat ? H / 2 : H - PAD - ((v - min) / range) * (H - 2 * PAD));
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(getValue(p)).toFixed(1)}`).join(" ");
  const area = `${line} L${x(t1).toFixed(1)},${H - PAD} L${x(t0).toFixed(1)},${H - PAD} Z`;
  const last = getValue(points[points.length - 1]!);
  return (
    <div className="chartcard">
      <div className="charthd">
        <span>{label}</span>
        <b style={{ color }}>{fmt(last)}</b>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <path d={area} fill={color} opacity={0.12} />
        <path d={line} fill="none" stroke={color} strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="chartft">
        <span>{t("الأدنى {v}", { v: fmt(min) })}</span>
        <span>{rangeLabel(span)}</span>
        <span>{t("الأعلى {v}", { v: fmt(max) })}</span>
      </div>
    </div>
  );
}

export function HistoryCharts({ history }: { history: HistoryPoint[] }): React.ReactElement {
  return (
    <div className="charts">
      <LineChart
        points={history}
        getValue={(p) => p.ths}
        color="#2f9e54"
        label={t("إجمالي الهاشريت")}
        fmt={(n) => `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} TH/s`}
      />
      <LineChart
        points={history}
        getValue={(p) => p.temp}
        color="#e6731c"
        label={t("متوسط الحرارة")}
        fmt={(n) => `${n.toFixed(1)}°C`}
      />
      <LineChart
        points={history}
        getValue={(p) => p.online}
        color="#378add"
        label={t("الأجهزة المتصلة")}
        fmt={(n) => `${Math.round(n)}`}
      />
    </div>
  );
}
