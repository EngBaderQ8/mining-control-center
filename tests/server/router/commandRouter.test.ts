import { describe, it, expect } from "vitest";
import { CommandRouter } from "../../../server/src/router/commandRouter";

describe("CommandRouter", () => {
  it("forwards to the owning agent and resolves on result", async () => {
    const router = new CommandRouter();
    const sent: unknown[] = [];
    router.attachAgent("ag1", (exec) => sent.push(exec));
    const p = router.routeCommand("ag1", {
      type: "command.exec",
      commandId: "c1",
      deviceId: "d1",
      command: "reboot",
    });
    expect(sent).toHaveLength(1);
    router.resolveResult("c1", { deviceId: "d1", ok: true });
    await expect(p).resolves.toMatchObject({ ok: true });
  });

  it("rejects when the agent is not connected", async () => {
    const router = new CommandRouter();
    await expect(
      router.routeCommand("ghost", {
        type: "command.exec",
        commandId: "c2",
        deviceId: "d",
        command: "reboot",
      }),
    ).rejects.toThrow(/agent not connected/);
  });
});
