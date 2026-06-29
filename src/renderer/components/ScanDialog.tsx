import React, { useState } from "react";

interface Props {
  onClose: () => void;
  onScan: (siteName: string, base: string) => Promise<{ found: number; reachable: boolean; bases: string[] }>;
}

export function ScanDialog({ onClose, onScan }: Props): React.ReactElement {
  const [siteName, setSiteName] = useState("");
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function go(): Promise<void> {
    if (!siteName.trim()) return;
    setBusy(true);
    setResult(null);
    const r = await onScan(siteName.trim(), base.trim());
    setBusy(false);
    const scanned = r.bases.length ? r.bases.map((b) => `${b}.x`).join("، ") : "—";
    if (!r.reachable) setResult("⚠ ما لقيت أي شبكة محلية على هذا الجهاز.");
    else if (r.found === 0)
      setResult(`ما لقيت أجهزة. النطاقات اللي فُحصت: ${scanned}. لو أسيكاتك على نطاق ثاني، اكتبه بالأسفل وأعد الفحص.`);
    else setResult(`✓ تم العثور على ${r.found} جهاز (فُحص: ${scanned}) وإضافتها للموقع.`);
  }

  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>فحص الشبكة عن أجهزة التعدين</h3>
        <p className="subtitle" style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          شغّل هذا على لابتوب الموقع (الموصول بنفس شبكة الأسيكات). بيفحص الشبكة ويضيف كل جهاز يلقاه تلقائياً.
        </p>

        <div className="field">
          <label>اسم الموقع</label>
          <input
            className="input"
            placeholder="مثال: الرياض — المستودع"
            value={siteName}
            disabled={busy}
            onChange={(e) => setSiteName(e.target.value)}
          />
        </div>

        <div className="field">
          <label>نطاق الشبكة (اختياري — اتركه فاضي للكشف التلقائي)</label>
          <input
            className="input"
            placeholder="مثال: 192.168.0"
            value={base}
            disabled={busy}
            onChange={(e) => setBase(e.target.value)}
          />
        </div>

        {busy && (
          <div style={{ color: "var(--blue)", fontSize: 13, margin: "8px 0" }}>
            ⏳ جاري فحص الشبكة… (قد يأخذ ١٠–٣٠ ثانية)
          </div>
        )}
        {result && <div style={{ fontSize: 13, margin: "8px 0", lineHeight: 1.7 }}>{result}</div>}

        <div className="actions">
          {r_done(result) ? (
            <button className="btn primary" onClick={onClose}>
              تمام
            </button>
          ) : (
            <button className="btn primary" disabled={busy || !siteName.trim()} onClick={() => void go()}>
              {busy ? "جاري الفحص…" : "🔍 ابدأ الفحص"}
            </button>
          )}
          {!busy && (
            <button className="btn" onClick={onClose}>
              إغلاق
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Show the "تمام" button only on a successful find; keep "ابدأ الفحص" otherwise so
// the user can retry with a manual range.
function r_done(result: string | null): boolean {
  return !!result && result.startsWith("✓");
}
