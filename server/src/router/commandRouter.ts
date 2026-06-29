import type { CommandExec } from "../protocol/messages";
import type { CommandOutcome } from "../../../src/core/model/result";

type Sender = (exec: CommandExec) => void;
interface Pending {
  resolve: (o: CommandOutcome) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CommandRouter {
  private agents = new Map<string, Sender>();
  private pending = new Map<string, Pending>();

  attachAgent(agentId: string, send: Sender): void {
    this.agents.set(agentId, send);
  }

  detachAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  routeCommand(agentId: string, exec: CommandExec, timeoutMs = 15000): Promise<CommandOutcome> {
    const send = this.agents.get(agentId);
    if (!send) return Promise.reject(new Error("agent not connected"));
    return new Promise<CommandOutcome>((resolve, reject) => {
      // A duplicate in-flight commandId would orphan the first waiter; reject the
      // new one rather than silently overwriting the pending entry.
      if (this.pending.has(exec.commandId)) {
        reject(new Error("duplicate commandId"));
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(exec.commandId);
        reject(new Error("command timed out"));
      }, timeoutMs);
      this.pending.set(exec.commandId, { resolve, reject, timer });
      send(exec);
    });
  }

  resolveResult(commandId: string, outcome: CommandOutcome): void {
    const p = this.pending.get(commandId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(commandId);
    p.resolve(outcome);
  }
}
