import React from "react";
import type { SiteGroup, SortKey, SortState } from "../state/store";
import type { ControlCommand } from "../../core/drivers/types";
import { DeviceTable } from "./DeviceTable";
import { t } from "../i18n";

interface Props {
  group: SiteGroup;
  selectedIds: Set<string>;
  collapsed: boolean;
  sort: SortState;
  onSort: (key: SortKey) => void;
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
  sort,
  onSort,
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
          title={collapsed ? t("اضغط لعرض الأجهزة") : t("اضغط لطيّ الموقع")}
          onClick={() => onToggleCollapse(site.id)}
        >
          <span className={`chev ${collapsed ? "" : "open"}`}>◀</span>
          <span className={`dot ${siteState}`}></span>
          <span className="name">{t("موقع: {name}", { name: site.name })}</span>
          <span className="meta">
            {t("· {count} جهاز · {online} شغّال", { count: views.length, online })}
            {warning > 0 && <span className="warn">{t(" · {warning} تحذير", { warning })}</span>}
            {offline > 0 && <span className="off">{t(" · {offline} غير متصل", { offline })}</span>} · {siteTHs.toFixed(0)} TH/s
          </span>
        </button>
        <span className="spacer" style={{ marginInlineStart: "auto" }} />
        <button className="btn" onClick={() => onSelectSite(views.map((v) => v.device.id))}>
          {t("تحديد كل الموقع")}
        </button>
        <button className="btn stop" onClick={() => onDeleteSite(site.id, site.name)}>
          {t("🗑 حذف الموقع")}
        </button>
      </div>
      {!collapsed && (
        <DeviceTable
          views={views}
          selectedIds={selectedIds}
          sort={sort}
          onSort={onSort}
          onToggle={onToggle}
          onCommand={onCommand}
          onDeleteDevice={onDeleteDevice}
        />
      )}
    </div>
  );
}
