import React, { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./ipc";
import type { Device, DeviceStatus, Site } from "../core/model/device";
import type { ControlCommand } from "../core/drivers/types";
import {
  computeSummary,
  groupBySite,
  EMPTY_FILTER,
  type Filter,
} from "./state/store";
import { SummaryBar } from "./components/SummaryBar";
import { Toolbar } from "./components/Toolbar";
import { BulkActionBar } from "./components/BulkActionBar";
import { SiteSection } from "./components/SiteSection";
import { AddDeviceDialog, type NewDevicePayload } from "./components/AddDeviceDialog";

const DESTRUCTIVE: ReadonlySet<ControlCommand> = new Set(["stopMining", "reboot"]);
const CMD_LABEL: Record<ControlCommand, string> = {
  startMining: "تشغيل التعدين",
  restartMining: "إعادة تشغيل التعدين",
  stopMining: "إيقاف التعدين",
  reboot: "إعادة تشغيل الجهاز (Reboot)",
};

export function App(): React.ReactElement {
  const [sites, setSites] = useState<Site[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [statusById, setStatusById] = useState<Map<string, DeviceStatus>>(new Map());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const reload = useCallback(async () => {
    const snap = await api.getSnapshot();
    setSites(snap.sites);
    setDevices(snap.devices);
    setStatusById((prev) => {
      const next = new Map(prev);
      for (const s of snap.statuses) next.set(s.deviceId, s);
      return next;
    });
  }, []);

  useEffect(() => {
    void reload();
    void api.startMonitoring();
    const offStatuses = api.onStatuses((statuses) => {
      setStatusById((prev) => {
        const next = new Map(prev);
        for (const s of statuses) next.set(s.deviceId, s);
        return next;
      });
    });
    const offAlerts = api.onAlerts((alerts) => {
      if (alerts.length) showToast(`⚠ ${alerts.length} تنبيه: ${alerts[0]?.message ?? ""}`);
    });
    return () => {
      offStatuses();
      offAlerts();
      void api.stopMonitoring();
    };
  }, [reload, showToast]);

  const groups = useMemo(
    () => groupBySite(sites, devices, statusById, filter),
    [sites, devices, statusById, filter],
  );
  const summary = useMemo(
    () => computeSummary(sites, devices, statusById),
    [sites, devices, statusById],
  );
  const visibleIds = useMemo(
    () => groups.flatMap((g) => g.views.map((v) => v.device.id)),
    [groups],
  );

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectSite = useCallback((ids: string[]) => {
    setSelectedIds((prev) => new Set([...prev, ...ids]));
  }, []);

  const onCommand = useCallback(
    async (id: string, cmd: ControlCommand) => {
      if (DESTRUCTIVE.has(cmd) && !window.confirm(`${CMD_LABEL[cmd]} لهذا الجهاز؟`)) return;
      const r = await api.sendCommand(id, cmd);
      showToast(r.ok ? `✓ تم: ${CMD_LABEL[cmd]}` : `✕ فشل: ${r.error ?? ""}`);
    },
    [showToast],
  );

  const onBulk = useCallback(
    async (cmd: ControlCommand) => {
      const ids = [...selectedIds];
      if (ids.length === 0) return;
      if (DESTRUCTIVE.has(cmd) && !window.confirm(`${CMD_LABEL[cmd]} على ${ids.length} جهاز؟`))
        return;
      const results = await api.sendBulk(ids, cmd);
      const ok = results.filter((r) => r.ok).length;
      showToast(`${CMD_LABEL[cmd]}: نجح ${ok} / ${results.length}`);
    },
    [selectedIds, showToast],
  );

  const onAddDevice = useCallback(
    async (p: NewDevicePayload) => {
      let siteId = p.siteId;
      if (p.siteId === "__new__") {
        siteId = crypto.randomUUID();
        await api.addSite({ id: siteId, name: p.siteName.trim() });
      }
      const device: Device = {
        id: crypto.randomUUID(),
        siteId,
        name: p.name.trim(),
        model: p.model.trim(),
        firmware: p.firmware,
        host: p.host.trim(),
        apiPort: p.apiPort,
        controlPort: p.controlPort,
      };
      await api.addDevice(device, p.secret || undefined);
      setDialogOpen(false);
      await reload();
      showToast(`✓ أُضيف الجهاز ${device.name}`);
    },
    [reload, showToast],
  );

  return (
    <div className="app">
      <SummaryBar summary={summary} />
      <Toolbar filter={filter} onChange={setFilter} onAddDevice={() => setDialogOpen(true)} />
      <BulkActionBar
        selectedCount={selectedIds.size}
        totalVisible={visibleIds.length}
        onBulk={onBulk}
        onSelectAll={() => setSelectedIds(new Set(visibleIds))}
        onClear={() => setSelectedIds(new Set())}
      />

      {groups.length === 0 ? (
        <div className="site" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
          لا توجد أجهزة مطابقة. اضغط «إضافة جهاز» للبدء.
        </div>
      ) : (
        groups.map((g) => (
          <SiteSection
            key={g.site.id}
            group={g}
            selectedIds={selectedIds}
            onToggle={toggle}
            onSelectSite={selectSite}
            onCommand={onCommand}
          />
        ))
      )}

      {dialogOpen && (
        <AddDeviceDialog
          sites={sites}
          onClose={() => setDialogOpen(false)}
          onSubmit={onAddDevice}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
