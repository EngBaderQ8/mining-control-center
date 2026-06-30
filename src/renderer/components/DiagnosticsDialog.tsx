import React from "react";
import type { Device } from "../../core/model/device";
import type { DeviceHealth } from "../../core/diagnose/parse";
import { t } from "../i18n";

function issueText(code: string, v: Record<string, number>): string {
  switch (code) {
    case "boardDown":
      return t("🔴 اللوحة {board} متوقفة (لا تنتج هاش)", v);
    case "chipsMissing":
      return t("🟡 اللوحة {board}: رقائق ناقصة ({chips} من {expected})", v);
    case "fanDead":
      return t("🔴 المروحة {fan} متوقفة", v);
    case "highHwErrors":
      return t("🟡 أخطاء عتاد عالية باللوحة {board} ({errors})", v);
    case "boardHot":
      return t("🔴 حرارة لوحة مرتفعة ({temp}°)", v);
    default:
      return code;
  }
}

export function DiagnosticsDialog({
  device,
  health,
  onClose,
}: {
  device: Device;
  health: DeviceHealth | undefined;
  onClose: () => void;
}): React.ReactElement {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <h3>
          🔧 {t("تشخيص الجهاز")}: {device.name}
        </h3>

        {!health || (health.boards.length === 0 && health.issues.length === 0) ? (
          <div style={{ color: "var(--muted)", padding: "14px 2px", lineHeight: 1.8 }}>
            <div style={{ marginBottom: 8 }}>
              {t("…ما وصلت بيانات تشخيص هذا الجهاز بعد.")}
            </div>
            <div style={{ fontSize: 12.5 }}>
              {t("• تأكد أن لابتوب الموقع (الموصول بشبكة الأسيكات) محدّث لآخر نسخة — هو اللي يقرأ تفاصيل اللوحات ويرسلها.")}
              <br />
              {t("• بعد التحديث، خلّ البرنامج مفتوح دقيقة وحدة وبتظهر تلقائياً.")}
            </div>
          </div>
        ) : (
          <>
            {health.issues.length === 0 ? (
              <div style={{ color: "var(--green)", fontSize: 15, padding: "10px 0" }}>
                ✅ {t("الجهاز سليم — ما فيه أعطال مكتشفة.")}
              </div>
            ) : (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>
                  {t("المشاكل المكتشفة ({n}):", { n: health.issues.length })}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {health.issues.map((iss, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "8px 11px",
                        borderRadius: 8,
                        background: "var(--surface2)",
                        borderInlineStart: `3px solid ${iss.severity === "high" ? "var(--red)" : "var(--amber)"}`,
                        fontSize: 13,
                      }}
                    >
                      {issueText(iss.code, iss.values)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {health.boards.length > 0 && (
              <table className="tbl" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>{t("اللوحة")}</th>
                    <th>{t("الرقائق")}</th>
                    <th>{t("الهاش")}</th>
                    <th>{t("أخطاء")}</th>
                  </tr>
                </thead>
                <tbody>
                  {health.boards.map((b) => (
                    <tr key={b.board}>
                      <td>{b.board}</td>
                      <td className={b.chips === 0 ? "red" : ""}>{b.chips}</td>
                      <td className={b.rateGhs < 1 ? "red" : "green"}>{(b.rateGhs / 1000).toFixed(1)} TH</td>
                      <td className={b.hwErrors > 50 ? "amber" : ""}>{b.hwErrors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {health.fans.length > 0 && (
              <div style={{ fontSize: 13, marginTop: 10, color: "var(--muted)" }}>
                {t("المراوح (RPM):")}{" "}
                {health.fans.map((f, i) => (
                  <span key={i} className={f === 0 ? "red" : ""} style={{ marginInlineEnd: 8, fontWeight: 600 }}>
                    {f}
                  </span>
                ))}
              </div>
            )}
          </>
        )}

        <div className="actions">
          <button className="btn" onClick={onClose}>
            {t("إغلاق")}
          </button>
        </div>
      </div>
    </div>
  );
}
