import React, { useEffect, useState } from "react";
import type { SiteGroup, SortKey, SortState } from "../state/store";
import type { ControlCommand } from "../../core/drivers/types";
import { DeviceTable } from "./DeviceTable";
import { SensorsDialog } from "./SensorsDialog";
import { api } from "../ipc";
import { evalEnv } from "../../core/sensors/shelly";
import type { SensorReading } from "../../core/model/sensor";
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
  onRenameSite: (siteId: string, newName: string) => void;
  onCleanupSite: (siteId: string, siteName: string) => void;
  onTestHost: (
    siteId: string,
    ip: string,
  ) => Promise<{
    connected: boolean;
    firmware: string | null;
    state: string;
    hashrateTHs: number;
    maxTempC: number;
    boardsFound: number;
    error?: string;
  }>;
  onDeleteDevice: (deviceId: string) => void;
  onDiagnose: (device: import("../../core/model/device").Device) => void;
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
  onRenameSite,
  onCleanupSite,
  onTestHost,
  onDeleteDevice,
  onDiagnose,
}: Props): React.ReactElement {
  const { site, views } = group;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(site.name);
  const [sensors, setSensors] = useState<SensorReading[]>([]);
  const [sensorsOpen, setSensorsOpen] = useState(false);
  const loadSensors = React.useCallback((): void => {
    void api.getSensorsAtSite(site.id).then(setSensors).catch(() => setSensors([]));
  }, [site.id]);
  // Poll this site's room sensors for the header badge (the agent alerts independently).
  useEffect(() => {
    loadSensors();
    const id = setInterval(loadSensors, 60_000);
    return () => clearInterval(id);
  }, [loadSensors]);
  const [testIp, setTestIp] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const runTest = async (): Promise<void> => {
    const ip = testIp.trim();
    if (!ip || testBusy) return;
    setTestBusy(true);
    setTestResult(null);
    try {
      const r = await onTestHost(site.id, ip);
      setTestResult(
        r.connected
          ? t("✓ {ip}: متصل · فرمور {fw} · {state} · {hash} TH · حرارة {temp}° · لوحات {boards}", {
              ip,
              fw: r.firmware ?? t("؟"),
              state: r.state,
              hash: r.hashrateTHs.toFixed(1),
              temp: r.maxTempC,
              boards: r.boardsFound,
            })
          : t("❌ {ip}: ما فيه ماينر يردّ على 4028. {err}", { ip, err: r.error ?? "" }),
      );
    } catch (e) {
      setTestResult(t("⚠ تعذّر الاختبار: ") + String(e));
    } finally {
      setTestBusy(false);
    }
  };
  const saveRename = (): void => {
    const name = draft.trim();
    if (name && name !== site.name) onRenameSite(site.id, name);
    setEditing(false);
  };
  // Three explicit, non-overlapping counts that sum to the total.
  const online = views.filter((v) => v.status?.state === "online").length;
  const warning = views.filter((v) => v.status?.state === "warning").length;
  const offline = views.length - online - warning;
  const siteTHs = views.reduce((sum, v) => sum + (v.status?.hashrateTHs ?? 0), 0);
  const siteState = online + warning === 0 ? "offline" : offline + warning > 0 ? "warning" : "online";

  // Room-climate badge: the worst of this site's reachable sensors.
  const okReadings = sensors.filter((s) => s.ok);
  let climate: { label: string; color: string } | null = null;
  if (okReadings.length > 0) {
    let sev = 0; // 0 ok · 1 warn · 2 high
    for (const r of okReadings) {
      for (const i of evalEnv(r, {
        ...(r.maxTempC ? { maxTempC: r.maxTempC } : {}),
        ...(r.maxHumidity ? { maxHumidity: r.maxHumidity } : {}),
      })) {
        sev = Math.max(sev, i.severity === "high" ? 2 : 1);
      }
    }
    const hottest = okReadings.reduce((a, b) => ((b.tempC ?? -1) > (a.tempC ?? -1) ? b : a));
    const parts: string[] = [];
    if (hottest.tempC !== undefined) parts.push(`${hottest.tempC.toFixed(0)}°`);
    if (hottest.humidity !== undefined) parts.push(`${Math.round(hottest.humidity)}%`);
    climate = { label: parts.join(" · "), color: sev === 2 ? "var(--red)" : sev === 1 ? "var(--amber)" : "var(--green)" };
  }

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
        {climate && (
          <span
            title={t("حرارة/رطوبة الغرفة")}
            style={{ fontSize: 12.5, fontWeight: 700, color: climate.color, marginInlineStart: 8, whiteSpace: "nowrap" }}
          >
            🌡️ {climate.label}
          </span>
        )}
        <span className="spacer" style={{ marginInlineStart: "auto" }} />
        {editing ? (
          <>
            <input
              className="input"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveRename();
                if (e.key === "Escape") setEditing(false);
              }}
              style={{ minWidth: 160 }}
            />
            <button className="btn primary" onClick={saveRename}>
              {t("حفظ")}
            </button>
            <button className="btn" onClick={() => setEditing(false)}>
              {t("إلغاء")}
            </button>
          </>
        ) : (
          <>
            <button
              className="btn"
              title={t("تغيير اسم الموقع")}
              onClick={() => {
                setDraft(site.name);
                setEditing(true);
              }}
            >
              {t("✏️ تعديل الاسم")}
            </button>
            <button className="btn" onClick={() => onSelectSite(views.map((v) => v.device.id))}>
              {t("تحديد كل الموقع")}
            </button>
            <button className="btn" title={t("حسّاسات حرارة/رطوبة الغرفة")} onClick={() => setSensorsOpen(true)}>
              {t("🌡️ حسّاسات")}
            </button>
            {offline > 0 && (
              <button
                className="btn"
                title={t("يفحص الأجهزة ويحذف اللي ما يردّ عليها ماينر فعلاً")}
                onClick={() => onCleanupSite(site.id, site.name)}
              >
                {t("🧹 إزالة غير الموجودة")}
              </button>
            )}
            <button className="btn stop" onClick={() => onDeleteSite(site.id, site.name)}>
              {t("🗑 حذف الموقع")}
            </button>
          </>
        )}
      </div>
      {!collapsed && (
        <>
          <div
            className="row"
            style={{ gap: 6, alignItems: "center", padding: "8px 10px 4px", flexWrap: "wrap" }}
          >
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{t("🔎 اختبار IP في هذا الموقع:")}</span>
            <input
              className="input"
              placeholder={t("مثال: 192.168.0.50")}
              value={testIp}
              disabled={testBusy}
              onChange={(e) => setTestIp(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runTest();
              }}
              style={{ width: 150, fontSize: 12.5 }}
            />
            <button className="btn sm" disabled={testBusy || !testIp.trim()} onClick={() => void runTest()}>
              {testBusy ? t("…جاري") : t("اختبار")}
            </button>
            {testResult && (
              <span style={{ fontSize: 12, color: "var(--muted)", direction: "rtl" }}>{testResult}</span>
            )}
          </div>
          <DeviceTable
            views={views}
            selectedIds={selectedIds}
            sort={sort}
            onSort={onSort}
            onToggle={onToggle}
            onCommand={onCommand}
            onDeleteDevice={onDeleteDevice}
            onDiagnose={onDiagnose}
          />
        </>
      )}
      {sensorsOpen && (
        <SensorsDialog
          siteId={site.id}
          siteName={site.name}
          initial={sensors}
          onClose={() => setSensorsOpen(false)}
          onSaved={loadSensors}
        />
      )}
    </div>
  );
}
