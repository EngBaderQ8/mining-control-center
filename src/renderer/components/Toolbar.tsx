import React from "react";
import type { Filter } from "../state/store";

interface Props {
  filter: Filter;
  onChange: (f: Filter) => void;
  onAddDevice: () => void;
  onScan: () => void;
  onCheckUpdate: () => void;
  onTelegram: () => void;
}

export function Toolbar({
  filter,
  onChange,
  onAddDevice,
  onScan,
  onCheckUpdate,
  onTelegram,
}: Props): React.ReactElement {
  return (
    <div className="bar">
      <input
        className="input"
        placeholder="بحث باسم الجهاز / الموديل / الوركر…"
        value={filter.text}
        onChange={(e) => onChange({ ...filter, text: e.target.value })}
        style={{ minWidth: 240 }}
      />
      <select
        className="select"
        value={filter.state}
        onChange={(e) => onChange({ ...filter, state: e.target.value as Filter["state"] })}
      >
        <option value="all">كل الحالات</option>
        <option value="online">شغّال</option>
        <option value="warning">تحذير</option>
        <option value="offline">غير متصل</option>
      </select>
      <select
        className="select"
        value={filter.firmware}
        onChange={(e) => onChange({ ...filter, firmware: e.target.value as Filter["firmware"] })}
      >
        <option value="all">كل الفرمور</option>
        <option value="stock">Stock</option>
        <option value="braiins">Braiins</option>
        <option value="vnish">Vnish</option>
        <option value="luxos">LuxOS</option>
      </select>
      <span className="spacer" style={{ marginInlineStart: "auto" }} />
      <button className="btn primary" onClick={onScan}>
        🔍 فحص الشبكة
      </button>
      <button className="btn" onClick={onAddDevice}>
        + إضافة يدوي
      </button>
      <button className="btn" onClick={onTelegram} title="تنبيهات على جوالك عبر تيليجرام">
        🔔 تنبيهات الجوال
      </button>
      <button className="btn" onClick={onCheckUpdate} title="تحقق من وجود تحديث">
        🔄 تحديث
      </button>
    </div>
  );
}
