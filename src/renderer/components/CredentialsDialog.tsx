import React, { useState } from "react";
import { t } from "../i18n";

interface Props {
  count: number;
  onClose: () => void;
  onSubmit: (user: string, pass: string) => void;
}

/** Set the web/control login (user:pass) for the selected miners — needed when
 *  the miners aren't on the default root:root. */
export function CredentialsDialog({ count, onClose, onSubmit }: Props): React.ReactElement {
  const [user, setUser] = useState("root");
  const [pass, setPass] = useState("");

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 420 }}>
        <h3>🔑 {t("بيانات دخول الأجهزة")} ({count})</h3>
        <p className="subtitle" style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          {t(
            "نفس اسم المستخدم وكلمة المرور اللي تدخل فيها واجهة الأسيك (المتصفح). لازمة عشان أوامر التشغيل/الإيقاف/إعادة التشغيل تشتغل. تُحفظ مشفّرة على جهازك فقط.",
          )}
        </p>

        <div className="field">
          <label>{t("اسم المستخدم")}</label>
          <input className="input" value={user} onChange={(e) => setUser(e.target.value)} />
        </div>
        <div className="field">
          <label>{t("كلمة المرور")}</label>
          <input
            className="input"
            type="password"
            placeholder={t("كلمة مرور واجهة الأسيك")}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </div>

        <div className="actions">
          <button
            className="btn primary"
            disabled={!user.trim()}
            onClick={() => onSubmit(user.trim(), pass)}
          >
            {t("حفظ لكل المحدد")} ({count})
          </button>
          <button className="btn" onClick={onClose}>
            {t("إلغاء")}
          </button>
        </div>
      </div>
    </div>
  );
}
