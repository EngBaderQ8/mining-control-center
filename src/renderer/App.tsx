import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./ipc";
import type { Device, DeviceStatus, Site } from "../core/model/device";
import type { ControlCommand } from "../core/drivers/types";
import {
  computeSummary,
  groupBySite,
  EMPTY_FILTER,
  DEFAULT_SORT,
  isNumericSort,
  type Filter,
  type SortKey,
  type SortState,
} from "./state/store";
import { SummaryBar } from "./components/SummaryBar";
import { ProfitBar } from "./components/ProfitBar";
import { Heatmap } from "./components/Heatmap";
import { HistoryCharts } from "./components/HistoryChart";
import { appendPoint, loadHistory, saveHistory, type HistoryPoint } from "./state/history";
import { Toolbar } from "./components/Toolbar";
import { BulkActionBar } from "./components/BulkActionBar";
import { SiteSection } from "./components/SiteSection";
import { AddDeviceDialog, type NewDevicePayload } from "./components/AddDeviceDialog";
import { SetPoolDialog, type PoolInput } from "./components/SetPoolDialog";
import { CredentialsDialog } from "./components/CredentialsDialog";
import { ScanDialog } from "./components/ScanDialog";
import { TelegramDialog } from "./components/TelegramDialog";
import { LoginScreen } from "./components/LoginScreen";
import { UpdateBanner } from "./components/UpdateBanner";
import type { UpdateStatus } from "../shared/api";

const COLLAPSE_KEY = "mcc.collapsedSites";
function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* ignore */
  }
  return new Set();
}

const DESTRUCTIVE: ReadonlySet<ControlCommand> = new Set(["stopMining", "reboot"]);
const CMD_LABEL: Record<ControlCommand, string> = {
  startMining: "تشغيل التعدين",
  restartMining: "إعادة تشغيل التعدين",
  stopMining: "إيقاف التعدين",
  reboot: "إعادة تشغيل الجهاز (Reboot)",
  setPool: "تغيير البول",
};

function VersionBadge({
  version,
  status,
}: {
  version: string;
  status: UpdateStatus | null;
}): React.ReactElement {
  let suffix = "";
  let color = "var(--muted)";
  switch (status?.state) {
    case "checking":
      suffix = " · يفحص التحديث…";
      break;
    case "uptodate":
      suffix = " · ✅ آخر نسخة";
      color = "var(--green)";
      break;
    case "available":
      suffix = " · ⬇ يتوفّر تحديث";
      color = "var(--blue)";
      break;
    case "downloading":
      suffix = ` · ⬇ تنزيل ${status?.percent ?? 0}%`;
      color = "var(--blue)";
      break;
    case "ready":
      suffix = " · ✅ جاهز — إعادة تشغيل";
      color = "var(--green)";
      break;
    case "error":
      suffix = " · ⚠ تعذّر التحديث";
      color = "var(--red)";
      break;
  }
  return (
    <div className="versionbadge" style={{ color }} title={status?.error ?? ""}>
      الإصدار {version || "؟"}
      {suffix}
    </div>
  );
}

