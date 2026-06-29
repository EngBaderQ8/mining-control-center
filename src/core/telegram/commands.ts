import type { Device, Site } from "../model/device";

export type BotAction =
  | "status"
  | "report"
  | "sites"
  | "help"
  | "stop"
  | "start"
  | "restart"
  | "reboot"
  | "unknown";

export interface BotCommand {
  action: BotAction;
  target?: string; // device/site name, or "all"
}

const normalize = (s: string): string =>
  s
    .replace(/[ً-ٰٟ]/g, "") // strip Arabic diacritics
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim()
    .toLowerCase();

// keyword -> action, with the keyword(s) that introduce a target.
const VERBS: Array<{ action: BotAction; words: string[] }> = [
  { action: "stop", words: ["اوقف", "ايقاف", "وقف", "stop"] },
  { action: "start", words: ["شغل", "تشغيل", "start"] },
  { action: "restart", words: ["اعد تشغيل", "اعاده تشغيل", "ريستارت", "restart"] },
  { action: "reboot", words: ["ريبوت", "اعد الجهاز", "reboot"] },
];
const SIMPLE: Array<{ action: BotAction; words: string[] }> = [
  { action: "status", words: ["الوضع", "وضع", "الحاله", "حاله", "status", "ستاتس"] },
  { action: "report", words: ["تقرير", "report", "ملخص"] },
  { action: "sites", words: ["المواقع", "مواقع", "sites"] },
  { action: "help", words: ["مساعده", "اوامر", "help", "؟", "?"] },
];

const ALL_WORDS = ["الكل", "كل", "all"];

/**
 * Parse a free-text Telegram message into a farm command. Arabic + a few English
 * keywords; tolerant of diacritics and letter variants. Returns the action and an
 * optional target name ("all" for the whole fleet).
 */
export function parseBotCommand(text: string): BotCommand {
  const t = normalize(text);
  if (!t) return { action: "unknown" };

  // Action verbs that take a target (stop/start/restart/reboot).
  for (const v of VERBS) {
    for (const w of v.words) {
      if (t === w || t.startsWith(w + " ")) {
        const rest = t.slice(w.length).trim();
        const target = ALL_WORDS.includes(rest) ? "all" : rest || undefined;
        return { action: v.action, target };
      }
    }
  }
  // Simple, no-target commands.
  for (const s of SIMPLE) {
    for (const w of s.words) {
      if (t === w || t.startsWith(w)) return { action: s.action };
    }
  }
  return { action: "unknown" };
}

/**
 * Resolve a command target to devices: "all" → everything; a site-name match →
 * that site's devices; otherwise devices whose name contains the target (e.g. a
 * model name or the trailing number like "105").
 */
export function matchDevices(target: string, sites: Site[], devices: Device[]): Device[] {
  const t = normalize(target);
  if (!t) return [];
  if (t === "all" || ALL_WORDS.includes(t)) return devices;
  const siteIds = new Set(sites.filter((s) => normalize(s.name).includes(t)).map((s) => s.id));
  const bySite = devices.filter((d) => siteIds.has(d.siteId));
  if (bySite.length) return bySite;
  return devices.filter((d) => normalize(d.name).includes(t));
}
