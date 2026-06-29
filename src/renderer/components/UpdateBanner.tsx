import React from "react";
import type { UpdateStatus } from "../../shared/api";

export function UpdateBanner({ status }: { status: UpdateStatus | null }): React.ReactElement | null {
  if (!status) return null;
  let text: string | null = null;
  let color = "#1d4ed8";
  if (status.state === "available") text = `⬇ يتوفّر تحديث ${status.version ?? ""} — جاري التنزيل…`;
  else if (status.state === "downloading") text = `⬇ جاري تنزيل التحديث… ${status.percent ?? 0}%`;
  else if (status.state === "ready")
    text = `✅ التحديث ${status.version ?? ""} جاهز — يعاد التشغيل تلقائياً خلال ثوانٍ…`;
  else if (status.state === "error") {
    text = `⚠ مشكلة في التحديث التلقائي: ${status.error ?? ""}`;
    color = "#7a2330";
  }
  if (!text) return null;
  return (
    <div className="updatebar" style={{ background: color }}>
      {text}
    </div>
  );
}
