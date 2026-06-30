import React from "react";
import { api } from "../ipc";
import { CONTACT } from "../../shared/api";
import { t } from "../i18n";

export function AboutDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 460 }}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>⛏️ {t("نبذة عن البرنامج")}</h3>

        <p style={{ fontSize: 14, lineHeight: 1.9, color: "var(--text)" }}>
          {t("مركز التحكم بالتعدين — برنامج احترافي لإدارة ومراقبة مزارع تعدين الـ ASIC من مكان واحد: مراقبة لحظية، أرباح، تشخيص الأعطال، وتحكّم كامل عن بُعد لكل المواقع.")}
        </p>
        <p style={{ fontSize: 13.5, color: "var(--muted)", marginTop: -4 }}>
          {t("تطوير وإشراف:")} <b style={{ color: "var(--accent)" }}>Dark Horse</b>
        </p>

        <div
          style={{
            marginTop: 10,
            padding: "12px 14px",
            borderRadius: 12,
            background: "var(--surface2)",
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 8 }}>
            {t("للتواصل والدعم:")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              className="btn"
              style={{ justifyContent: "flex-start", gap: 8 }}
              onClick={() => void api.openExternal(CONTACT.telegramUrl)}
            >
              📱 {t("تيليجرام:")} <b style={{ direction: "ltr" }}>{CONTACT.telegram}</b>
            </button>
            <button
              className="btn"
              style={{ justifyContent: "flex-start", gap: 8 }}
              onClick={() => void api.openExternal(CONTACT.whatsappUrl)}
            >
              💬 {t("واتساب:")} <b style={{ direction: "ltr" }}>{CONTACT.whatsapp}</b>
            </button>
          </div>
        </div>

        <div className="actions">
          <button className="btn" onClick={onClose}>
            {t("إغلاق")}
          </button>
        </div>
      </div>
    </div>
  );
}
