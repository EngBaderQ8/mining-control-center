import React from "react";
import type { DeviceView } from "../state/store";
import type { ControlCommand } from "../../core/drivers/types";
import { t } from "../i18n";

function fmtUptime(sec: number): string {
  if (sec <= 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d > 0 ? t("{d}ي {h}س", { d, h }) : t("{h}س", { h });
}

interface Props {
  view: DeviceView;
  selected: boolean;
  onToggle: (id: string) => void;
  onCommand: (id: string, cmd: ControlCommand) => void;
  onDelete: (id: string) => void;
}

export function DeviceRow({ view, selected, onToggle, onCommand, onDelete }: Props): React.ReactElement {
  const { device, status } = view;
  const state = status?.state ?? "offline";
  const warnTemp = status && status.maxTempC >= 80;
  return (
    <tr>
      <td>
        <input type="checkbox" checked={selected} onChange={() => onToggle(device.id)} />
      </td>
      <td>{device.name}</td>
      <td>
        <span className={`dot ${state}`}></span>{" "}
        {state === "online" ? t("شغّال") : state === "warning" ? t("تحذير") : t("غير متصل")}
      </td>
      <td>
        <span className="fw">{device.firmware}</span>
      </td>
      <td className={state === "offline" ? "red" : "green"}>
        {status ? `${status.hashrateTHs.toFixed(1)} TH` : "—"}
      </td>
      <td className={warnTemp ? "amber" : ""}>
        {status && status.maxTempC > 0 ? `${status.maxTempC}°C${warnTemp ? " ⚠" : ""}` : "—"}
      </td>
      <td>{status && status.fanRpm > 0 ? status.fanRpm : "—"}</td>
      <td>{status?.worker || "—"}</td>
      <td>{fmtUptime(status?.uptimeSec ?? 0)}</td>
      <td>
        <span className="rowact">
          <button
            className="iconbtn"
            title={t("إعادة تشغيل التعدين")}
            onClick={() => onCommand(device.id, "restartMining")}
          >
            ↻
          </button>
          <button
            className="iconbtn"
            title={t("إيقاف التعدين")}
            onClick={() => onCommand(device.id, "stopMining")}
          >
            ⏸
          </button>
          <button
            className="iconbtn"
            title="Reboot"
            onClick={() => onCommand(device.id, "reboot")}
          >
            ⟳
          </button>
          <button className="iconbtn" title={t("حذف الجهاز")} onClick={() => onDelete(device.id)}>
            🗑
          </button>
        </span>
      </td>
    </tr>
  );
}
