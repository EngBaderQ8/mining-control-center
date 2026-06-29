import { request } from "undici";

export interface TgResult {
  ok: boolean;
  error?: string;
}

/** Send a message to a Telegram chat via the bot API. */
export async function sendTelegram(token: string, chatId: string, text: string): Promise<TgResult> {
  if (!token || !chatId) return { ok: false, error: "ناقص التوكن أو رقم المحادثة" };
  try {
    const res = await request(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      headersTimeout: 8000,
      bodyTimeout: 8000,
    });
    if (res.statusCode >= 200 && res.statusCode < 300) return { ok: true };
    const body = await res.body.text();
    return { ok: false, error: `HTTP ${res.statusCode}: ${body.slice(0, 140)}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Find the chat id of whoever last messaged the bot — so a non-technical user
 * just sends any message to their bot, then clicks "detect" instead of hunting
 * for their numeric id.
 */
export async function detectChatId(token: string): Promise<{ chatId?: string; error?: string }> {
  if (!token) return { error: "اكتب توكن البوت أولاً" };
  try {
    const res = await request(`https://api.telegram.org/bot${token}/getUpdates`, {
      headersTimeout: 8000,
      bodyTimeout: 8000,
    });
    const data = (await res.body.json()) as {
      ok?: boolean;
      result?: Array<{ message?: { chat?: { id?: number } } }>;
    };
    if (!data.ok) return { error: "توكن غير صحيح" };
    const updates = data.result ?? [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const id = updates[i]?.message?.chat?.id;
      if (id !== undefined) return { chatId: String(id) };
    }
    return { error: "ما لقيت رسالة — أرسل أي رسالة للبوت بتيليجرام ثم جرّب مرة ثانية" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
