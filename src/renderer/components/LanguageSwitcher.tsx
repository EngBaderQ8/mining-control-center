import React from "react";
import { useLang } from "../i18n";

export function LanguageSwitcher(): React.ReactElement {
  const { lang, setLang } = useLang();
  return (
    <div className="langswitch">
      <button className={`btn ${lang === "ar" ? "primary" : ""}`} onClick={() => setLang("ar")}>
        العربية
      </button>
      <button className={`btn ${lang === "en" ? "primary" : ""}`} onClick={() => setLang("en")}>
        English
      </button>
    </div>
  );
}
