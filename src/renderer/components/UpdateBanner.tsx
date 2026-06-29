import React from "react";
import type { UpdateStatus } from "../../shared/api";
import { t } from "../i18n";

export function UpdateBanner({ status }: { status: UpdateStatus | null }): React.ReactElement | null {
  if (!status || status.state === "none") return null;
  let text: string | null = null;
  let color = "#1d4ed8";
  switch (status.state) {
    case "checking":
      text = t("🔄 جاري التحقق من التحديثات…");
      break;
    case "uptodate":
      text = t("✅ أنت على آخر نسخة ({version})", { version: status.current ?? status.version ?? "" });
      color = "#15803d";
      break;
    case "available":
      text = t("⬇ يتوفّر تحديث {version} — جاري التنزيل…", { version: status.version ?? "" });
      break;
    case "downloading":
      text = t("⬇ جاري تنزيل التحديث… {percent}%", { percent: status.percent ?? 0 });
      break;
    case "ready":
      text = t("✅ التحديث {version} جاهز — يعاد التشغيل تلقائياً خلال ثوانٍ…", { version: status.version ?? "" });
      color = "#15803d";
      break;
    case "error":
      text = t("⚠ تعذّر التحديث: {error}", { error: status.error ?? "" });
      color = "#7a2330";
      break;
  }
  if (!text) return null;
  return (
    <div className="updatebar" style={{ background: color }}>
      {text}
    </div>
  );
}
