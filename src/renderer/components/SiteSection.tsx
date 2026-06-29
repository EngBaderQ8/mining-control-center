import React from "react";
import type { SiteGroup } from "../state/store";
import type { ControlCommand } from "../../core/drivers/types";
import { DeviceTable } from "./DeviceTable";

interface Props {
  group: SiteGroup;
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectSite: (ids: string[]) => void;
  onCommand: (id: string, cmd: ControlCommand) => void;
  onDeleteSite: (siteId: string, siteName: string) => void;
  onDeleteDevice: (deviceId: string) => void;
}

export function SiteSection({
  group,
  selectedIds,
  onToggle,
  onSelectSite,
  onCommand,
  onDeleteSite,
  onDeleteDevice,
}: Props): React.ReactElement {
  const { site, views } = group;
  const online = views.filter((v) => v.status && v.status.state !== "offline").length;
  const siteTHs = views.reduce((sum, v) => sum + (v.status?.hashrateTHs ?? 0), 0);
  const allOnline = online === views.length && views.length > 0;
  const siteState = online === 0 ? "offline" : allOnline ? "online" : "warning";

  return (
    <div className="site">
      <div className="sitehead">
        <span className={`dot ${siteState}`}></span>
        <span className="name">موقع: {site.name}</span>
        <span className="meta">
          · {views.length} جهاز · {online} شغّال · {siteTHs.toFixed(0)} TH/s
        </span>
        <span className="spacer" style={{ marginInlineStart: "auto" }} />
        <button className="btn" onClick={() => onSelectSite(views.map((v) => v.device.id))}>
          تحديد كل الموقع
        </button>
        <button className="btn stop" onClick={() => onDeleteSite(site.id, site.name)}>
          🗑 حذف الموقع
        </button>
      </div>
      <DeviceTable
        views={views}
        selectedIds={selectedIds}
        onToggle={onToggle}
        onCommand={onCommand}
        onDeleteDevice={onDeleteDevice}
      />
    </div>
  );
}
