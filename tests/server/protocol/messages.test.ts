import { describe, it, expect } from "vitest";
import { isClientMessage } from "../../../server/src/protocol/messages";

describe("protocol messages", () => {
  it("accepts a well-formed command.send and rejects junk", () => {
    expect(
      isClientMessage({ type: "command.send", commandId: "c1", deviceId: "d1", command: "reboot" }),
    ).toBe(true);
    expect(isClientMessage({ type: "nope" })).toBe(false);
    expect(isClientMessage(null)).toBe(false);
  });
});
