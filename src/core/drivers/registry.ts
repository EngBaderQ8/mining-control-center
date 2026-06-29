import type { Firmware } from "../model/device";
import type { DeviceDriver } from "./types";
import { StockDriver } from "./stock";
import { BraiinsDriver } from "./braiins";
import { VnishDriver } from "./vnish";
import { LuxOsDriver } from "./luxos";

const drivers: Record<Firmware, DeviceDriver> = {
  stock: new StockDriver(),
  braiins: new BraiinsDriver(),
  vnish: new VnishDriver(),
  luxos: new LuxOsDriver(),
};

export function getDriver(f: Firmware): DeviceDriver {
  return drivers[f];
}
