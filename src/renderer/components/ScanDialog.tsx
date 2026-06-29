import React, { useEffect, useState } from "react";
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
  const [detectedIps, setDetectedIps] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const [testIp, setTestIp] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Auto-detect this machine's network and pre-fill the range — no typing needed.
  useEffect(() => {
    void api.getLocalIps().then((ips) => {
      setDetectedIps(ips);
      const first = ips[0];
      if (first) setBase(first.split(".").slice(0, 3).join("."));
    });
  }, []);

  async function go(): Promise<void> {
    if (!siteName.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await onScan(siteName.trim(), base.trim());
      const scanned = r.bases.length ? r.bases.join("، ") : "—";
      const diag = `(النطاق ${scanned} · اتصل بـ ${r.connected} جهاز على 4028 · ردّ ${r.responded})`;
      if (!r.reachable) setResult("⚠ ما لقيت أي شبكة محلية على هذا الجهاز.");
      else if (r.found === 0)
        setResult(`ما لقيت أجهزة تعدين. ${diag}. الصق هذا السطر للمطوّر لمعرفة السبب بدقة.`);
      else setResult(`✓ تمت إضافة الموقع «${siteName.trim()}» مع ${r.found} جهاز ${diag}.`);
    } catch (err) {
      setResult("⚠ تعذّر الفحص: " + String(err));
    } finally {
      setBusy(false);
    }
  }

  async function test(): Promise<void> {
    if (!testIp.trim()) return;
    setTestBusy(true);
    setTestResult(null);
    try {
      const r = await api.testHost(testIp.trim());
      if (!r.connected) {
        setTestResult(`❌ ما قدر يتصل بـ ${testIp} على المنفذ 4028. (${r.error ?? ""})`);
        return;
      }
      setTestResult(
        `✓ اتصل وردّ · الفرمور: ${r.firmware ?? "؟"} · المراقبة: ${r.state} · هاش: ${r.hashrateTHs.toFixed(
          1,
        )} TH · حرارة: ${r.maxTempC}\nعيّنة summary: ${r.summarySample || "(فاضي)"}`,
      );
    } catch (err) {
      setTestResult("⚠ تعذّر الاختبار: " + String(err));
    } finally {
      setTestBusy(false);
    }
  }

  const detected = detectedIps[0];
  return (
    <div className="overlay" onClick={busy || testBusy ? undefined : onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <h3>إضافة موقع وفحص أجهزته</h3>
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
          <label>نطاق الشبكة (تلقائي)</label>
          <input
            className="input"
            placeholder="يُكتشف تلقائياً…"
            value={base}
            disabled={busy}
            onChange={(e) => setBase(e.target.value)}
          />
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            {detected
              ? `📡 اكتُشف جهازك تلقائياً: ${detected} — سيُفحص النطاق ${base || "؟"}.x`
              : "…جاري كشف شبكتك تلقائياً"}
          </div>
        </div>

        {busy && <div style={{ color: "var(--blue)", fontSize: 13, margin: "8px 0" }}>⏳ جاري الفحص والإضافة…</div>}
        {result && <div style={{ fontSize: 13, margin: "8px 0", lineHeight: 1.7 }}>{result}</div>}

        <div className="actions">
          <button className="btn primary" disabled={busy || !siteName.trim()} onClick={() => void go()}>
            {busy ? "جاري الإضافة…" : "➕ إضافة الموقع"}
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
        {testResult && (
          <div style={{ fontSize: 12.5, margin: "8px 0", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {testResult}
          </div>
        )}
        <div className="actions">
          <button className="btn" disabled={testBusy || !testIp.trim()} onClick={() => void test()}>
            {testBusy ? "جاري الاختبار…" : "اختبر هذا الجهاز"}
          </button>
        </div>
      </div>
    </div>
  );
}
