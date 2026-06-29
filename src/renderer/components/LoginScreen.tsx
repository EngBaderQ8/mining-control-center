import React, { useState } from "react";
import { api } from "../ipc";

export function LoginScreen({ onAuthed }: { onAuthed: () => void }): React.ReactElement {
  const [serverAddr, setServerAddr] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setError(null);
    if (!serverAddr.trim() || !email.trim() || !password) {
      setError("عبّئ كل الحقول");
      return;
    }
    setBusy(true);
    try {
      await api.setServer(serverAddr.trim(), "");
      const r = mode === "login" ? await api.login(email.trim(), password) : await api.signup(email.trim(), password);
      if (r.ok) onAuthed();
      else setError(r.error ?? "فشل");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app" style={{ maxWidth: 420 }}>
      <h2 style={{ textAlign: "center" }}>مركز التحكم بالتعدين</h2>
      <div className="dialog" style={{ width: "100%" }}>
        <h3>{mode === "login" ? "تسجيل الدخول" : "إنشاء حساب"}</h3>

        <div className="field">
          <label>عنوان الخادم (IP:المنفذ)</label>
          <input className="input" placeholder="مثال: 203.0.113.5:8443" value={serverAddr} onChange={(e) => setServerAddr(e.target.value)} />
        </div>
        <div className="field">
          <label>البريد</label>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label>كلمة المرور</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        {error && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>{error}</div>}

        <div className="actions">
          <button className="btn primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "..." : mode === "login" ? "دخول" : "تسجيل"}
          </button>
          <button className="btn" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
            {mode === "login" ? "ما عندي حساب — تسجيل" : "عندي حساب — دخول"}
          </button>
        </div>
      </div>
    </div>
  );
}
