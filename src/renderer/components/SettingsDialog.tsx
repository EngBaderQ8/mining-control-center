import React, { useEffect, useState } from "react";
import { api } from "../ipc";
import type { AppSettings } from "../../shared/api";
import { t } from "../i18n";

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "11px 0",
        borderBottom: "1px solid var(--border)",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, marginTop: 2, flex: "0 0 auto" }}
      />
      <span>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{label}</div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>{desc}</div>
      </span>
    </label>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const [s, setS] = useState<AppSettings | null>(null);

  useEffect(() => {
    void api.getAppSettings().then(setS);
  }, []);

  const update = (patch: Partial<AppSettings>): void => {
    setS((prev) => (prev ? { ...prev, ...patch } : prev)); // optimistic
    void api.setAppSettings(patch).then(setS); // authoritative result from main
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <h3>⚙️ {t("الإعدادات")}</h3>
        <p className="subtitle" style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          {t("خليه يراقب أجهزتك ٢٤ ساعة بدون ما تفتحه كل مرة.")}
        </p>

        {!s ? (
          <div style={{ color: "var(--muted)", padding: "16px 0", textAlign: "center" }}>
            {t("…تحميل")}
          </div>
        ) : (
          <div style={{ marginTop: 6 }}>
            <Toggle
              label={t("التشغيل التلقائي مع ويندوز")}
              desc={t("يضيف نفسه لبدء التشغيل، فيشتغل وحده كل ما يشتغل الجهاز.")}
              checked={s.launchAtStartup}
              onChange={(v) => update({ launchAtStartup: v })}
            />
            <Toggle
              label={t("يبدأ مصغّراً بالخلفية")}
              desc={t("لما يشتغل مع ويندوز، يبدأ مخفي بأيقونة شريط المهام بدون نافذة.")}
              checked={s.startMinimized}
              onChange={(v) => update({ startMinimized: v })}
            />
            <Toggle
              label={t("العمل بالخلفية عند الإغلاق")}
              desc={t("زر الإغلاق (✕) يخفي البرنامج للخلفية ويكمل المراقبة بدل ما يقفله. ترجعه من الأيقونة بجانب الساعة (أو Ctrl+Alt+M).")}
              checked={s.runInBackground}
              onChange={(v) => update({ runInBackground: v })}
            />
            <Toggle
              label={t("الاكتشاف التلقائي للأجهزة")}
              desc={t("يفحص شبكة كل موقع كل ١٠ دقائق ويضيف الماينرات الجديدة تلقائياً. ⚠️ على شبكات DHCP قد يضيف نسخاً مكرّرة لو تغيّر IP الجهاز — خلّه مطفياً وأضِف الأجهزة يدوياً بزر «فحص»، أو فعّله بعد ما تثبّت IP ثابت لكل ماينر.")}
              checked={s.autoDiscovery}
              onChange={(v) => update({ autoDiscovery: v })}
            />
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 12, lineHeight: 1.7 }}>
              {t("💡 للمتابعة ٢٤/٧: فعّل «التشغيل التلقائي» + «يبدأ مصغّراً». تلقاه دايماً بأيقونة بجانب ساعة ويندوز.")}
            </p>
          </div>
        )}

        <div className="actions">
          <button className="btn" onClick={onClose}>
            {t("إغلاق")}
          </button>
        </div>
      </div>
    </div>
  );
}
