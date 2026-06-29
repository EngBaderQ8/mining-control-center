import type { Device, DeviceStatus } from "../model/device";

export interface PollOptions {
  maxConcurrency: number;
  warnTempC: number;
  now: number;
}
export type PollFn = (device: Device) => Promise<DeviceStatus>;

export async function pollAll(
  devices: Device[],
  opts: PollOptions,
  poll: PollFn,
): Promise<DeviceStatus[]> {
  const results: DeviceStatus[] = [];
  let i = 0;
  async function worker(): Promise<void> {
    while (i < devices.length) {
      const device = devices[i++]!;
      const s = await poll(device);
      results.push(
        s.state === "online" && s.maxTempC >= opts.warnTempC ? { ...s, state: "warning" } : s,
      );
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(opts.maxConcurrency, devices.length) }, worker),
  );
  return results;
}
