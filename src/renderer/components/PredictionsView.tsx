import React from "react";
import type { SiteGroup } from "../state/store";
import type { DeviceHistory } from "../state/deviceHistory";
import { analyzeTrend, type PredReason } from "../../core/predict/analyze";
import { analyzeBoards, type BoardReason } from "../../core/predict/boards";
import { t } from "../i18n";

function reasonText(r: PredReason): string {
  switch (r.code) {
    case "tempRising":
      return t("الحرارة تتصاعد (~{slope}° بالساعة، الآن {temp}°)", r.values);
    case "hashDrop":
      return t("هبوط هاش تدريجي (من ~{from} إلى {to} TH)", r.values);
    case "flapping":
      return t("انقطاعات متكررة ({count} مرات)", r.values);
  }
}

function boardReasonText(r: BoardReason): string {
  switch (r.code) {
    case "chipsLost":
      return r.values.to === 0
        ? t("لوحة {b}: توقّفت (كانت ~{from} شبّة)", r.values)
        : t("لوحة {b}: تفقد شبّات (من {from} إلى {to})", r.values);
    case "boardRateDecline":
      return t("لوحة {b}: هاش اللوحة ينزل (من {from} إلى {to} GH)", r.values);
    case "boardIntermittent":
      return t("لوحة {b}: تظهر وتختفي ({count} مرات)", r.values);
  }
}

export function PredictionsView({
  groups,
  history,
}: {
  groups: SiteGroup[];
  history: DeviceHistory;
}): React.ReactElement {
  const items = groups
    .flatMap((g) =>
      g.views.map((v) => {
        const samples = history[v.device.id] ?? [];
        return {
          site: g.site,
          device: v.device,
          pred: analyzeTrend(samples, { overheatC: 90 }),
          boards: analyzeBoards(samples),
        };
      }),
    )
    .filter((x) => x.pred || x.boards.length > 0)
    .map((x) => {
      const high = x.pred?.severity === "high" || x.boards.some((b) => b.severity === "high");
      const lines: string[] = [];
      if (x.pred) for (const r of x.pred.reasons) lines.push(reasonText(r));
      for (const bp of x.boards) {
        for (const r of bp.reasons) lines.push(boardReasonText(r));
        if (bp.etaDays !== undefined) {
          lines.push(bp.etaDays > 0 ? t("↳ متوقّع تعطل اللوحة خلال ~{days} يوم", { days: bp.etaDays }) : t("↳ اللوحة قد تتعطّل قريباً"));
        }
      }
      return { ...x, high, lines };
    })
    .sort((a, b) => (a.high ? 0 : 1) - (b.high ? 0 : 1));

  return (
    <div className="site" style={{ padding: "12px 14px" }}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12, lineHeight: 1.7 }}>
        🔮 {t("يحلّل اتجاهات الحرارة والهاش وصحة اللوحات لكل جهاز ويحذّرك قبل العطل. يحتاج البرنامج يشتغل فترة لجمع البيانات.")}
      </div>
      {items.length === 0 ? (
        <div style={{ textAlign: "center", padding: 24, color: "var(--green)", fontSize: 15 }}>
          ✅ {t("كل الأجهزة بصحة جيدة — لا توجد مؤشرات أعطال.")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {items.map((x) => (
            <div
              key={x.device.id}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                padding: "10px 12px",
                borderRadius: 8,
                background: "var(--surface2)",
                borderInlineStart: `3px solid ${x.high ? "var(--red)" : "var(--amber)"}`,
              }}
            >
              <span style={{ fontSize: 18 }}>{x.high ? "🔴" : "🟡"}</span>
              <div style={{ flex: 1 }}>
                <b>{x.device.name}</b>{" "}
                <span style={{ color: "var(--muted)", fontSize: 12 }}>· {x.site.name}</span>
                <div style={{ fontSize: 12.5, color: "var(--text)", marginTop: 2, lineHeight: 1.6 }}>
                  {x.lines.map((line, i) => (
                    <div key={i}>{line.startsWith("↳") ? line : `⚠ ${line}`}</div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
