import React from "react";
import type { SiteGroup } from "../state/store";
import type { DeviceHistory } from "../state/deviceHistory";
import { analyzeTrend, type PredReason } from "../../core/predict/analyze";
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

export function PredictionsView({
  groups,
  history,
}: {
  groups: SiteGroup[];
  history: DeviceHistory;
}): React.ReactElement {
  const items = groups
    .flatMap((g) =>
      g.views.map((v) => ({
        site: g.site,
        device: v.device,
        pred: analyzeTrend(history[v.device.id] ?? [], { overheatC: 90 }),
      })),
    )
    .filter((x) => x.pred)
    .sort((a, b) => (a.pred!.severity === "high" ? 0 : 1) - (b.pred!.severity === "high" ? 0 : 1));

  return (
    <div className="site" style={{ padding: "12px 14px" }}>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12, lineHeight: 1.7 }}>
        🔮 {t("يحلّل اتجاهات الحرارة والهاش لكل جهاز ويحذّرك قبل العطل. يحتاج البرنامج يشتغل فترة لجمع البيانات.")}
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
                borderInlineStart: `3px solid ${x.pred!.severity === "high" ? "var(--red)" : "var(--amber)"}`,
              }}
            >
              <span style={{ fontSize: 18 }}>{x.pred!.severity === "high" ? "🔴" : "🟡"}</span>
              <div style={{ flex: 1 }}>
                <b>{x.device.name}</b>{" "}
                <span style={{ color: "var(--muted)", fontSize: 12 }}>· {x.site.name}</span>
                <div style={{ fontSize: 12.5, color: "var(--text)", marginTop: 2, lineHeight: 1.6 }}>
                  {x.pred!.reasons.map((r, i) => (
                    <div key={i}>⚠ {reasonText(r)}</div>
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
