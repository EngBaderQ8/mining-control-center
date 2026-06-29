import React from "react";
import type { Filter } from "../state/store";
import { t } from "../i18n";

interface Props {
  filter: Filter;
  onChange: (f: Filter) => void;
  onAddDevice: () => void;
  onScan: () => void;
  onCheckUpdate: () => void;
  onTelegram: () => void;
  onRecovery: () => void;
}

export function Toolbar({
  filter,
  onChange,
  onAddDevice,
  onScan,
  onCheckUpdate,
  onTelegram,
  onRecovery,
}: Props): React.ReactElement {
  return (
    <div className="bar">
      <input
        className="input"
        placeholder={t("بحث باسم الجهاز / الموديل / الوركر…")}
        value={filter.text}
        onChange={(e) => onChange({ ...filter, text: e.target.value })}
        style={{ minWidth: 240 }}
      />
      <select
        className="select"
        value={filter.state}
        onChange={(e) => onChange({ ...filter, state: e.target.value as Filter["state"] })}
      >
        <option value="all">{t("كل الحالات")}</option>
        <option value="online">{t("شغّال")}</option>
        <option value="warning">{t("تحذير")}</option>
        <option value="offline">{t("غير متصل")}</option>
      </select>
      <select
        className="select"
        value={filter.firmware}
        onChange={(e) => onChange({ ...filter, firmware: e.target.value as Filter["firmware"] })}
      >
        <option value="all">{t("كل الفرمور")}</option>
        <option value="stock">Stock</option>
        <option value="braiins">Braiins</option>
        <option value="vnish">Vnish</option>
        <option value="luxos">LuxOS</option>
      </select>
      <span className="spacer" style={{ marginInlineStart: "auto" }} />
      <button className="btn primary" onClick={onScan}>
        🔍 {t("فحص الشبكة")}
      </button>
      <button className="btn" onClick={onAddDevice}>
        + {t("إضافة يدوي")}
      </button>
      <button className="btn" onClick={onTelegram} title={t("تنبيهات على جوالك عبر تيليجرام")}>
        🔔 {t("تنبيهات الجوال")}
      </button>
      <button className="btn" onClick={onRecovery} title={t("إصلاح ذاتي تلقائي للأجهزة")}>
        🤖 {t("الإصلاح الذاتي")}
      </button>
      <button className="btn" onClick={onCheckUpdate} title={t("تحقق من وجود تحديث")}>
        🔄 {t("تحديث")}
      </button>
    </div>
  );
}
