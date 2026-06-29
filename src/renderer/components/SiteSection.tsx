import React from "react";
import type { SiteGroup } from "../state/store";
import type { ControlCommand } from "../../core/drivers/types";
import { DeviceTable } from "./DeviceTable";

interface Props {
  group: SiteGroup;
  selectedIds: Set<string>;
  collapsed: boolean;
  onToggleCollapse: (siteId: string) => void;
  onToggle: (id: string) => void;
  onSelectSite: (ids: string[]) => void;
  onCommand: (id: string, cmd: ControlCommand) => void;
  onDeleteSite: (siteId: string, siteName: string) => void;
  onDeleteDevice: (deviceId: string) => void;
}

export function SiteSection({
  group,
  selectedIds,
  collapsed,
  onToggleCollapse,
  onToggle,
  onSelectSite,
  onCommand,
  onDeleteSite,
  onDeleteDevice,
}: Props): React.ReactElement {
  const { site, views } = group;
  // Three explicit, non-overlapping counts that sum to the total.
  const online = views.filter((v) => v.status?.state === "online").length;
  const warning = views.filter((v) => v.status?.state === "warning").length;
  const offline = views.length - online - warning;
  const siteTHs = views.reduce((sum, v) => sum + (v.status?.hashrateTHs ?? 0), 0);
  const siteState = online + warning === 0 ? "offline" : offline + warning > 0 ? "warning" : "online";

  return (
    <div className="site">
      <div className="sitehead">
        {/* Only the title area is the disclosure toggle — a real <button> so
            keyboard works natively and the action buttons are NOT nested in it. */}
        <button
          type="button"
          className="sitetoggle"
          aria-expanded={!collapsed}
          title={collapsed ? "اضغط لعرض الأجهزة" : "اضغط لطيّ الموقع"}
          onClick={() => onToggleCollapse(site.id)}
        >
          <span className={`chev ${collapsed ? "" : "open"}`}>◀</span>
          <span className={`dot ${siteState}`}></span>
          <span className="name">موقع: {site.name}</span>
          <span className="meta">
            · {views.length} جهاز · {online} شغّال
            {warning > 0 && <span className="warn"> · {warning} تحذير</span>}
            {offline > 0 && <span className="off"> · {offline} غير متصل</span>} · {siteTHs.toFixed(0)} TH/s
          </span>
        </button>
        <span className="spacer" style={{ marginInlineStart: "auto" }} />
        <button className="btn" onClick={() => onSelectSite(views.map((v) => v.device.id))}>
          تحديد كل الموقع
        </button>
        <button className="btn stop" onClick={() => onDeleteSite(site.id, site.name)}>
          🗑 حذف الموقع
        </button>
      </div>
      {!collapsed && (
        <DeviceTable
          views={views}
          selectedIds={selectedIds}
          onToggle={onToggle}
          onCommand={onCommand}
          onDeleteDevice={onDeleteDevice}
        />
      )}
    </div>
  );
}
