import React, { useEffect, useRef, useState } from "react";
import { api } from "../ipc";
import { computeProfit, powerKwFromHashrate, type NetworkStats } from "../../core/profit/calc";
import { guardDecision, DEFAULT_GUARD, type GuardSettings } from "../../core/guard/decide";
import { loadProfitSettings, FALLBACK_DIFFICULTY } from "../state/profitSettings";
import { t } from "../i18n";

const KEY = "mcc.guard";
const PKEY = "mcc.guardPaused";

function loadGuard(): GuardSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_GUARD, ...(JSON.parse(raw) as Partial<GuardSettings>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_GUARD;
}

export function ProfitGuard({
  hashrateTHs,
  deviceIds,
  showToast,
}: {
  hashrateTHs: number;
  deviceIds: string[];
  showToast: (m: string) => void;
}): React.ReactElement {
  const [settings, setSettings] = useState<GuardSettings>(loadGuard);
  const [net, setNet] = useState<NetworkStats | null>(null);
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState<boolean>(() => localStorage.getItem(PKEY) === "1");
  const cooldownUntil = useRef(0);

  useEffect(() => {
    const f = (): void => {
      void api.getNetworkStats().then(setNet);
    };
    f();
    const id = setInterval(f, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const ps = loadProfitSettings();
  const priceUsd = ps.manualPriceUsd > 0 ? ps.manualPriceUsd : (net?.priceUsd ?? 0);
  const margin = computeProfit(
    { priceUsd, difficulty: net?.difficulty || FALLBACK_DIFFICULTY, blockRewardBtc: net?.blockRewardBtc ?? 3.125 },
    {
      hashrateTHs,
      powerKw: powerKwFromHashrate(hashrateTHs, ps.jPerTh),
      electricityPerKwh: ps.electricityPerKwh,
      usdRate: ps.usdRate,
    },
  ).marginPct;
  const ready = priceUsd > 0 && hashrateTHs > 0;

  // The auto-pause / auto-resume engine.
  useEffect(() => {
    if (!settings.enabled || !ready || deviceIds.length === 0) return;
    const now = Date.now();
    if (now < cooldownUntil.current) return;
    const decision = guardDecision(margin, ready, settings, paused);
    if (!decision) return;
    cooldownUntil.current = now + 90_000; // don't act again for 90s
    if (decision === "stop") {
      void api.sendBulk(deviceIds, "stopMining").then(() => {
        setPaused(true);
        localStorage.setItem(PKEY, "1");
        showToast(t("🛡️ حارس الربحية: أوقف التعدين — غير مربح (الهامش {m}%)", { m: margin.toFixed(0) }));
      });
    } else {
      void api.sendBulk(deviceIds, "startMining").then(() => {
        setPaused(false);
        localStorage.setItem(PKEY, "0");
        showToast(t("🛡️ حارس الربحية: عاد التعدين — صار مربحاً (الهامش {m}%)", { m: margin.toFixed(0) }));
      });
    }
  }, [margin, ready, settings, paused, deviceIds, showToast]);

  const save = (s: GuardSettings): void => {
    setSettings(s);
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      {settings.enabled && paused && (
        <div className="updatebar" style={{ background: "linear-gradient(90deg,#7c2336,#97374b)" }}>
          {t("⏸ التعدين متوقف تلقائياً بواسطة حارس الربحية — غير مربح حالياً (الهامش {m}%)", {
            m: margin.toFixed(0),
          })}
        </div>
      )}
      <button
        className={`btn ${settings.enabled ? "primary" : ""}`}
        onClick={() => setOpen(true)}
        title={t("إيقاف/تشغيل التعدين تلقائياً حسب الربحية")}
      >
        🛡️ {t("حارس الربحية")}
        {settings.enabled ? " ●" : ""}
      </button>

      {open && (
        <div className="overlay" onClick={() => setOpen(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 460 }}>
            <h3>🛡️ {t("حارس الربحية التلقائي")}</h3>
            <p className="subtitle" style={{ fontSize: 13, color: "var(--muted)", marginTop: 0, lineHeight: 1.7 }}>
              {t(
                "ميزة فريدة: يوقف التعدين تلقائياً لما تصير خسران (سعر BTC أقل من كلفة الكهرباء)، ويرجّعه لما يصير مربحاً — فما تخسر كهرباء على تعدين خاسر.",
              )}
            </p>
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={settings.enabled}
                  onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                />{" "}
                {t("تفعيل حارس الربحية")}
              </label>
            </div>
            <div className="field">
              <label>{t("أوقف التعدين إذا نزل هامش الربح تحت (%) — 0 يعني نقطة التعادل")}</label>
              <input
                className="input"
                type="number"
                value={settings.stopBelowMargin}
                onChange={(e) => {
                  const n = parseFloat(e.target.value);
                  setSettings({ ...settings, stopBelowMargin: Number.isFinite(n) ? n : 0 });
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
              {t("الهامش الحالي:")} <b style={{ color: margin >= 0 ? "var(--green)" : "var(--red)" }}>{margin.toFixed(0)}%</b>
              {" · "}
              {paused ? t("الحالة: متوقف") : t("الحالة: يعمل")}
            </p>
            <p style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.6 }}>
              {t("⚠ يحتاج إعداد سعر الكهرباء في «إعدادات الأرباح»، ويشتغل والبرنامج مفتوح.")}
            </p>
            <div className="actions">
              <button className="btn primary" onClick={() => (save(settings), setOpen(false))}>
                {t("حفظ")}
              </button>
              <button className="btn" onClick={() => setOpen(false)}>
                {t("إغلاق")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
