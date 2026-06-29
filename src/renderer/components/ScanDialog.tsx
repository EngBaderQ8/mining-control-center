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

  // Auto-detect this machine's real IP(s) from the OS (any subnet — 192.168.0,
  // 192.168.8, 10.x …). We DON'T pre-fill the manual field, so an empty value
  // means "scan ALL of my detected networks" (robust for multi-adapter machines).
  useEffect(() => {
    void api.getLocalIps().then(setDetectedIps);
  }, []);

  const bases = [...new Set(detectedIps.map((ip) => ip.split(".").slice(0, 3).join(".")))];

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
          <label>الشبكة (تلقائي بالكامل — ما تحتاج تكتب شي)</label>
          <div
            style={{
              fontSize: 13,
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              padding: "9px 11px",
              borderRadius: 8,
              lineHeight: 1.9,
            }}
          >
            {detectedIps.length > 0 ? (
              <>
                📡 جهازك على: <b>{detectedIps.join("، ")}</b>
                <br />
                ✅ بيفحص تلقائياً: <b>{base.trim() ? `${base.trim()}.x` : bases.map((b) => `${b}.x`).join("، ")}</b>
              </>
            ) : (
              "…جاري كشف شبكتك تلقائياً"
            )}
          </div>
        </div>

        <details style={{ marginBottom: 10 }}>
          <summary style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
            نطاق محدد يدوياً (اختياري — لو أجهزتك على شبكة غير شبكة جهازك)
          </summary>
          <input
            className="input"
            placeholder="مثال: 192.168.8"
            value={base}
            disabled={busy}
            onChange={(e) => setBase(e.target.value)}
            style={{ marginTop: 6 }}
          />
        </details>

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
