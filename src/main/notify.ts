import { Notification } from "electron";
import type { Alert } from "../core/alerts/rules";

export function notifyMessage(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title, body }).show();
}

export function notifyAlerts(alerts: Alert[]): void {
  if (!Notification.isSupported()) return;
  for (const a of alerts) {
    const title =
      a.kind === "offline" ? "جهاز غير متصل" : a.kind === "overheat" ? "حرارة مرتفعة" : "هبوط هاش";
    notifyMessage(title, a.message);
  }
}
