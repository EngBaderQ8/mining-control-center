import React, { useState } from "react";
import type { Site, Firmware } from "../../core/model/device";

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

  const valid =
    p.host.trim() !== "" &&
    p.name.trim() !== "" &&
    (p.siteId !== "__new__" || p.siteName.trim() !== "");

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>إضافة جهاز ASIC</h3>

        <div className="field">
          <label>الموقع</label>
          <select className="select" value={p.siteId} onChange={(e) => set("siteId", e.target.value)}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="__new__">+ موقع جديد…</option>
          </select>
        </div>

        {p.siteId === "__new__" && (
          <div className="field">
            <label>اسم الموقع الجديد</label>
            <input className="input" value={p.siteName} onChange={(e) => set("siteName", e.target.value)} />
          </div>
        )}

        <div className="field">
          <label>اسم الجهاز</label>
          <input className="input" value={p.name} onChange={(e) => set("name", e.target.value)} />
        </div>

        <div className="field">
          <label>الموديل</label>
          <input className="input" value={p.model} onChange={(e) => set("model", e.target.value)} />
        </div>

        <div className="field">
          <label>الفرمور</label>
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
          <label>عنوان الجهاز المحلي (IP على الشبكة)</label>
          <input
            className="input"
            placeholder="مثال: 192.168.1.50"
            value={p.host}
            onChange={(e) => set("host", e.target.value)}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>منفذ API (افتراضي 4028)</label>
            <input
              className="input"
              type="number"
              value={p.apiPort}
              onChange={(e) => set("apiPort", Number(e.target.value))}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>منفذ التحكم (80 ستوك / 4028 معدّل)</label>
            <input
              className="input"
              type="number"
              value={p.controlPort}
              onChange={(e) => set("controlPort", Number(e.target.value))}
            />
          </div>
        </div>

        <div className="field">
          <label>بيانات الدخول (اختياري — مثال root:root)</label>
          <input
            className="input"
            type="password"
            value={p.secret}
            onChange={(e) => set("secret", e.target.value)}
          />
        </div>

        <div className="actions">
          <button className="btn primary" disabled={!valid} onClick={() => onSubmit(p)}>
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
