import React from "react";
import type { DeviceView } from "../state/store";
import type { ControlCommand } from "../../core/drivers/types";
import { DeviceRow } from "./DeviceRow";

interface Props {
  views: DeviceView[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onCommand: (id: string, cmd: ControlCommand) => void;
  onDeleteDevice: (deviceId: string) => void;
}

export function DeviceTable({
  views,
  selectedIds,
  onToggle,
  onCommand,
  onDeleteDevice,
}: Props): React.ReactElement {
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th></th>
          <th>الجهاز</th>
          <th>الحالة</th>
          <th>الفرمور</th>
          <th>الهاش</th>
          <th>الحرارة</th>
          <th>المروحة</th>
          <th>الوركر</th>
          <th>التشغيل</th>
          <th>إجراء</th>
        </tr>
      </thead>
      <tbody>
        {views.map((v) => (
          <DeviceRow
            key={v.device.id}
            view={v}
            selected={selectedIds.has(v.device.id)}
            onToggle={onToggle}
            onCommand={onCommand}
            onDelete={onDeleteDevice}
          />
        ))}
      </tbody>
    </table>
  );
}
