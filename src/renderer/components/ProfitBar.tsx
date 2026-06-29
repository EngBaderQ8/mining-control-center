import React, { useEffect, useState } from "react";
import { api } from "../ipc";
import { computeProfit, powerKwFromHashrate, type NetworkStats } from "../../core/profit/calc";

export interface ProfitSettings {
  currency: string; // label e.g. "ريال", "$"
  usdRate: number; // user-currency units per 1 USD (1 => USD)
  electricityPerKwh: number; // in the user's currency
  jPerTh: number; // efficiency (J/TH)
  manualPriceUsd: number; // 0 => use the live price
}

const KEY = "mcc.profitSettings";
const DEFAULTS: ProfitSettings = {
  currency: "$",
  usdRate: 1,
  electricityPerKwh: 0.05,
  jPerTh: 18.5,
  manualPriceUsd: 0,
};

function loadSettings(): ProfitSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ProfitSettings>) };
  } catch {
    /* ignore */
  }
  return DEFAULTS;
}

const money = (n: number, cur: string): string =>
  `${n.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${cur}`;

export function ProfitBar({ hashrateTHs }: { hashrateTHs: number }): React.ReactElement {
  const [net, setNet] = useState<NetworkStats | null>(null);
  const [settings, setSettings] = useState<ProfitSettings>(loadSettings);
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
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  };

  const priceUsd = settings.manualPriceUsd > 0 ? settings.manualPriceUsd : (net?.priceUsd ?? 0);
  const effectiveNet: NetworkStats = {
    priceUsd,
    difficulty: net?.difficulty ?? 0,
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
          <div className="profit-label">الأرباح</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            …جاري جلب سعر BTC — أو اضغط ⚙ وأدخل السعر يدوياً
          </div>
        </div>
      ) : (
        <>
          <div className="profit-main">
            <div className="profit-value" style={{ color: profitColor }}>
              {money(r.profitPerDay, cur)}
            </div>
            <div className="profit-label">صافي الربح / اليوم</div>
          </div>
          <div className="profit-stat">
            <b>{money(r.revenuePerDay, cur)}</b>
            <span>الإيراد/اليوم</span>
          </div>
          <div className="profit-stat">
            <b style={{ color: "var(--amber)" }}>{money(r.costPerDay, cur)}</b>
            <span>الكهرباء/اليوم</span>
          </div>
          <div className="profit-stat">
            <b style={{ color: profitColor }}>{money(r.profitPerMonth, cur)}</b>
            <span>صافي / الشهر</span>
          </div>
          <div className="profit-stat">
            <b>{r.marginPct.toFixed(0)}%</b>
            <span>هامش الربح</span>
          </div>
          <div className="profit-stat">
            <b>₿ {r.btcPerDay.toFixed(5)}</b>
            <span>BTC/يوم · ${priceUsd.toLocaleString()}</span>
          </div>
        </>
      )}
      <button className="btn" style={{ marginInlineStart: "auto" }} onClick={() => setOpen(true)}>
        ⚙ إعدادات الأرباح
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
    return Number.isFinite(n) ? n : prev;
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 440 }}>
        <h3>إعدادات حساب الأرباح</h3>
        <p className="subtitle" style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          عشان نحسب أرباحك بدقة، عبّي بيانات الكهرباء والعملة.
        </p>

        <div className="field">
          <label>رمز العملة (مثل: ريال، $، د.ك)</label>
          <input className="input" value={s.currency} onChange={(e) => setS({ ...s, currency: e.target.value })} />
        </div>
        <div className="field">
          <label>سعر صرف الدولار (كم من عملتك = 1 دولار؟ اكتب 1 لو بالدولار)</label>
          <input
            className="input"
            type="number"
            value={s.usdRate}
            onChange={(e) => setS({ ...s, usdRate: num(e.target.value, s.usdRate) })}
          />
        </div>
        <div className="field">
          <label>سعر الكهرباء لكل كيلوواط/ساعة (بعملتك)</label>
          <input
            className="input"
            type="number"
            step="0.001"
            value={s.electricityPerKwh}
            onChange={(e) => setS({ ...s, electricityPerKwh: num(e.target.value, s.electricityPerKwh) })}
          />
        </div>
        <div className="field">
          <label>كفاءة الأجهزة J/TH (افتراضي 18.5 لـ S19 XP+ Hyd)</label>
          <input
            className="input"
            type="number"
            step="0.1"
            value={s.jPerTh}
            onChange={(e) => setS({ ...s, jPerTh: num(e.target.value, s.jPerTh) })}
          />
        </div>
        <div className="field">
          <label>سعر BTC يدوياً بالدولار (اتركه 0 للسعر التلقائي المباشر)</label>
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
              onSave(s);
              onClose();
            }}
          >
            حفظ
          </button>
          <button className="btn" onClick={onClose}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
