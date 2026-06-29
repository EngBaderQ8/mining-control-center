import React, { useState } from "react";
import { api } from "../ipc";

interface Props {
  onClose: () => void;
  onScan: (
    siteName: string,
    base: string,
  ) => Promise<{
    found: number;
    reachable: boolean;
    bases: string[];
    connected: number;
    responded: number;
  }>;
}

export function ScanDialog({ onClose, onScan }: Props): React.ReactElement {
  const [siteName, setSiteName] = useState("");
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const [testIp, setTestIp] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function go(): Promise<void> {
    if (!siteName.trim()) return;
    setBusy(true);
    setResult(null);
    const r = await onScan(siteName.trim(), base.trim());
    setBusy(false);
    const scanned = r.bases.length ? r.bases.join("، ") : "—";
    const diag = `(النطاق ${scanned} · اتصل بـ ${r.connected} جهاز على 4028 · ردّ ${r.responded})`;
    if (!r.reachable) setResult("⚠ ما لقيت أي شبكة محلية على هذا الجهاز.");
    else if (r.found === 0)
      setResult(`ما لقيت أجهزة تعدين. ${diag}. الصق هذا السطر للمطوّر لمعرفة السبب بدقة.`);
    else setResult(`✓ تم العثور على ${r.found} جهاز ${diag} وإضافتها للموقع.`);
  }

  async function test(): Promise<void> {
    if (!testIp.trim()) return;
    setTestBusy(true);
    setTestResult(null);
    const r = await api.testHost(testIp.trim());
    setTestBusy(false);
    if (!r.connected) setTestResult(`❌ ما قدر يتصل بـ ${testIp} على المنفذ 4028. (${r.error ?? ""})`);
    else if (!r.gotData) setTestResult(`⚠ اتصل بـ ${testIp} لكن ما ردّ. (${r.error ?? ""})`);
    else
      setTestResult(
        `✓ اتصل وردّ! الفرمور: ${r.firmware ?? "غير معروف"}. عيّنة الرد: ${r.sample.slice(0, 90)}…`,
      );
  }

  return (
    <div className="overlay" onClick={busy || testBusy ? undefined : onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <h3>فحص الشبكة عن أجهزة التعدين</h3>
        <p className="subtitle" style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          شغّل هذا على لابتوب الموقع (الموصول بشبكة الأسيكات). بيضيف كل جهاز يلقاه تلقائياً.
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

        {busy && <div style={{ color: "var(--blue)", fontSize: 13, margin: "8px 0" }}>⏳ جاري الفحص…</div>}
        {result && <div style={{ fontSize: 13, margin: "8px 0", lineHeight: 1.7 }}>{result}</div>}

        <div className="actions">
          <button className="btn primary" disabled={busy || !siteName.trim()} onClick={() => void go()}>
            {busy ? "جاري الفحص…" : "🔍 ابدأ الفحص"}
          </button>
          {!busy && !testBusy && (
            <button className="btn" onClick={onClose}>
              إغلاق
            </button>
          )}
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "16px 0" }} />

        <div className="field">
          <label>🧪 اختبار جهاز واحد (لمعرفة سبب فشل الفحص)</label>
          <input
            className="input"
            placeholder="عنوان أسيك واحد، مثل 192.168.0.113"
            value={testIp}
            disabled={testBusy}
            onChange={(e) => setTestIp(e.target.value)}
          />
        </div>
        {testResult && <div style={{ fontSize: 12.5, margin: "8px 0", lineHeight: 1.7 }}>{testResult}</div>}
        <div className="actions">
          <button className="btn" disabled={testBusy || !testIp.trim()} onClick={() => void test()}>
            {testBusy ? "جاري الاختبار…" : "اختبر هذا الجهاز"}
          </button>
        </div>
      </div>
    </div>
  );
}
