import React, { useState } from "react";
import type { Site, Firmware } from "../../core/model/device";
import { t } from "../i18n";

export interface NewDevicePayload {
  siteId: string;
  siteName: string; // used when siteId === "__new__"
  name: string;
  model: string;
  firmware: Firmware;
  host: string;
  apiPort: number;
  controlPort: number;
  secret: string;
}

interface Props {
  sites: Site[];
  onClose: () => void;
  onSubmit: (p: NewDevicePayload) => void;
}

export function AddDeviceDialog({ sites, onClose, onSubmit }: Props): React.ReactElement {
  const [p, setP] = useState<NewDevicePayload>({
    siteId: sites[0]?.id ?? "__new__",
    siteName: "",
    name: "",
    model: "S19",
    firmware: "stock",
    host: "",
    apiPort: 4028,
    controlPort: 80,
    secret: "",
  });

  const set = <K extends keyof NewDevicePayload>(k: K, v: NewDevicePayload[K]): void =>
    setP((prev) => ({ ...prev, [k]: v }));

  // Keep the previous valid port if the field is cleared/invalid (never store NaN).
  const setPort = (k: "apiPort" | "controlPort", raw: string): void => {
    const n = parseInt(raw, 10);
    setP((prev) => ({ ...prev, [k]: Number.isFinite(n) ? n : prev[k] }));
  };

  const portOk = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 65535;
  const valid =
    p.host.trim() !== "" &&
    p.name.trim() !== "" &&
    portOk(p.apiPort) &&
    portOk(p.controlPort) &&
    (p.siteId !== "__new__" || p.siteName.trim() !== "");

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{t("إضافة جهاز ASIC")}</h3>

        <div className="field">
          <label>{t("الموقع")}</label>
          <select className="select" value={p.siteId} onChange={(e) => set("siteId", e.target.value)}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="__new__">{t("+ موقع جديد…")}</option>
          </select>
        </div>

        {p.siteId === "__new__" && (
          <div className="field">
            <label>{t("اسم الموقع الجديد")}</label>
            <input className="input" value={p.siteName} onChange={(e) => set("siteName", e.target.value)} />
          </div>
        )}

        <div className="field">
          <label>{t("اسم الجهاز")}</label>
          <input className="input" value={p.name} onChange={(e) => set("name", e.target.value)} />
        </div>

        <div className="field">
          <label>{t("الموديل")}</label>
          <input className="input" value={p.model} onChange={(e) => set("model", e.target.value)} />
        </div>

        <div className="field">
          <label>{t("الفرمور")}</label>
          <select
            className="select"
            value={p.firmware}
            onChange={(e) => set("firmware", e.target.value as Firmware)}
          >
            <option value="stock">Stock (Bitmain)</option>
            <option value="braiins">Braiins OS+</option>
            <option value="vnish">Vnish</option>
            <option value="luxos">LuxOS</option>
          </select>
        </div>

        <div className="field">
          <label>{t("عنوان الجهاز المحلي (IP على الشبكة)")}</label>
          <input
            className="input"
            placeholder={t("مثال: 192.168.1.50")}
            value={p.host}
            onChange={(e) => set("host", e.target.value)}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>{t("منفذ API (افتراضي 4028)")}</label>
            <input
              className="input"
              type="number"
              value={p.apiPort}
              onChange={(e) => setPort("apiPort", e.target.value)}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>{t("منفذ التحكم (80 ستوك / 4028 معدّل)")}</label>
            <input
              className="input"
              type="number"
              value={p.controlPort}
              onChange={(e) => setPort("controlPort", e.target.value)}
            />
          </div>
        </div>

        <div className="field">
          <label>{t("بيانات الدخول (اختياري — مثال root:root)")}</label>
          <input
            className="input"
            type="password"
            value={p.secret}
            onChange={(e) => set("secret", e.target.value)}
          />
        </div>

        <div className="actions">
          <button className="btn primary" disabled={!valid} onClick={() => onSubmit(p)}>
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
