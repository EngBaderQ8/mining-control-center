import type { CommandExec, ServerMessage, AgentOpExec } from "../protocol/messages";
import type { CommandOutcome } from "../../../src/core/model/result";

type Sender = (m: ServerMessage) => void;
interface Pending {
  resolve: (o: CommandOutcome) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
export interface AgentOpOutcome {
  ok: boolean;
  data?: string;
  error?: string;
}
interface PendingOp {
  resolve: (o: AgentOpOutcome) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CommandRouter {
  private agents = new Map<string, Sender>();
  private pending = new Map<string, Pending>();
  private pendingOps = new Map<string, PendingOp>();

  attachAgent(agentId: string, send: Sender): void {
    this.agents.set(agentId, send);
  }

  detachAgent(agentId: string): void {
    this.agents.delete(agentId);
  }

  /** Fire-and-forget send to a specific agent (no response promise) — used for the
   *  long-running firmware flash job, which reports back asynchronously, not within
   *  routeCommand's short timeout. Returns false if that agent isn't connected. */
  sendToAgent(agentId: string, m: ServerMessage): boolean {
    const send = this.agents.get(agentId);
    if (!send) return false;
    send(m);
    return true;
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

  /** Route a site-scoped management op to the owning agent and await its result.
   *  Longer timeout than routeCommand: these ops (probe/scan a whole subnet) can run
   *  for tens of seconds. */
  routeAgentOp(agentId: string, exec: AgentOpExec, timeoutMs = 120000): Promise<AgentOpOutcome> {
    const send = this.agents.get(agentId);
    if (!send) return Promise.reject(new Error("agent not connected"));
    return new Promise<AgentOpOutcome>((resolve, reject) => {
      if (this.pendingOps.has(exec.opId)) {
        reject(new Error("duplicate opId"));
        return;
      }
      const timer = setTimeout(() => {
        this.pendingOps.delete(exec.opId);
        reject(new Error("agent op timed out"));
      }, timeoutMs);
      this.pendingOps.set(exec.opId, { resolve, reject, timer });
      send(exec);
    });
  }

  resolveAgentOp(opId: string, outcome: AgentOpOutcome): void {
    const p = this.pendingOps.get(opId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pendingOps.delete(opId);
    p.resolve(outcome);
  }
}
