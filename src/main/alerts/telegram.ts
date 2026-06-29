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

export interface TgUpdate {
  update_id: number;
  message?: { text?: string; chat?: { id?: number } };
}

/** Long-poll the bot for new messages from a given offset (for two-way control). */
export async function getUpdates(token: string, offset: number): Promise<TgUpdate[]> {
  try {
    const res = await request(
      `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=20`,
      { headersTimeout: 25000, bodyTimeout: 25000 },
    );
    if (res.statusCode < 200 || res.statusCode >= 300) {
      await res.body.text();
      return [];
    }
    const data = (await res.body.json()) as { ok?: boolean; result?: TgUpdate[] };
    return data.ok && Array.isArray(data.result) ? data.result : [];
  } catch {
    return [];
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
    if (res.statusCode < 200 || res.statusCode >= 300) {
      const body = await res.body.text();
      if (res.statusCode === 401 || res.statusCode === 404) return { error: "توكن غير صحيح" };
      return { error: `HTTP ${res.statusCode}: ${body.slice(0, 120)}` };
    }
    type Chat = { chat?: { id?: number } };
    let data: {
      ok?: boolean;
      result?: Array<{ message?: Chat; edited_message?: Chat; channel_post?: Chat; edited_channel_post?: Chat }>;
    };
    try {
      data = (await res.body.json()) as typeof data;
    } catch {
      return { error: "رد غير متوقع من تيليجرام — حاول مرة ثانية" };
    }
    if (!data.ok) return { error: "توكن غير صحيح" };
    const updates = data.result ?? [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const u = updates[i];
      const id =
        u?.message?.chat?.id ??
        u?.channel_post?.chat?.id ??
        u?.edited_message?.chat?.id ??
        u?.edited_channel_post?.chat?.id;
      if (id !== undefined) return { chatId: String(id) };
    }
    return { error: "ما لقيت رسالة — أرسل أي رسالة للبوت بتيليجرام ثم جرّب مرة ثانية" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
