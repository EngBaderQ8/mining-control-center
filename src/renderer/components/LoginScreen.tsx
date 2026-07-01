import React, { useState } from "react";
import { api } from "../ipc";
import { DEFAULT_SERVER_ADDR } from "../../shared/api";
import { t } from "../i18n";

export function LoginScreen({ onAuthed }: { onAuthed: () => void }): React.ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (busy) return;
    setError(null);
    if (!email.trim() || !password) {
      setError(t("عبّئ كل الحقول"));
      return;
    }
    setBusy(true);
    try {
      // The server address is fixed and filled automatically — staff only sign in.
      await api.setServer(DEFAULT_SERVER_ADDR, "");
      const r = mode === "login" ? await api.login(email.trim(), password) : await api.signup(email.trim(), password);
      if (r.ok) onAuthed();
      else setError(r.error ?? t("فشل"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app" style={{ maxWidth: 420 }}>
      <h2 style={{ textAlign: "center" }}>{t("مركز التحكم بالتعدين")}</h2>
      <div className="dialog" style={{ width: "100%" }}>
        <h3>{mode === "login" ? t("تسجيل الدخول") : t("إنشاء حساب")}</h3>

        <div className="field">
          <label>{t("البريد")}</label>
          <input
            className="input"
            value={email}
            autoFocus
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </div>
        <div className="field">
          <label>{t("كلمة المرور")}</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </div>

        {error && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>{error}</div>}

        <div className="actions">
          <button className="btn primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "..." : mode === "login" ? t("دخول") : t("تسجيل")}
          </button>
          <button className="btn" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
            {mode === "login" ? t("ما عندي حساب — تسجيل") : t("عندي حساب — دخول")}
          </button>
        </div>
      </div>
    </div>
  );
}
