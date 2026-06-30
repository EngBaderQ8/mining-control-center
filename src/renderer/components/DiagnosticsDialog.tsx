import React, { useEffect, useState } from "react";
import { api } from "../ipc";
import type { Device } from "../../core/model/device";
import type { DeviceHealth } from "../../core/diagnose/parse";
import type { DeviceSpec } from "../../core/devices/catalog";
import { t } from "../i18n";

type Health = DeviceHealth & { spec?: DeviceSpec | null; raw?: string };

function issueText(code: string, v: Record<string, number>): string {
  switch (code) {
    case "boardDown":
      return t("🔴 اللوحة {board} متوقفة (فيها رقائق لكن ما تنتج هاش)", v);
    case "chipsMissing":
      return t("🟡 اللوحة {board}: رقائق ناقصة ({chips} من {expected})", v);
    case "fanDead":
      return t("🔴 المروحة {fan} متوقفة", v);
    case "boardHot":
      return t("🔴 حرارة لوحة مرتفعة ({temp}°)", v);
    default:
      return code;
  }
}

const coolingLabel = (c: string): string =>
  c === "hydro" ? t("تبريد مائي 💧") : c === "immersion" ? t("تبريد بالغمر 🛢️") : t("تبريد هوائي 🌀");

export function DiagnosticsDialog({
  device,
  health: initial,
  onClose,
}: {
  device: Device;
  health: DeviceHealth | undefined;
  onClose: () => void;
}): React.ReactElement {
  const [health, setHealth] = useState<Health | undefined>(initial);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    setErr(null);
    void api
      .sendCommand(device.id, "diagnose")
      .then((o) => {
        if (!alive) return;
        if (o.ok && o.data) {
          try {
            setHealth(JSON.parse(o.data) as Health);
          } catch {
            setErr(t("تعذّر قراءة بيانات التشخيص."));
          }
        } else {
          setErr(o.error || t("ما قدر يوصل الجهاز."));
        }
      })
      .catch((e: unknown) => alive && setErr(String(e)))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [device.id]);

  const hasData = !!health && (health.boards.length > 0 || health.issues.length > 0);
  const spec = health?.spec ?? null;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <h3>
          🔧 {t("تشخيص الجهاز")}: {device.name}
        </h3>

        {spec && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              fontSize: 12.5,
              color: "var(--muted)",
              marginBottom: 4,
            }}
          >
            <span>🏭 {spec.vendor}</span>
            <span>· {spec.model}</span>
            <span>· {coolingLabel(spec.cooling)}</span>
            {spec.nominalTHs ? <span>· ≈{spec.nominalTHs} TH</span> : null}
            <span>· {spec.algo}</span>
          </div>
        )}

        {busy && !hasData ? (
          <div style={{ color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
            {t("…جاري قراءة حالة الجهاز")}
          </div>
        ) : !hasData ? (
          <div style={{ color: "var(--muted)", padding: "14px 2px", lineHeight: 1.8 }}>
            <div style={{ color: "var(--red)", marginBottom: 8 }}>
              {t("❌ ما قدر يجيب بيانات التشخيص.")} {err ?? ""}
            </div>
            <div style={{ fontSize: 12.5 }}>
              {t("• تأكد أن لابتوب الموقع (الموصول بشبكة الأسيكات) محدّث لآخر نسخة — هو اللي يقرأ تفاصيل اللوحات ويرسلها.")}
            </div>
            {health?.raw && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, marginBottom: 4 }}>
                  {t("بيانات الجهاز الخام (انسخها وأرسلها للدعم لو استمرّت المشكلة):")}
                </div>
                <pre
                  style={{
                    fontSize: 10.5,
                    direction: "ltr",
                    textAlign: "left",
                    maxHeight: 130,
                    overflow: "auto",
                    background: "var(--surface2)",
                    padding: "8px 10px",
                    borderRadius: 8,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {health.raw}
                </pre>
              </div>
            )}
          </div>
        ) : (
          <>
            {health!.issues.length === 0 ? (
              <div style={{ color: "var(--green)", fontSize: 15, padding: "10px 0" }}>
                ✅ {t("الجهاز سليم — ما فيه أعطال مكتشفة.")}
              </div>
            ) : (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 6 }}>
                  {t("المشاكل المكتشفة ({n}):", { n: health!.issues.length })}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {health!.issues.map((iss, i) => (
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

            {health!.boards.length > 0 && (
              <table className="tbl" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>{t("اللوحة")}</th>
                    <th>{t("الرقائق")}</th>
                    <th>{t("الهاش")}</th>
                  </tr>
                </thead>
                <tbody>
                  {health!.boards.map((b) => (
                    <tr key={b.board}>
                      <td>{b.board}</td>
                      <td className={b.chips === 0 ? "red" : ""}>{b.chips}</td>
                      <td className={b.rateGhs < 1 ? "red" : "green"}>{(b.rateGhs / 1000).toFixed(1)} TH</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ fontSize: 13, marginTop: 10, color: "var(--muted)" }}>
              {health!.hasFans ? (
                <>
                  {t("المراوح (RPM):")}{" "}
                  {health!.fans.map((f, i) => (
                    <span key={i} className={f === 0 ? "red" : ""} style={{ marginInlineEnd: 8, fontWeight: 600 }}>
                      {f}
                    </span>
                  ))}
                </>
              ) : (
                <>💧 {t("تبريد مائي/غمر — بدون مراوح (طبيعي)")}</>
              )}
            </div>
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
