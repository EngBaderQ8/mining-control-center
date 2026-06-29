import React from "react";
import type { Summary } from "../state/store";

export function SummaryBar({ summary }: { summary: Summary }): React.ReactElement {
  return (
    <div className="topbar">
      <div className="stat">
        <div className="n">{summary.siteCount} مواقع</div>
        <div className="l">إجمالي المواقع</div>
      </div>
      <div className="stat">
        <div className="n green">{summary.online} ✓</div>
        <div className="l">أونلاين</div>
      </div>
      <div className="stat">
        <div className="n red">{summary.offline} ✕</div>
        <div className="l">أوفلاين</div>
      </div>
      <div className="stat">
        <div className="n amber">{summary.warning} ⚠</div>
        <div className="l">تحذير حرارة</div>
      </div>
      <div className="stat">
        <div className="n blue">{summary.totalTHs.toFixed(1)} TH/s</div>
        <div className="l">الهاش الكلي</div>
      </div>
    </div>
  );
}
