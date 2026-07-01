import React, { useEffect, useState } from "react";
import { t } from "../i18n";
import { api } from "../ipc";
import { computeProfit, type NetworkStats, type ProfitResult } from "../../core/profit/calc";
import { sitePowerKw, type SiteGroup } from "../state/store";
import type { Site } from "../../core/model/device";
import {
  loadProfitSettings,
  saveProfitSettings,
  money,
  FALLBACK_DIFFICULTY,
  siteElectricity,
  siteRentMonthly,
  type ProfitSettings,
} from "../state/profitSettings";

export type { ProfitSettings };

const ZERO: ProfitResult = {
  btcPerDay: 0, revenuePerDay: 0, costPerDay: 0, rentPerDay: 0, profitPerDay: 0,
  revenuePerMonth: 0, costPerMonth: 0, rentPerMonth: 0, profitPerMonth: 0, marginPct: 0,
};

export function ProfitBar({ groups }: { groups: SiteGroup[] }): React.ReactElement {
  const [net, setNet] = useState<NetworkStats | null>(null);
  const [settings, setSettings] = useState<ProfitSettings>(loadProfitSettings);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fetchNet = (): void => {
      void api.getNetworkStats().then(setNet);
    };
    fetchNet();
    const timer = setInterval(fetchNet, 10 * 60 * 1000); // price + difficulty refresh
    return () => clearInterval(timer);
  }, []);

  const save = (s: ProfitSettings): void => {
    setSettings(s);
    saveProfitSettings(s);
  };

  const priceUsd = settings.manualPriceUsd > 0 ? settings.manualPriceUsd : (net?.priceUsd ?? 0);
  const liveDifficulty = (net?.difficulty ?? 0) > 0;
  // Fall back to a recent network difficulty when the live fetch is unavailable,
  // so a manually-entered price still produces a number (escape hatch works offline).
  const effectiveNet: NetworkStats = {
    priceUsd,
    difficulty: net?.difficulty || FALLBACK_DIFFICULTY,
    blockRewardBtc: net?.blockRewardBtc ?? 3.125,
  };

  // Total = sum of per-site results so each site's own electricity price + rent apply.
  const r: ProfitResult = groups.reduce((acc, g) => {
    const ths = g.views.reduce((s, v) => s + (v.status?.hashrateTHs ?? 0), 0);
    const powerKw = sitePowerKw(g.views, settings.jPerTh); // per-model efficiency
    const x = computeProfit(effectiveNet, {
      hashrateTHs: ths,
      powerKw,
      electricityPerKwh: siteElectricity(settings, g.site.id),
      usdRate: settings.usdRate,
      rentPerDay: siteRentMonthly(settings, g.site.id) / 30,
    });
    return {
      btcPerDay: acc.btcPerDay + x.btcPerDay,
      revenuePerDay: acc.revenuePerDay + x.revenuePerDay,
      costPerDay: acc.costPerDay + x.costPerDay,
      rentPerDay: acc.rentPerDay + x.rentPerDay,
      profitPerDay: acc.profitPerDay + x.profitPerDay,
      revenuePerMonth: acc.revenuePerMonth + x.revenuePerMonth,
      costPerMonth: acc.costPerMonth + x.costPerMonth,
      rentPerMonth: acc.rentPerMonth + x.rentPerMonth,
      profitPerMonth: acc.profitPerMonth + x.profitPerMonth,
      marginPct: 0,
    };
  }, { ...ZERO });
  r.marginPct = r.revenuePerDay > 0 ? (r.profitPerDay / r.revenuePerDay) * 100 : 0;

  const ready = priceUsd > 0 && effectiveNet.difficulty > 0;
  const cur = settings.currency;
  const profitColor = r.profitPerDay >= 0 ? "var(--green)" : "var(--red)";
  const diffT = (effectiveNet.difficulty / 1e12).toLocaleString(undefined, { maximumFractionDigits: 1 });

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
          {r.rentPerMonth > 0 && (
            <div className="profit-stat">
              <b style={{ color: "var(--amber)" }}>{money(r.rentPerMonth, cur)}</b>
              <span>{t("الإيجار/الشهر")}</span>
            </div>
          )}
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
          <div className="profit-stat" title={liveDifficulty ? t("صعوبة الشبكة المباشرة") : t("قيمة تقديرية — تعذّر الجلب المباشر")}>
            <b style={{ color: liveDifficulty ? "var(--green)" : "var(--amber)" }}>{diffT}T</b>
            <span>{liveDifficulty ? t("صعوبة الشبكة 🟢") : t("صعوبة (تقديري)")}</span>
          </div>
        </>
      )}
      <button className="btn" style={{ marginInlineStart: "auto" }} onClick={() => setOpen(true)}>
        {t("⚙ إعدادات الأرباح")}
      </button>

      {open && (
        <ProfitSettingsDialog
          settings={settings}
          sites={groups.map((g) => g.site)}
          onSave={save}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function ProfitSettingsDialog({
  settings,
  sites,
  onSave,
  onClose,
}: {
  settings: ProfitSettings;
  sites: Site[];
  onSave: (s: ProfitSettings) => void;
  onClose: () => void;
}): React.ReactElement {
  const [s, setS] = useState<ProfitSettings>(settings);
  const num = (v: string, prev: number): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n >= 0 ? n : prev; // reject negatives
  };
  // Update one site's rent/electricity map entry (0/empty clears it).
  const setSiteRent = (siteId: string, v: string): void =>
    setS({ ...s, rentPerMonthBySite: { ...s.rentPerMonthBySite, [siteId]: num(v, s.rentPerMonthBySite?.[siteId] ?? 0) } });
  const setSiteElec = (siteId: string, v: string): void =>
    setS({ ...s, electricityBySite: { ...s.electricityBySite, [siteId]: num(v, s.electricityBySite?.[siteId] ?? 0) } });

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 480, maxHeight: "88vh", overflow: "auto" }}>
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
          <label>{t("سعر الكهرباء الافتراضي لكل كيلوواط/ساعة (بعملتك)")}</label>
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

        {sites.length > 0 && (
          <div style={{ marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>{t("لكل موقع: الإيجار + سعر الكهرباء")}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              {t("الإيجار شهري (0 لو ما فيه). سعر الكهرباء اتركه 0 عشان يستخدم الافتراضي فوق.")}
            </div>
            <table className="tbl" style={{ fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th>{t("الموقع")}</th>
                  <th>{t("الإيجار/الشهر")}</th>
                  <th>{t("الكهرباء/kWh")}</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => (
                  <tr key={site.id}>
                    <td><b>{site.name}</b></td>
                    <td>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        style={{ width: 110 }}
                        value={s.rentPerMonthBySite?.[site.id] ?? 0}
                        onChange={(e) => setSiteRent(site.id, e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.001"
                        style={{ width: 110 }}
                        placeholder={String(s.electricityPerKwh)}
                        value={s.electricityBySite?.[site.id] ?? 0}
                        onChange={(e) => setSiteElec(site.id, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

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
