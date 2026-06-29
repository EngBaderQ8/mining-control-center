import { Notification } from "electron";
import type { Alert } from "../core/alerts/rules";

export function notifyAlerts(alerts: Alert[]): void {
  if (!Notification.isSupported()) return;
  for (const a of alerts) {
    const title =
      a.kind === "offline" ? "جهاز غير متصل" : a.kind === "overheat" ? "حرارة مرتفعة" : "هبوط هاش";
    new Notification({ title, body: a.message }).show();
  }
}
