import React, { useEffect, useState } from "react";
import { api } from "../ipc";
import type { TelegramSettings } from "../../shared/api";

export function TelegramDialog({ onClose }: { onClose: () => void }): React.ReactElement {
  const [s, setS] = useState<TelegramSettings>({ enabled: false, token: "", chatId: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void api.getTelegram().then(setS);
  }, []);

  const detect = async (): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.detectChatId(s.token.trim());
      if (r.chatId) {
        setS((p) => ({ ...p, chatId: r.chatId! }));
        setMsg(`✓ تم كشف رقم المحادثة: ${r.chatId}`);
      } else setMsg(`⚠ ${r.error ?? "ما قدر يكشف"}`);
    } finally {
      setBusy(false);
    }
  };

  const test = async (): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.testTelegram({ ...s, token: s.token.trim(), chatId: s.chatId.trim() });
      setMsg(r.ok ? "✅ وصلتك رسالة الاختبار على تيليجرام؟ معناه التنبيهات تشتغل!" : `⚠ فشل: ${r.error ?? ""}`);
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<void> => {
    await api.setTelegram({ ...s, token: s.token.trim(), chatId: s.chatId.trim() });
    onClose();
  };

  const report = async (): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      // Save first so the report uses the latest settings.
      await api.setTelegram({ ...s, token: s.token.trim(), chatId: s.chatId.trim() });
      const r = await api.sendDailyReport();
      setMsg(r.ok ? "✅ أُرسل التقرير اليومي على تيليجرام — شوف جوالك." : `⚠ ${r.error ?? ""}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
        <h3>🔔 تنبيهات الجوال عبر تيليجرام</h3>
        <p className="subtitle" style={{ fontSize: 13, color: "var(--muted)", marginTop: 0 }}>
          يوصلك إشعار على جوالك فوراً لما يتوقف جهاز أو يسخن أو ينزل الهاش.
        </p>

        <ol style={{ fontSize: 12.5, color: "var(--muted)", lineHeight: 1.9, paddingInlineStart: 18 }}>
          <li>افتح تيليجرام، ابحث عن <b>@BotFather</b>، أرسل <b>/newbot</b> واتبع الخطوات.</li>
          <li>بيعطيك <b>توكن</b> (نص طويل) — انسخه هنا تحت.</li>
          <li>افتح بوتك بتيليجرام وأرسل له أي رسالة (مثلاً «مرحبا»).</li>
          <li>اضغط «كشف رقم المحادثة تلقائياً» ثم «اختبار».</li>
        </ol>

        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={s.enabled}
              onChange={(e) => setS({ ...s, enabled: e.target.checked })}
            />{" "}
            تفعيل تنبيهات تيليجرام
          </label>
        </div>
        <div className="field">
          <label>توكن البوت (Bot Token)</label>
          <input
            className="input"
            placeholder="123456789:ABCdef..."
            value={s.token}
            onChange={(e) => setS({ ...s, token: e.target.value })}
          />
        </div>
        <div className="field">
          <label>رقم المحادثة (Chat ID)</label>
          <input
            className="input"
            placeholder="اضغط الكشف التلقائي تحت"
            value={s.chatId}
            onChange={(e) => setS({ ...s, chatId: e.target.value })}
          />
        </div>

        {msg && <div style={{ fontSize: 12.5, margin: "8px 0", lineHeight: 1.7 }}>{msg}</div>}

        <div className="actions">
          <button className="btn" disabled={busy || !s.token.trim()} onClick={() => void detect()}>
            🔎 كشف رقم المحادثة تلقائياً
          </button>
          <button className="btn" disabled={busy || !s.token.trim() || !s.chatId.trim()} onClick={() => void test()}>
            📨 اختبار
          </button>
          <button className="btn" disabled={busy || !s.token.trim() || !s.chatId.trim()} onClick={() => void report()}>
            📊 أرسل تقرير الآن
          </button>
        </div>
        <p style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
          📊 لما تفعّل تيليجرام، يوصلك <b>تقرير يومي تلقائي</b> بملخص الإنتاج والمشاكل.
        </p>
        <div className="actions" style={{ marginTop: 6 }}>
          <button className="btn primary" disabled={busy} onClick={() => void save()}>
            حفظ
          </button>
          <button className="btn" disabled={busy} onClick={onClose}>
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
