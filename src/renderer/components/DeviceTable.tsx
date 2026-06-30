import React from "react";
import type { DeviceView, SortKey, SortState } from "../state/store";
import { sortViews } from "../state/store";
import type { Device } from "../../core/model/device";
import type { ControlCommand } from "../../core/drivers/types";
import { DeviceRow } from "./DeviceRow";
import { t } from "../i18n";

interface Props {
  views: DeviceView[];
  selectedIds: Set<string>;
  sort: SortState;
  onSort: (key: SortKey) => void;
  onToggle: (id: string) => void;
  onCommand: (id: string, cmd: ControlCommand) => void;
  onDeleteDevice: (deviceId: string) => void;
  onDiagnose: (device: Device) => void;
}

const COLUMNS: Array<{ key: SortKey | null; label: string }> = [
  { key: "name", label: "الجهاز" },
  { key: "status", label: "الحالة" },
  { key: "firmware", label: "الفرمور" },
  { key: "hashrate", label: "الهاش" },
  { key: "temp", label: "الحرارة" },
  { key: "fan", label: "المروحة" },
  { key: "worker", label: "الوركر" },
  { key: "uptime", label: "التشغيل" },
  { key: null, label: "إجراء" },
];

export function DeviceTable({
  views,
  selectedIds,
  sort,
  onSort,
  onToggle,
  onCommand,
  onDeleteDevice,
  onDiagnose,
}: Props): React.ReactElement {
  const sorted = sortViews(views, sort);
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th></th>
          {COLUMNS.map((c) =>
            c.key ? (
              <th
                key={c.key}
                className="sortable"
                onClick={() => onSort(c.key as SortKey)}
                title={t("اضغط للترتيب")}
              >
                {t(c.label)}
                <span className="sortarrow">{sort.key === c.key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</span>
              </th>
            ) : (
              <th key={c.label}>{t(c.label)}</th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {sorted.map((v) => (
          <DeviceRow
            key={v.device.id}
            view={v}
            selected={selectedIds.has(v.device.id)}
            onToggle={onToggle}
            onCommand={onCommand}
            onDelete={onDeleteDevice}
            onDiagnose={onDiagnose}
          />
        ))}
      </tbody>
    </table>
  );
}