export function App(): React.ReactElement {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [statusById, setStatusById] = useState<Map<string, DeviceStatus>>(new Map());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [view, setView] = useState<"table" | "heatmap" | "charts">("table");
  const [history, setHistory] = useState<HistoryPoint[]>(loadHistory);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const onSort = useCallback((key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: isNumericSort(key) ? "desc" : "asc" },
    );
  }, []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [poolOpen, setPoolOpen] = useState(false);
  const [credOpen, setCredOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [tgOpen, setTgOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  // Collapsed site IDs — persisted so the layout survives reloads (key for many sites).
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed());

  const persistCollapsed = useCallback((next: Set<string>) => {
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore quota/availability errors */
    }
  }, []);
  const toggleCollapse = useCallback(
    (siteId: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(siteId)) next.delete(siteId);
        else next.add(siteId);
        try {
          localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [],
  );
  // On the first populated load only: a fresh install with many sites starts
  // collapsed (overview, not an 855-row wall). Decided once — never re-collapses
  // sites the user later expands.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || sites.length === 0) return;
    seededRef.current = true;
    if (localStorage.getItem(COLLAPSE_KEY) === null && sites.length >= 4) {
      persistCollapsed(new Set(sites.map((s) => s.id)));
    }
  }, [sites, persistCollapsed]);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 4000);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
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

  // Auth gate: decide whether to show login or the dashboard.
  useEffect(() => {
    void api.authStatus().then((s) => setAuthed(s.loggedIn));
  }, []);

  // App version — shown always in a corner badge so the running build is obvious.
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    void api.getVersion().then(setAppVersion);
  }, []);

  // Update banner — subscribe regardless of auth so updates are always visible.
  // "up to date" auto-hides after a few seconds; download/error states persist.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = api.onUpdateStatus((s) => {
      setUpdateStatus(s);
      if (t) {
        clearTimeout(t);
        t = null;
      }
      if (s.state === "uptodate") t = setTimeout(() => setUpdateStatus({ state: "none" }), 8000);
    });
    return () => {
      off();
      if (t) clearTimeout(t);
    };
  }, []);

  // Data feed (server-driven) — only while authenticated.
  useEffect(() => {
    if (!authed) return;
    void reload();
    const offSnapshot = api.onSnapshot((snap) => {
      setSites(snap.sites);
      setDevices(snap.devices);
      setStatusById(() => new Map(snap.statuses.map((s) => [s.deviceId, s])));
    });
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
      offSnapshot();
      offStatuses();
      offAlerts();
    };
  }, [authed, reload, showToast]);

  const groups = useMemo(
    () => groupBySite(sites, devices, statusById, filter),
    [sites, devices, statusById, filter],
  );
  const summary = useMemo(
    () => computeSummary(sites, devices, statusById),
    [sites, devices, statusById],
  );

  // Record one fleet snapshot per minute for the historical charts (persisted).
  useEffect(() => {
    if (!authed || summary.total === 0) return;
    const point: HistoryPoint = {
      t: Date.now(),
      ths: summary.totalTHs,
      temp: summary.avgTempC,
      online: summary.online,
      total: summary.total,
    };
    setHistory((prev) => {
      const next = appendPoint(prev, point, { maxPoints: 2880, minIntervalMs: 60_000 });
      if (next !== prev) saveHistory(next);
      return next;
    });
  }, [summary, authed]);
  // "Visible" = actually on screen: exclude devices hidden inside collapsed
  // sites so select-all / bulk commands never touch unseen miners.
  const visibleIds = useMemo(
    () => groups.filter((g) => !collapsed.has(g.site.id)).flatMap((g) => g.views.map((v) => v.device.id)),
    [groups, collapsed],
  );
  const collapsedVisibleCount = useMemo(
    () => groups.filter((g) => collapsed.has(g.site.id)).length,
    [groups, collapsed],
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
      const firstErr = results.find((r) => !r.ok)?.error;
      showToast(
        ok === results.length
          ? `✓ ${CMD_LABEL[cmd]}: نجح ${ok}/${results.length}`
          : `${CMD_LABEL[cmd]}: نجح ${ok}/${results.length}${firstErr ? ` · مثال خطأ: ${firstErr}` : ""}`,
      );
    },
    [selectedIds, showToast],
  );

  const onSetPool = useCallback(
    async (pool: PoolInput) => {
      const ids = [...selectedIds];
      setPoolOpen(false);
      if (ids.length === 0) return;
      const results = await Promise.all(
        ids.map((id) => api.sendCommand(id, "setPool", { ...pool })),
      );
      const ok = results.filter((r) => r.ok).length;
      showToast(`تغيير البول: نجح ${ok} / ${results.length}`);
    },
    [selectedIds, showToast],
  );

  const onDeleteDevice = useCallback(
    async (deviceId: string) => {
      if (!window.confirm("حذف هذا الجهاز؟")) return;
      await api.deleteDevice(deviceId);
      await reload();
      showToast("تم حذف الجهاز");
    },
    [reload, showToast],
  );

  const onDeleteSite = useCallback(
    async (siteId: string, siteName: string) => {
      if (!window.confirm(`حذف الموقع «${siteName}» وكل أجهزته؟`)) return;
      await api.deleteSite(siteId);
      setSelectedIds(new Set());
      await reload();
      showToast("تم حذف الموقع");
    },
    [reload, showToast],
  );

  const onAddDevice = useCallback(
    async (p: NewDevicePayload) => {
      let createdSiteId: string | null = null;
      try {
        let siteId = p.siteId;
        if (p.siteId === "__new__") {
          siteId = crypto.randomUUID();
          await api.addSite({ id: siteId, name: p.siteName.trim() });
          createdSiteId = siteId; // track for rollback if the device add fails
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
      } catch (e) {
        // Roll back a freshly-created (now-empty) site so it isn't orphaned.
        if (createdSiteId) {
          try {
            await api.deleteSite(createdSiteId);
          } catch {
            /* best-effort */
          }
        }
        showToast(`⚠ تعذّر إضافة الجهاز: ${(e as Error)?.message ?? e}`);
      }
    },
    [reload, showToast],
  );

  if (authed === null)
    return <div className="app" style={{ color: "var(--muted)" }}>…تحميل</div>;
  if (!authed)
    return (
      <>
        <UpdateBanner status={updateStatus} />
        <LoginScreen onAuthed={() => setAuthed(true)} />
        <VersionBadge version={appVersion} status={updateStatus} />
      </>
    );

  return (
    <div className="app">
      <UpdateBanner status={updateStatus} />
      <ProfitBar hashrateTHs={summary.totalTHs} />
      <SummaryBar summary={summary} />
      <Toolbar
        filter={filter}
        onChange={setFilter}
        onAddDevice={() => setDialogOpen(true)}
        onScan={() => setScanOpen(true)}
        onTelegram={() => setTgOpen(true)}
        onCheckUpdate={() => {
          // The persistent banner (driven by main-process events) shows the full
          // result: checking -> up-to-date / downloading / error. No transient toast.
          void api.checkUpdate();
        }}
      />
      <BulkActionBar
        selectedCount={selectedIds.size}
        totalVisible={visibleIds.length}
        onBulk={onBulk}
        onSetPool={() => setPoolOpen(true)}
        onSetCredentials={() => setCredOpen(true)}
        onSelectAll={() => setSelectedIds(new Set(visibleIds))}
        onClear={() => setSelectedIds(new Set())}
      />

      <div className="viewtoggle">
        <button
          className={`btn ${view === "table" ? "primary" : ""}`}
          onClick={() => setView("table")}
        >
          📋 جدول
        </button>
        <button
          className={`btn ${view === "heatmap" ? "primary" : ""}`}
          onClick={() => setView("heatmap")}
        >
          🔥 خريطة حرارية
        </button>
        <button
          className={`btn ${view === "charts" ? "primary" : ""}`}
          onClick={() => setView("charts")}
        >
          📊 الرسوم
        </button>
      </div>

      {view === "charts" ? (
        <HistoryCharts history={history} />
      ) : view === "heatmap" ? (
        groups.length === 0 ? (
          <div className="site" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
            لا توجد أجهزة مطابقة.
          </div>
        ) : (
          <Heatmap groups={groups} />
        )
      ) : (
        <>
          {groups.length >= 2 && (
            <div className="collapsebar">
              <span className="hint">
                {collapsedVisibleCount > 0
                  ? `${collapsedVisibleCount} / ${groups.length} موقع مطوي`
                  : `${groups.length} مواقع`}
              </span>
              <button className="btn" onClick={() => persistCollapsed(new Set(groups.map((g) => g.site.id)))}>
                ◀ طيّ الكل
              </button>
              <button className="btn" onClick={() => persistCollapsed(new Set())}>
                ▼ فتح الكل
              </button>
            </div>
          )}

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
                collapsed={collapsed.has(g.site.id)}
                sort={sort}
                onSort={onSort}
                onToggleCollapse={toggleCollapse}
                onToggle={toggle}
                onSelectSite={selectSite}
                onCommand={onCommand}
                onDeleteSite={onDeleteSite}
                onDeleteDevice={onDeleteDevice}
              />
            ))
          )}
        </>
      )}

      {scanOpen && (
        <ScanDialog
          onClose={() => setScanOpen(false)}
          onScan={async (siteName, base, secret) => {
            const r = await api.scanNetwork(siteName, base, secret);
            await reload();
            return r;
          }}
        />
      )}

      {tgOpen && <TelegramDialog onClose={() => setTgOpen(false)} />}

      {credOpen && (
        <CredentialsDialog
          count={selectedIds.size}
          onClose={() => setCredOpen(false)}
          onSubmit={(user, pass) => {
            const ids = [...selectedIds];
            setCredOpen(false);
            if (ids.length === 0) return;
            void api.setCredentials(ids, `${user}:${pass}`).then(() =>
              showToast(`🔑 حُفظت بيانات الدخول لـ ${ids.length} جهاز — جرّب أمر تحكم الحين`),
            );
          }}
        />
      )}

      {poolOpen && (
        <SetPoolDialog count={selectedIds.size} onClose={() => setPoolOpen(false)} onSubmit={onSetPool} />
      )}

      {dialogOpen && (
        <AddDeviceDialog
          sites={sites}
          onClose={() => setDialogOpen(false)}
          onSubmit={onAddDevice}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
      <VersionBadge version={appVersion} status={updateStatus} />
    </div>
  );
}
