import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";
import type { ControlCommand } from "../drivers/types";

export interface BulkOptions {
  maxConcurrency: number;
}
export type ExecFn = (device: Device) => Promise<CommandOutcome>;

export async function runBulk(
  devices: Device[],
  _command: ControlCommand,
  opts: BulkOptions,
  exec: ExecFn,
): Promise<CommandOutcome[]> {
  const outcomes: CommandOutcome[] = [];
  let i = 0;
  async function worker(): Promise<void> {
    while (i < devices.length) {
      const device = devices[i++]!;
      try {
        outcomes.push(await exec(device));
      } catch (e) {
        outcomes.push({ deviceId: device.id, ok: false, error: (e as Error).message });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(opts.maxConcurrency, devices.length) }, worker),
  );
  return outcomes;
}
