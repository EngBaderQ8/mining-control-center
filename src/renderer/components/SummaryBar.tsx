import React from "react";
import type { Summary } from "../state/store";
import { t } from "../i18n";

export function SummaryBar({ summary }: { summary: Summary }): React.ReactElement {
  return (
    <div className="topbar">
      <div className="stat">
        <div className="n">
          {summary.siteCount} {t("مواقع")}
        </div>
        <div className="l">{t("إجمالي المواقع")}</div>
      </div>
      <div className="stat">
        <div className="n green">{summary.online} ✓</div>
        <div className="l">{t("أونلاين")}</div>
      </div>
      <div className="stat">
        <div className="n red">{summary.offline} ✕</div>
        <div className="l">{t("أوفلاين")}</div>
      </div>
      <div className="stat">
        <div className="n amber">{summary.warning} ⚠</div>
        <div className="l">{t("تحذير حرارة")}</div>
      </div>
      <div className="stat">
        <div className="n blue">{summary.totalTHs.toFixed(1)} TH/s</div>
        <div className="l">{t("الهاش الكلي")}</div>
      </div>
    </div>
  );
}
