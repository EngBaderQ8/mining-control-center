import React, { useEffect, useState } from "react";
import { t } from "../i18n";
import { api } from "../ipc";
import { computeProfit, powerKwFromHashrate, type NetworkStats } from "../../core/profit/calc";
import {
  loadProfitSettings,
  saveProfitSettings,
  money,
  FALLBACK_DIFFICULTY,
  type ProfitSettings,
} from "../state/profitSettings";

export type { ProfitSettings };

export function ProfitBar({ hashrateTHs }: { hashrateTHs: number }): React.ReactElement {
  const [net, setNet] = useState<NetworkStats | null>(null);
  const [settings, setSettings] = useState<ProfitSettings>(loadProfitSettings);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fetchNet = (): void => {
      void api.getNetworkStats().then(setNet);
    };
    fetchNet();
    const t = setInterval(fetchNet, 10 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const save = (s: ProfitSettings): void => {
    setSettings(s);
    saveProfitSettings(s);
  };

  const priceUsd = settings.manualPriceUsd > 0 ? settings.manualPriceUsd : (net?.priceUsd ?? 0);
  // Fall back to a recent network difficulty when the live fetch is unavailable,
  // so a manually-entered price still produces a number (escape hatch works offline).
  const effectiveNet: NetworkStats = {
    priceUsd,
    difficulty: net?.difficulty || FALLBACK_DIFFICULTY,
    blockRewardBtc: net?.blockRewardBtc ?? 3.125,
  };
  const powerKw = powerKwFromHashrate(hashrateTHs, settings.jPerTh);
  const r = computeProfit(effectiveNet, {
    hashrateTHs,
    powerKw,
    electricityPerKwh: settings.electricityPerKwh,
    usdRate: settings.usdRate,
  });
  const ready = priceUsd > 0 && effectiveNet.difficulty > 0;
  const cur = settings.currency;
  const profitColor = r.profitPerDay >= 0 ? "var(--green)" : "var(--red)";

  return (
    <div className="profitbar">
      {!ready ? (
        <div className="profit-main">
          <div className="profit-label">{t("الأرباح")}</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            {t("…جاري جلب سعر BTC — أو اضغط ⚙ وأدخل السعر يدوياً")}
          </div>
        </div>
      ) : (
        <>
          <div className="profit-main">
            <div className="profit-value" style={{ color: profitColor }}>
              {money(r.profitPerDay, cur)}
            </div>
            <div className="profit-label">{t("صافي الربح / اليوم")}</div>
          </div>
          <div className="profit-stat">
            <b>{money(r.revenuePerDay, cur)}</b>
            <span>{t("الإيراد/اليوم")}</span>
          </div>
          <div className="profit-stat">
            <b style={{ color: "var(--amber)" }}>{money(r.costPerDay, cur)}</b>
            <span>{t("الكهرباء/اليوم")}</span>
          </div>
          <div className="profit-stat">
            <b style={{ color: profitColor }}>{money(r.profitPerMonth, cur)}</b>
            <span>{t("صافي / الشهر")}</span>
          </div>
          <div className="profit-stat">
            <b>{r.marginPct.toFixed(0)}%</b>
            <span>{t("هامش الربح")}</span>
          </div>
          <div className="profit-stat">
            <b>₿ {r.btcPerDay.toFixed(5)}</b>
            <span>{t("BTC/يوم · ${price}", { price: priceUsd.toLocaleString() })}</span>
          </div>
        </>
      )}
      <button className="btn" style={{ marginInlineStart: "auto" }} onClick={() => setOpen(true)}>
        {t("⚙ إعدادات الأرباح")}
      </button>

      {open && <ProfitSettingsDialog settings={settings} onSave={save} onClose={() => setOpen(false)} />}
    </div>
  );
}

function ProfitSettingsDialog({
  settings,
  onSave,
  onClose,
}: {
  settings: ProfitSettings;
  onSave: (s: ProfitSettings) => void;
  onClose: () => void;
}): React.ReactElement {
  const [s, setS] = useState<ProfitSettings>(settings);
  const num = (v: string, prev: number): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : prev; // reject negatives
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 440 }}>
        <h3>{t("إعدادات حساب الأرباح")}</h3>
        <p className="subtitle" style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          {t("عشان نحسب أرباحك بدقة، عبّي بيانات الكهرباء والعملة.")}
        </p>

        <div className="field">
          <label>{t("رمز العملة (مثل: ريال، $، د.ك)")}</label>
          <input className="input" value={s.currency} onChange={(e) => setS({ ...s, currency: e.target.value })} />
        </div>
        <div className="field">
          <label>{t("سعر صرف الدولار (كم من عملتك = 1 دولار؟ اكتب 1 لو بالدولار)")}</label>
          <input
            className="input"
            type="number"
            value={s.usdRate}
            onChange={(e) => setS({ ...s, usdRate: num(e.target.value, s.usdRate) })}
          />
        </div>
        <div className="field">
          <label>{t("سعر الكهرباء لكل كيلوواط/ساعة (بعملتك)")}</label>
          <input
            className="input"
            type="number"
            step="0.001"
            value={s.electricityPerKwh}
            onChange={(e) => setS({ ...s, electricityPerKwh: num(e.target.value, s.electricityPerKwh) })}
          />
        </div>
        <div className="field">
          <label>{t("كفاءة الأجهزة J/TH (افتراضي 18.5 لـ S19 XP+ Hyd)")}</label>
          <input
            className="input"
            type="number"
            step="0.1"
            value={s.jPerTh}
            onChange={(e) => setS({ ...s, jPerTh: num(e.target.value, s.jPerTh) })}
          />
        </div>
        <div className="field">
          <label>{t("سعر BTC يدوياً بالدولار (اتركه 0 للسعر التلقائي المباشر)")}</label>
          <input
            className="input"
            type="number"
            value={s.manualPriceUsd}
            onChange={(e) => setS({ ...s, manualPriceUsd: num(e.target.value, s.manualPriceUsd) })}
          />
        </div>

        <div className="actions">
          <button
            className="btn primary"
            onClick={() => {
              onSave({ ...s, usdRate: s.usdRate > 0 ? s.usdRate : 1 }); // 0 rate would zero all revenue
              onClose();
            }}
          >
            {t("حفظ")}
          </button>
          <button className="btn" onClick={onClose}>
            {t("إلغاء")}
          </button>
        </div>
      </div>
    </div>
  );
}
