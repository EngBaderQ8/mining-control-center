import React, { useState } from "react";
import { t } from "../i18n";

export interface PoolInput {
  url: string;
  user: string;
  pass: string;
}

interface Props {
  count: number;
  onClose: () => void;
  onSubmit: (pool: PoolInput) => void;
}

export function SetPoolDialog({ count, onClose, onSubmit }: Props): React.ReactElement {
  const [url, setUrl] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("x");

  const valid = url.trim() !== "" && user.trim() !== "";

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{t("تغيير البول لـ {count} جهاز", { count })}</h3>

        <div className="field">
          <label>{t("عنوان البول (URL)")}</label>
          <input
            className="input"
            placeholder="stratum+tcp://pool.example.com:3333"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="field">
          <label>{t("الوركر / الحساب (User)")}</label>
          <input
            className="input"
            placeholder="account.worker"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </div>
        <div className="field">
          <label>{t("كلمة المرور (Pass)")}</label>
          <input className="input" value={pass} onChange={(e) => setPass(e.target.value)} />
        </div>

        <div className="actions">
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => onSubmit({ url: url.trim(), user: user.trim(), pass })}
          >
            {t("تطبيق")}
          </button>
          <button className="btn" onClick={onClose}>
            {t("إلغاء")}
          </button>
        </div>
      </div>
    </div>
  );
}
