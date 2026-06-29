import React from "react";
import type { SiteGroup, DeviceView } from "../state/store";
import { t } from "../i18n";

/** Tile colour by temperature (or grey when offline) — a farm-floor heat view. */
function tileColor(v: DeviceView): string {
  const s = v.status;
  if (!s || s.state === "offline") return "#3a3d44";
  const t = s.maxTempC;
  if (t <= 0) return "#3a3d44"; // online but no temp reading — grey (matches the "—" + legend)
  if (t < 65) return "#2f9e54"; // cool — green
  if (t < 72) return "#7fb01e"; // ok
  if (t < 80) return "#d4a017"; // warm — amber
  if (t < 88) return "#e6731c"; // hot — orange
  return "#d23b3b"; // very hot — red
}

function shortName(name: string): string {
  const m = /(\d+)\s*$/.exec(name);
  return m ? m[1]! : name.slice(-4);
}

export function Heatmap({ groups }: { groups: SiteGroup[] }): React.ReactElement {
  return (
    <div>
      <div className="heatlegend">
        <span>{t("بارد")}</span>
        <i style={{ background: "#2f9e54" }} />
        <i style={{ background: "#7fb01e" }} />
        <i style={{ background: "#d4a017" }} />
        <i style={{ background: "#e6731c" }} />
        <i style={{ background: "#d23b3b" }} />
        <span>{t("ساخن")}</span>
        <i style={{ background: "#3a3d44" }} />
        <span>{t("غير متصل")}</span>
      </div>
      {groups.map((g) => (
        <div className="site" key={g.site.id} style={{ padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>
            {t("موقع: {name}", { name: g.site.name })} <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 12 }}>
              {t("· {count} جهاز", { count: g.views.length })}
            </span>
          </div>
          <div className="heatgrid">
            {g.views.map((v) => {
              const s = v.status;
              return (
                <div
                  key={v.device.id}
                  className="heattile"
                  style={{ background: tileColor(v) }}
                  title={t("{name}\nالحالة: {state}\nالحرارة: {temp}°C\nالهاش: {hash}\nالوركر: {worker}", {
                    name: v.device.name,
                    state: s?.state ?? t("غير متصل"),
                    temp: s?.maxTempC ?? "—",
                    hash: s ? s.hashrateTHs.toFixed(1) + " TH" : "—",
                    worker: s?.worker ?? "—",
                  })}
                >
                  <span className="hn">{shortName(v.device.name)}</span>
                  <span className="ht">{s && s.maxTempC > 0 ? `${s.maxTempC}°` : "—"}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
