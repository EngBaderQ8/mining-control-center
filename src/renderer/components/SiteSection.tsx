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
  const online = views.filter((v) => v.status && v.status.state !== "offline").length;
  const offline = views.length - online;
  const siteTHs = views.reduce((sum, v) => sum + (v.status?.hashrateTHs ?? 0), 0);
  const allOnline = online === views.length && views.length > 0;
  const siteState = online === 0 ? "offline" : allOnline ? "online" : "warning";

  // Stop a button click from also toggling the header's collapse.
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div className="site">
      <div
        className="sitehead clickable"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        title={collapsed ? "اضغط لعرض الأجهزة" : "اضغط لطيّ الموقع"}
        onClick={() => onToggleCollapse(site.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleCollapse(site.id);
          }
        }}
      >
        <span className={`chev ${collapsed ? "" : "open"}`}>▶</span>
        <span className={`dot ${siteState}`}></span>
        <span className="name">موقع: {site.name}</span>
        <span className="meta">
          · {views.length} جهاز · {online} شغّال
          {offline > 0 && <span className="off"> · {offline} غير متصل</span>} · {siteTHs.toFixed(0)} TH/s
        </span>
        <span className="spacer" style={{ marginInlineStart: "auto" }} />
        <button className="btn" onClick={stop(() => onSelectSite(views.map((v) => v.device.id)))}>
          تحديد كل الموقع
        </button>
        <button className="btn stop" onClick={stop(() => onDeleteSite(site.id, site.name))}>
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
