import React, { useEffect, useState } from "react";
import { api } from "../ipc";
import { t } from "../i18n";

interface Props {
  onClose: () => void;
  onScan: (
    siteName: string,
    base: string,
    secret: string,
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
  const [secret, setSecret] = useState("");
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
      const r = await onScan(siteName.trim(), base.trim(), secret);
      const scanned = r.bases.length ? r.bases.join("، ") : "—";
      const diag = t("(النطاق {scanned} · اتصل بـ {connected} جهاز على 4028 · ردّ {responded})", {
        scanned,
        connected: r.connected,
        responded: r.responded,
      });
      if (!r.reachable) setResult(t("⚠ ما لقيت أي شبكة محلية على هذا الجهاز."));
      else if (r.found === 0)
        setResult(t("ما لقيت أجهزة تعدين. {diag}. الصق هذا السطر للمطوّر لمعرفة السبب بدقة.", { diag }));
      else
        setResult(
          t("✓ تمت إضافة الموقع «{name}» مع {found} جهاز {diag}.", {
            name: siteName.trim(),
            found: r.found,
            diag,
          }),
        );
    } catch (err) {
      setResult(t("⚠ تعذّر الفحص: ") + String(err));
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
        setTestResult(
          t("❌ ما قدر يتصل بـ {ip} على المنفذ 4028. ({error})", {
            ip: testIp,
            error: r.error ?? "",
          }),
        );
        return;
      }
      setTestResult(
        t("✓ اتصل وردّ · الفرمور: {firmware} · المراقبة: {state} · هاش: {hash} TH · حرارة: {temp}\nاللوحات المكتشفة للتشخيص: {boards}\nعيّنة stats: {stats}\nعيّنة summary: {sample}", {
          firmware: r.firmware ?? t("؟"),
          state: r.state,
          hash: r.hashrateTHs.toFixed(1),
          temp: r.maxTempC,
          boards: r.boardsFound,
          stats: r.statsChainSample || t("(فاضي)"),
          sample: r.summarySample || t("(فاضي)"),
        }),
      );
    } catch (err) {
      setTestResult(t("⚠ تعذّر الاختبار: ") + String(err));
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div className="overlay" onClick={busy || testBusy ? undefined : onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <h3>{t("إضافة موقع وفحص أجهزته")}</h3>
        <p className="subtitle" style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          {t("شغّل هذا على لابتوب الموقع (الموصول بشبكة الأسيكات). بيضيف كل جهاز يلقاه تلقائياً.")}
        </p>

        <div className="field">
          <label>{t("اسم الموقع")}</label>
          <input
            className="input"
            placeholder={t("مثال: الرياض — المستودع")}
            value={siteName}
            disabled={busy}
            onChange={(e) => setSiteName(e.target.value)}
          />
        </div>

        <div className="field">
          <label>{t("الشبكة (تلقائي بالكامل — ما تحتاج تكتب شي)")}</label>
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
                {t("📡 جهازك على:")} <b>{detectedIps.join("، ")}</b>
                <br />
                {t("✅ بيفحص تلقائياً:")} <b>{base.trim() ? `${base.trim()}.x` : bases.map((b) => `${b}.x`).join("، ")}</b>
              </>
            ) : (
              t("…جاري كشف شبكتك تلقائياً")
            )}
          </div>
        </div>

        <details style={{ marginBottom: 10 }}>
          <summary style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
            {t("نطاق محدد يدوياً (اختياري — لو أجهزتك على شبكة غير شبكة جهازك)")}
          </summary>
          <input
            className="input"
            placeholder={t("مثال: 192.168.8")}
            value={base}
            disabled={busy}
            onChange={(e) => setBase(e.target.value)}
            style={{ marginTop: 6 }}
          />
        </details>

        <div className="field">
          <label>{t("باسورد واجهة الأسيك (اختياري — لتفعيل التحكم)")}</label>
          <input
            className="input"
            type="password"
            placeholder={t("اتركه فاضي لو على الافتراضي root:root")}
            value={secret}
            disabled={busy}
            onChange={(e) => setSecret(e.target.value)}
          />
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
            {t("🔑 نفس الباسورد اللي تدخل فيه صفحة الجهاز. يُحفظ مشفّراً ويتطبّق على كل الأجهزة — عشان أوامر التشغيل/الإيقاف تشتغل.")}
          </div>
        </div>

        {busy && <div style={{ color: "var(--blue)", fontSize: 13, margin: "8px 0" }}>{t("⏳ جاري الفحص والإضافة…")}</div>}
        {result && <div style={{ fontSize: 13, margin: "8px 0", lineHeight: 1.7 }}>{result}</div>}

        <div className="actions">
          <button className="btn primary" disabled={busy || !siteName.trim()} onClick={() => void go()}>
            {busy ? t("جاري الإضافة…") : t("➕ إضافة الموقع")}
          </button>
          {!busy && !testBusy && (
            <button className="btn" onClick={onClose}>
              {t("إغلاق")}
            </button>
          )}
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "16px 0" }} />

        <div className="field">
          <label>{t("🧪 اختبار جهاز واحد (لمعرفة سبب فشل الفحص)")}</label>
          <input
            className="input"
            placeholder={t("عنوان أسيك واحد، مثل 192.168.0.113")}
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
            {testBusy ? t("جاري الاختبار…") : t("اختبر هذا الجهاز")}
          </button>
        </div>
      </div>
    </div>
  );
}
