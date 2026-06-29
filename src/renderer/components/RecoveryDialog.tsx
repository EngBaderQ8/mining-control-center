import React, { useEffect, useState } from "react";
import { api } from "../ipc";
import type { RecoverySettings } from "../../shared/api";

const DEFAULTS: RecoverySettings = {
  enabled: false,
  rebootOfflineMin: 10,
  overheatStopC: 90,
  cooldownMin: 20,
};

export function RecoveryDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const [s, setS] = useState<RecoverySettings>(DEFAULTS);

  useEffect(() => {
    void api.getRecovery().then((r) => setS(r ?? DEFAULTS));
  }, []);

  const num = (v: string, prev: number): number => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : prev;
  };
  const save = async (): Promise<void> => {
    await api.setRecovery(s);
    onClose();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 460 }}>
        <h3>🤖 الإصلاح الذاتي التلقائي</h3>
        <p className="subtitle" style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          يصلّح المزرعة بنفسه: يعيد تشغيل الجهاز اللي يطول أوفلاين، ويوقف الجهاز اللي يسخن زيادة —
          بدون تدخّل منك، ويرسل لك تنبيه بكل إجراء.
        </p>

        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={(e) => setS({ ...s, enabled: e.target.checked })}
            />{" "}
            تفعيل الإصلاح الذاتي
          </label>
        </div>
        <div className="field">
          <label>أعد تشغيل الجهاز إذا بقي غير متصل (دقائق)</label>
          <input
            className="input"
            type="number"
            min={1}
            max={1440}
            value={s.rebootOfflineMin}
            onChange={(e) => setS({ ...s, rebootOfflineMin: Math.max(1, num(e.target.value, s.rebootOfflineMin)) })}
          />
        </div>
        <div className="field">
          <label>أوقف الجهاز إذا تجاوزت حرارته (°C)</label>
          <input
            className="input"
            type="number"
            min={50}
            max={120}
            value={s.overheatStopC}
            onChange={(e) => setS({ ...s, overheatStopC: num(e.target.value, s.overheatStopC) })}
          />
        </div>
        <div className="field">
          <label>فترة تهدئة بين الإجراءات لنفس الجهاز (دقائق)</label>
          <input
            className="input"
            type="number"
            value={s.cooldownMin}
            onChange={(e) => setS({ ...s, cooldownMin: num(e.target.value, s.cooldownMin) })}
          />
        </div>

        <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
          ⚠ يحتاج أن يكون التحكم شغّالاً (باسورد الأجهزة صحيح). يعمل على لابتوب الموقع الموصول
          بالأجهزة.
        </p>

        <div className="actions">
          <button className="btn primary" onClick={() => void save()}>
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
