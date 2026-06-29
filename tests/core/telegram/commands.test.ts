import { describe, it, expect } from "vitest";
import { parseBotCommand } from "../../../src/core/telegram/commands";

describe("parseBotCommand", () => {
  it("parses simple status/report/sites/help", () => {
    expect(parseBotCommand("الوضع").action).toBe("status");
    expect(parseBotCommand("وش الحالة")).toMatchObject({ action: "unknown" }); // doesn't start with a keyword
    expect(parseBotCommand("status").action).toBe("status");
    expect(parseBotCommand("تقرير").action).toBe("report");
    expect(parseBotCommand("المواقع").action).toBe("sites");
    expect(parseBotCommand("مساعدة").action).toBe("help");
    expect(parseBotCommand("؟").action).toBe("help");
  });

  it("parses stop/start/reboot with a target", () => {
    expect(parseBotCommand("أوقف 105")).toMatchObject({ action: "stop", target: "105" });
    expect(parseBotCommand("شغّل الرياض")).toMatchObject({ action: "start", target: "الرياض" });
    expect(parseBotCommand("ريبوت S19-101")).toMatchObject({ action: "reboot", target: "s19-101" });
    expect(parseBotCommand("stop all")).toMatchObject({ action: "stop", target: "all" });
    expect(parseBotCommand("أوقف الكل")).toMatchObject({ action: "stop", target: "all" });
  });

  it("treats diacritics and letter variants the same", () => {
    expect(parseBotCommand("أوْقِف ١٠٥".replace(/[١-٩]/g, (d) => String("١٢٣٤٥٦٧٨٩".indexOf(d) + 1))).action).toBe(
      "stop",
    );
    expect(parseBotCommand("ايقاف 102")).toMatchObject({ action: "stop", target: "102" });
  });

  it("returns unknown for gibberish", () => {
    expect(parseBotCommand("asdfgh").action).toBe("unknown");
    expect(parseBotCommand("").action).toBe("unknown");
  });
});
