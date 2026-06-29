import React from "react";
import type { UpdateStatus } from "../../shared/api";

export function UpdateBanner({ status }: { status: UpdateStatus | null }): React.ReactElement | null {
  if (!status) return null;
  let text: string | null = null;
  if (status.state === "available") text = `⬇ يتوفّر تحديث ${status.version ?? ""} — جاري التنزيل…`;
  else if (status.state === "downloading") text = `⬇ جاري تنزيل التحديث… ${status.percent ?? 0}%`;
  else if (status.state === "ready")
    text = `✅ التحديث ${status.version ?? ""} جاهز — يعاد التشغيل تلقائياً خلال ثوانٍ…`;
  if (!text) return null;
  return <div className="updatebar">{text}</div>;
}
