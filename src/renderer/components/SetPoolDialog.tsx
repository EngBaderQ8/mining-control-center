import React, { useState } from "react";
import { t } from "../i18n";

export interface PoolRow {
  url: string;
  user: string;
  pass: string;
}
export interface PoolInput {
  pools: PoolRow[]; // 1–3 filled pools (primary + optional backups)
  appendIp: boolean; // append the device IP's last number to each worker name
}

interface Props {
  count: number;
  onClose: () => void;
  onSubmit: (pool: PoolInput) => void;
}

const EMPTY: PoolRow = { url: "", user: "", pass: "x" };

export function SetPoolDialog({ count, onClose, onSubmit }: Props): React.ReactElement {
  const [pools, setPools] = useState<PoolRow[]>([{ ...EMPTY }, { ...EMPTY }, { ...EMPTY }]);
  // Default ON: the user types the ACCOUNT, and the app builds the worker name
  // (account.<ip-last-number>) for each device automatically.
  const [appendIp, setAppendIp] = useState(true);

  const upd = (i: number, field: keyof PoolRow, val: string): void =>
    setPools((ps) => ps.map((p, j) => (j === i ? { ...p, [field]: val } : p)));

  // At least the primary pool needs a url + user.
  const valid = pools[0]!.url.trim() !== "" && pools[0]!.user.trim() !== "";

  const submit = (): void => {
    const filled = pools
      .filter((p) => p.url.trim() !== "" && p.user.trim() !== "")
      .map((p) => ({ url: p.url.trim(), user: p.user.trim(), pass: p.pass.trim() || "x" }));
    onSubmit({ pools: filled, appendIp });
  };

  const titles = [t("البول الأساسي"), t("احتياطي ١ (اختياري)"), t("احتياطي ٢ (اختياري)")];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <h3>{t("تغيير البول لـ {count} جهاز", { count })}</h3>

        {pools.map((p, i) => (
          <div
            key={i}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 10,
              padding: "10px 12px",
              marginBottom: 10,
              background: i === 0 ? "var(--surface2)" : "transparent",
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 600, color: i === 0 ? "var(--accent)" : "var(--muted)", marginBottom: 6 }}>
              {titles[i]}
            </div>
            <div className="field" style={{ marginBottom: 6 }}>
              <input
                className="input"
                placeholder={t("عنوان البول (URL) — stratum+tcp://...")}
                value={p.url}
                onChange={(e) => upd(i, "url", e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                className="input"
                style={{ flex: 2 }}
                placeholder={t("الحساب / المحفظة (بدون وركر)")}
                value={p.user}
                onChange={(e) => upd(i, "user", e.target.value)}
              />
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder={t("كلمة المرور")}
                value={p.pass}
                onChange={(e) => upd(i, "pass", e.target.value)}
              />
            </div>
          </div>
        ))}

        <label style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13, cursor: "pointer", margin: "4px 2px 2px" }}>
          <input type="checkbox" checked={appendIp} onChange={(e) => setAppendIp(e.target.checked)} style={{ width: 17, height: 17, marginTop: 1 }} />
          <span>
            <b>{t("البرنامج يسمّي الوركر تلقائياً (آخر رقم الآي بي)")}</b>
            <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
              {t("تكتب الحساب فقط، والبرنامج يضيف وركر مميّز لكل جهاز من آخر رقم آي بيه.")}
            </div>
            {appendIp && (
              <div style={{ fontSize: 12.5, color: "var(--accent)", marginTop: 4, direction: "ltr", textAlign: "right" }}>
                {t("الناتج:")} <b style={{ fontFamily: "monospace" }}>{(pools[0]!.user.trim() || "account")}.101</b>{" "}
                <span style={{ color: "var(--muted)" }}>{t("(101 = آخر رقم آي بي الجهاز)")}</span>
              </div>
            )}
          </span>
        </label>

        <div className="actions">
          <button className="btn primary" disabled={!valid} onClick={submit}>
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
