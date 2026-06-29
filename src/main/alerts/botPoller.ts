import type { Device, DeviceStatus, Site } from "../../core/model/device";
import type { ControlCommand } from "../../core/drivers/types";
import type { CommandOutcome } from "../../core/model/result";
import type { NetworkStats } from "../../core/profit/calc";
import type { TelegramSettings } from "../../shared/api";
import { parseBotCommand, matchDevices, type BotAction } from "../../core/telegram/commands";
import { buildDailyReport } from "../../core/report/daily";
import { getUpdates, sendTelegram } from "./telegram";

export interface BotContext {
  getSettings: () => TelegramSettings;
  getSnapshot: () => { sites: Site[]; devices: Device[]; statuses: DeviceStatus[] };
  sendCommand: (deviceId: string, command: ControlCommand) => Promise<CommandOutcome>;
  getNetworkStats: () => Promise<NetworkStats>;
}

const ACTION_TO_CMD: Partial<Record<BotAction, ControlCommand>> = {
  stop: "stopMining",
  start: "startMining",
  restart: "restartMining",
  reboot: "reboot",
};
const ACTION_LABEL: Partial<Record<BotAction, string>> = {
  stop: "إيقاف",
  start: "تشغيل",
  restart: "إعادة تشغيل",
  reboot: "ريبوت",
};

const HELP =
  "🤖 أوامر مركز التحكم بالتعدين:\n" +
  "• الوضع — ملخص المزرعة الآن\n" +
  "• تقرير — التقرير اليومي\n" +
  "• المواقع — قائمة المواقع\n" +
  "• أوقف <اسم/رقم/موقع> — مثل: أوقف 105 أو أوقف الرياض\n" +
  "• شغّل <…> · ريبوت <…> · إعادة تشغيل <…>\n" +
  "• أوقف الكل — لكل الأجهزة";

/** Build the reply for one incoming message (pure given the context callbacks). */
export async function handleBotMessage(text: string, ctx: BotContext): Promise<string> {
  const cmd = parseBotCommand(text);
  const snap = ctx.getSnapshot();
  switch (cmd.action) {
    case "help":
      return HELP;
    case "sites":
      return (
        snap.sites
          .map((s) => `📍 ${s.name}: ${snap.devices.filter((d) => d.siteId === s.id).length} جهاز`)
          .join("\n") || "لا توجد مواقع بعد."
      );
    case "status":
    case "report": {
      const net = await ctx.getNetworkStats();
      return buildDailyReport(snap.devices, snap.statuses, net, Date.now());
    }
    case "stop":
    case "start":
    case "restart":
    case "reboot": {
      if (!cmd.target) return "اكتب اسم الجهاز أو الموقع، مثل: أوقف 105";
      const matched = matchDevices(cmd.target, snap.sites, snap.devices);
      if (matched.length === 0) return `ما لقيت «${cmd.target}». اكتب «المواقع» لعرض الأسماء.`;
      const control = ACTION_TO_CMD[cmd.action]!;
      const results = await Promise.all(matched.map((d) => ctx.sendCommand(d.id, control)));
      const ok = results.filter((r) => r.ok).length;
      const err = results.find((r) => !r.ok)?.error;
      return (
        `${ACTION_LABEL[cmd.action]}: نجح ${ok}/${matched.length} جهاز` +
        (ok < matched.length && err ? `\n⚠ مثال خطأ: ${err}` : "")
      );
    }
    default:
      return "ما فهمت 🤔 اكتب «مساعدة» لعرض الأوامر.";
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Long-poll Telegram for incoming messages and act on them (two-way control).
 * Only messages from the configured chat id are honoured. Returns a stop fn.
 */
export function startBotPoller(ctx: BotContext): () => void {
  let offset = 0;
  let stopped = false;
  const loop = async (): Promise<void> => {
    while (!stopped) {
      const s = ctx.getSettings();
      if (!s.enabled || !s.token || !s.chatId) {
        await delay(5000);
        continue;
      }
      const updates = await getUpdates(s.token, offset);
      for (const u of updates) {
        offset = Math.max(offset, u.update_id + 1);
        const msg = u.message;
        if (!msg?.text || String(msg.chat?.id ?? "") !== String(s.chatId)) continue;
        try {
          const reply = await handleBotMessage(msg.text, ctx);
          await sendTelegram(s.token, s.chatId, reply);
        } catch {
          /* ignore one bad message */
        }
      }
      if (updates.length === 0) await delay(1500);
    }
  };
  void loop();
  return () => {
    stopped = true;
  };
}
