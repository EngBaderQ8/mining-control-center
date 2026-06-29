import React from "react";
import type { UpdateStatus } from "../../shared/api";

export function UpdateBanner({ status }: { status: UpdateStatus | null }): React.ReactElement | null {
  if (!status || status.state === "none") return null;
  let text: string | null = null;
  let color = "#1d4ed8";
  switch (status.state) {
    case "checking":
      text = "🔄 جاري التحقق من التحديثات…";
      break;
    case "uptodate":
      text = `✅ أنت على آخر نسخة (${status.current ?? status.version ?? ""})`;
      color = "#15803d";
      break;
    case "available":
      text = `⬇ يتوفّر تحديث ${status.version ?? ""} — جاري التنزيل…`;
      break;
    case "downloading":
      text = `⬇ جاري تنزيل التحديث… ${status.percent ?? 0}%`;
      break;
    case "ready":
      text = `✅ التحديث ${status.version ?? ""} جاهز — يعاد التشغيل تلقائياً خلال ثوانٍ…`;
      color = "#15803d";
      break;
    case "error":
      text = `⚠ تعذّر التحديث: ${status.error ?? ""}`;
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
