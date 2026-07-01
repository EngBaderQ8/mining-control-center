import React, { useEffect, useState } from "react";
import { t } from "../i18n";
import { api } from "../ipc";
import type { SiteGroup } from "../state/store";
import { computeProfit, type NetworkStats } from "../../core/profit/calc";
import { sitePowerKw } from "../state/store";
import { loadProfitSettings, money, FALLBACK_DIFFICULTY, FALLBACK_JPERTH, siteElectricity, siteRentMonthly } from "../state/profitSettings";

export function SiteBreakdown({ groups }: { groups: SiteGroup[] }): React.ReactElement {
  const [net, setNet] = useState<NetworkStats | null>(null);
  const settings = loadProfitSettings();

  useEffect(() => {
    const f = (): void => void api.getNetworkStats().then(setNet);
    f();
    const id = setInterval(f, 5000); // keep per-site profit fresh with the live price
    return () => clearInterval(id);
  }, []);

  const cur = settings.currency;
  const priceUsd = settings.manualPriceUsd > 0 ? settings.manualPriceUsd : (net?.priceUsd ?? 0);
  const effNet: NetworkStats = {
    priceUsd,
    difficulty: net?.difficulty || FALLBACK_DIFFICULTY,
    blockRewardBtc: net?.blockRewardBtc ?? 3.125,
  };

  const rows = groups
    .map((g) => {
      const online = g.views.filter((v) => v.status?.state === "online").length;
      const ths = g.views.reduce((s, v) => s + (v.status?.hashrateTHs ?? 0), 0);
      const powerKw = sitePowerKw(g.views, FALLBACK_JPERTH); // power per device from its model
      const r = computeProfit(effNet, {
        hashrateTHs: ths,
        powerKw,
        electricityPerKwh: siteElectricity(settings, g.site.id),
        usdRate: settings.usdRate,
        rentPerDay: siteRentMonthly(settings, g.site.id) / 30,
      });
      return { site: g.site, devices: g.views.length, online, ths, powerKw, r };
    })
    .sort((a, b) => b.r.profitPerDay - a.r.profitPerDay); // most profitable first

  const tot = rows.reduce(
    (a, x) => ({
      ths: a.ths + x.ths,
      powerKw: a.powerKw + x.powerKw,
      profit: a.profit + x.r.profitPerDay,
      cost: a.cost + x.r.costPerDay,
      rentMonth: a.rentMonth + x.r.rentPerMonth,
      devices: a.devices + x.devices,
      online: a.online + x.online,
    }),
    { ths: 0, powerKw: 0, profit: 0, cost: 0, rentMonth: 0, devices: 0, online: 0 },
  );

  return (
    <div className="site" style={{ padding: "4px 0" }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>{t("الموقع")}</th>
            <th>{t("الأجهزة")}</th>
            <th>{t("شغّال")}</th>
            <th>{t("الهاش")}</th>
            <th>{t("الطاقة")}</th>
            <th>{t("الكفاءة")}</th>
            <th>{t("الكهرباء/يوم")}</th>
            <th>{t("الإيجار/الشهر")}</th>
            <th>{t("صافي/يوم")}</th>
            <th>{t("صافي/شهر")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.site.id}>
              <td>
                <b>{x.site.name}</b>
              </td>
              <td>{x.devices}</td>
              <td className="green">{x.online}</td>
              <td className="green">{x.ths.toLocaleString(undefined, { maximumFractionDigits: 0 })} TH/s</td>
              <td>{x.powerKw.toFixed(0)} kW</td>
              <td>{x.ths > 0 ? `${((x.powerKw * 1000) / x.ths).toFixed(1)} J/TH` : "—"}</td>
              <td className="amber">{money(x.r.costPerDay, cur)}</td>
              <td className="amber">{x.r.rentPerMonth > 0 ? money(x.r.rentPerMonth, cur) : "—"}</td>
              <td style={{ color: x.r.profitPerDay >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
                {money(x.r.profitPerDay, cur)}
              </td>
              <td style={{ color: x.r.profitPerMonth >= 0 ? "var(--green)" : "var(--red)" }}>
                {money(x.r.profitPerMonth, cur)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border)" }}>
            <td>{t("الإجمالي")}</td>
            <td>{tot.devices}</td>
            <td className="green">{tot.online}</td>
            <td className="green">{tot.ths.toLocaleString(undefined, { maximumFractionDigits: 0 })} TH/s</td>
            <td>{tot.powerKw.toFixed(0)} kW</td>
            <td>—</td>
            <td className="amber">{money(tot.cost, cur)}</td>
            <td className="amber">{tot.rentMonth > 0 ? money(tot.rentMonth, cur) : "—"}</td>
            <td style={{ color: tot.profit >= 0 ? "var(--green)" : "var(--red)" }}>{money(tot.profit, cur)}</td>
            <td style={{ color: tot.profit >= 0 ? "var(--green)" : "var(--red)" }}>{money(tot.profit * 30, cur)}</td>
          </tr>
        </tfoot>
      </table>
      {priceUsd <= 0 && (
        <div style={{ color: "var(--muted)", fontSize: 12, padding: "8px 12px" }}>
          {t("…جاري جلب سعر BTC — أو افتح «⚙ إعدادات الأرباح» وأدخل السعر يدوياً.")}
        </div>
      )}
    </div>
  );
}
