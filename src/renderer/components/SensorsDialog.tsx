import React, { useState } from "react";
import { api } from "../ipc";
import { t } from "../i18n";
import type { SensorConfig, SensorReading } from "../../core/model/sensor";

type Row = SensorConfig & { reading?: SensorReading };

function readingText(r: SensorReading | undefined): { text: string; color: string } {
  if (!r) return { text: t("— لم يُقرأ بعد"), color: "var(--muted)" };
  if (!r.ok) return { text: t("⚠ لا يستجيب"), color: "var(--amber)" };
  const parts: string[] = [];
  if (r.tempC !== undefined) parts.push(`${r.tempC.toFixed(1)}°`);
  if (r.humidity !== undefined) parts.push(`${Math.round(r.humidity)}%`);
  if (r.battery !== undefined) parts.push(t("🔋{b}%", { b: Math.round(r.battery) }));
  const hot = r.tempC !== undefined && r.maxTempC ? r.tempC >= r.maxTempC : false;
  const humid = r.humidity !== undefined && r.maxHumidity ? r.humidity >= r.maxHumidity : false;
  return { text: parts.join(" · ") || t("✓"), color: hot || humid ? "var(--red)" : "var(--green)" };
}

export function SensorsDialog({
  siteId,
  siteName,
  initial,
  onClose,
  onSaved,
}: {
  siteId: string;
  siteName: string;
  initial: SensorReading[];
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((r) => ({ id: r.id, siteId, name: r.name, host: r.host, maxTempC: r.maxTempC, maxHumidity: r.maxHumidity, reading: r })),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const patch = (id: string, p: Partial<Row>): void => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const addRow = (): void =>
    setRows((rs) => [...rs, { id: crypto.randomUUID(), siteId, name: "", host: "", maxTempC: 45, maxHumidity: 0 }]);
  const removeRow = (id: string): void => setRows((rs) => rs.filter((r) => r.id !== id));
  const numOrUndef = (v: string): number | undefined => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    const list: SensorConfig[] = rows
      .filter((r) => r.host.trim())
      .map((r) => ({
        id: r.id,
        siteId,
        name: r.name.trim() || t("حسّاس"),
        host: r.host.trim(),
        ...(r.maxTempC ? { maxTempC: r.maxTempC } : {}),
        ...(r.maxHumidity ? { maxHumidity: r.maxHumidity } : {}),
      }));
    try {
      const res = await api.setSensorsAtSite(siteId, list);
      if (!res.ok) {
        setErr(res.error ?? t("تعذّر الحفظ"));
        return;
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 560, maxHeight: "88vh", overflow: "auto" }}>
        <h3>🌡️ {t("حسّاسات الغرفة — {name}", { name: siteName })}</h3>
        <p className="subtitle" style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 0, lineHeight: 1.7 }}>
          {t(
            "حسّاس Shelly على شبكة الموقع — لابتوب الموقع يقرأه ويحذّرك لو حرارة/رطوبة الغرفة تجاوزت الحد. نصيحة: شغّل Shelly Plus H&T على كيبل USB ليبقى صاحياً.",
          )}
        </p>

        <table className="tbl" style={{ fontSize: 12.5 }}>
          <thead>
            <tr>
              <th>{t("الاسم")}</th>
              <th>{t("IP الحسّاس")}</th>
              <th>{t("حد الحرارة °")}</th>
              <th>{t("حد الرطوبة %")}</th>
              <th>{t("القراءة")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rt = readingText(r.reading);
              return (
                <tr key={r.id}>
                  <td>
                    <input className="input" style={{ width: 110 }} value={r.name} placeholder={t("غرفة الحاويات")} onChange={(e) => patch(r.id, { name: e.target.value })} />
                  </td>
                  <td>
                    <input className="input" style={{ width: 120 }} value={r.host} placeholder="192.168.0.60" onChange={(e) => patch(r.id, { host: e.target.value })} />
                  </td>
                  <td>
                    <input className="input" type="number" style={{ width: 70 }} value={r.maxTempC ?? ""} onChange={(e) => patch(r.id, { maxTempC: numOrUndef(e.target.value) })} />
                  </td>
                  <td>
                    <input className="input" type="number" style={{ width: 70 }} value={r.maxHumidity ?? ""} onChange={(e) => patch(r.id, { maxHumidity: numOrUndef(e.target.value) })} />
                  </td>
                  <td style={{ color: rt.color, whiteSpace: "nowrap" }}>{rt.text}</td>
                  <td>
                    <button className="btn sm stop" title={t("حذف")} onClick={() => removeRow(r.id)}>
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--muted)", padding: 14 }}>
                  {t("ما فيه حسّاسات بعد — أضِف واحداً.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ marginTop: 8 }}>
          <button className="btn sm" onClick={addRow}>
            {t("+ إضافة حسّاس")}
          </button>
        </div>

        {err && <div style={{ color: "var(--red)", fontSize: 12.5, marginTop: 8 }}>{err}</div>}

        <div className="actions">
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            {busy ? t("…جاري الحفظ") : t("حفظ")}
          </button>
          <button className="btn" onClick={onClose}>
            {t("إغلاق")}
          </button>
        </div>
      </div>
    </div>
  );
}
