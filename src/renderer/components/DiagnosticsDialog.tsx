import React, { useEffect, useState } from "react";
import { api } from "../ipc";
import type { Device } from "../../core/model/device";
import { t } from "../i18n";

type Health = Awaited<ReturnType<typeof api.diagnoseDevice>>;

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

export function DiagnosticsDialog({ device, onClose }: { device: Device; onClose: () => void }): React.ReactElement {
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    setBusy(true);
    void api
      .diagnoseDevice(device.host)
      .then(setHealth)
      .finally(() => setBusy(false));
  }, [device.host]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <h3>🔧 {t("تشخيص الجهاز")}: {device.name}</h3>

        {busy ? (
          <div style={{ color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
            {t("…جاري فحص الجهاز")}
          </div>
        ) : !health?.reachable ? (
          <div style={{ color: "var(--red)", padding: "16px 0" }}>
            {t("❌ ما قدر يوصل الجهاز للتشخيص.")} {health?.error ?? ""}
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
                      <td className={b.rateGhs < 1 ? "red" : "green"}>
                        {(b.rateGhs / 1000).toFixed(1)} TH
                      </td>
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
