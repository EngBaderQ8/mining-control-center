import React, { useState } from "react";
import { t } from "../i18n";
import type { PowerProfile } from "../../core/drivers/types";

interface Props {
  count: number;
  onClose: () => void;
  onSubmit: (mode: PowerProfile) => void;
}

const MODES: Array<{ id: PowerProfile; label: string; desc: string }> = [
  { id: "normal", label: "⚙ عادي", desc: "الأداء الافتراضي للجهاز." },
  { id: "lowpower", label: "🔋 توفير الطاقة", desc: "هاش أقل وكهرباء أقل (أبرد)." },
  { id: "highperf", label: "🚀 أداء عالٍ", desc: "أقصى أداء (يحتاج فرمور معدّل — تجريبي)." },
];

export function ProfileDialog({ count, onClose, onSubmit }: Props): React.ReactElement {
  const [mode, setMode] = useState<PowerProfile>("normal");
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 440 }}>
        <h3>⚡ {t("وضع الطاقة ({count} جهاز)", { count })}</h3>
        <p className="subtitle" style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          ⚠ {t("تجريبي — يعتمد على فرمور الجهاز. جرّبه على")} <b>{t("جهاز واحد أول")}</b> {t("وتأكد إنه طبّق، قبل ما تطبّقه على الكل.")}
        </p>

        {MODES.map((m) => (
          <label
            key={m.id}
            className="field"
            style={{
              display: "flex",
              gap: 10,
              alignItems: "flex-start",
              cursor: "pointer",
              border: `1px solid ${mode === m.id ? "var(--blue)" : "var(--border)"}`,
              borderRadius: 8,
              padding: "10px 12px",
            }}
          >
            <input
              type="radio"
              name="mode"
              checked={mode === m.id}
              onChange={() => setMode(m.id)}
              style={{ marginTop: 3 }}
            />
            <span>
              <b>{t(m.label)}</b>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>{t(m.desc)}</div>
            </span>
          </label>
        ))}

        <div className="actions">
          <button className="btn primary" onClick={() => onSubmit(mode)}>
            {t("تطبيق على")} {count}
          </button>
          <button className="btn" onClick={onClose}>
            {t("إلغاء")}
          </button>
        </div>
      </div>
    </div>
  );
}
