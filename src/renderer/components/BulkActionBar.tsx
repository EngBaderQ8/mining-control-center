import React from "react";
import type { ControlCommand } from "../../core/drivers/types";

interface Props {
  selectedCount: number;
  totalVisible: number;
  onBulk: (cmd: ControlCommand) => void;
  onSelectAll: () => void;
  onClear: () => void;
}

export function BulkActionBar({
  selectedCount,
  totalVisible,
  onBulk,
  onSelectAll,
  onClear,
}: Props): React.ReactElement {
  const none = selectedCount === 0;
  return (
    <div className="bar">
      <span style={{ fontSize: 13, color: "var(--muted)" }}>أوامر جماعية على المحدد:</span>
      <button className="btn go" disabled={none} onClick={() => onBulk("startMining")}>
        ▶ تشغيل التعدين
      </button>
      <button className="btn warn" disabled={none} onClick={() => onBulk("restartMining")}>
        ↻ إعادة تشغيل
      </button>
      <button className="btn stop" disabled={none} onClick={() => onBulk("stopMining")}>
        ⏸ إيقاف التعدين
      </button>
      <button className="btn" disabled={none} onClick={() => onBulk("reboot")}>
        ⟳ Reboot
      </button>
      <span className="spacer" style={{ marginInlineStart: "auto", fontSize: 13 }}>
        محدّد: <b>{selectedCount}</b> / {totalVisible} ·{" "}
        <a href="#" onClick={(e) => (e.preventDefault(), onSelectAll())}>
          تحديد الكل
        </a>
        {selectedCount > 0 && (
          <>
            {" · "}
            <a href="#" onClick={(e) => (e.preventDefault(), onClear())}>
              إلغاء التحديد
            </a>
          </>
        )}
      </span>
    </div>
  );
}
