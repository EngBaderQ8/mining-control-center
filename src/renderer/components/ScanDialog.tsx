import React, { useState } from "react";

interface Props {
  onClose: () => void;
  onScan: (siteName: string) => Promise<{ found: number; reachable: boolean }>;
}

export function ScanDialog({ onClose, onScan }: Props): React.ReactElement {
  const [siteName, setSiteName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function go(): Promise<void> {
    if (!siteName.trim()) return;
    setBusy(true);
    setResult(null);
    const r = await onScan(siteName.trim());
    setBusy(false);
    if (!r.reachable) setResult("⚠ ما لقيت شبكة محلية على هذا الجهاز (تأكد إنه موصول بشبكة الأسيكات).");
    else if (r.found === 0) setResult("ما لقيت أي جهاز تعدين في الشبكة.");
    else setResult(`✓ تم العثور على ${r.found} جهاز وإضافتها للموقع.`);
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

        {busy && (
          <div style={{ color: "var(--blue)", fontSize: 13, margin: "8px 0" }}>
            ⏳ جاري فحص الشبكة… (قد يأخذ ١٠–٢٠ ثانية)
          </div>
        )}
        {result && <div style={{ fontSize: 13, margin: "8px 0" }}>{result}</div>}

        <div className="actions">
          {!result ? (
            <button className="btn primary" disabled={busy || !siteName.trim()} onClick={() => void go()}>
              {busy ? "جاري الفحص…" : "🔍 ابدأ الفحص"}
            </button>
          ) : (
            <button className="btn primary" onClick={onClose}>
              تمام
            </button>
          )}
          {!busy && !result && (
            <button className="btn" onClick={onClose}>
              إلغاء
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
