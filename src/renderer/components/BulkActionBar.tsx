import React from "react";
import type { ControlCommand } from "../../core/drivers/types";
import { t } from "../i18n";

interface Props {
  selectedCount: number;
  totalVisible: number;
  onBulk: (cmd: ControlCommand) => void;
  onSetPool: () => void;
  onSetProfile: () => void;
  onSetCredentials: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}

export function BulkActionBar({
  selectedCount,
  totalVisible,
  onBulk,
  onSetPool,
  onSetProfile,
  onSetCredentials,
  onSelectAll,
  onClear,
}: Props): React.ReactElement {
  const none = selectedCount === 0;
  return (
    <div className="bar">
      <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("أوامر جماعية على المحدد:")}</span>
      <button className="btn go" disabled={none} onClick={() => onBulk("startMining")}>
        ▶ {t("تشغيل التعدين")}
      </button>
      <button className="btn warn" disabled={none} onClick={() => onBulk("restartMining")}>
        ↻ {t("إعادة تشغيل")}
      </button>
      <button className="btn stop" disabled={none} onClick={() => onBulk("stopMining")}>
        ⏸ {t("إيقاف التعدين")}
      </button>
      <button className="btn" disabled={none} onClick={() => onBulk("reboot")}>
        ⟳ Reboot
      </button>
      <button className="btn" disabled={none} onClick={onSetPool}>
        ⛏ {t("تغيير البول")}
      </button>
      <button className="btn" disabled={none} onClick={onSetProfile}>
        ⚡ {t("وضع الطاقة")}
      </button>
      <button className="btn" disabled={none} onClick={onSetCredentials}>
        🔑 {t("بيانات الدخول")}
      </button>
      <span className="spacer" style={{ marginInlineStart: "auto", fontSize: 13 }}>
        {t("محدّد:")} <b>{selectedCount}</b> / {totalVisible} ·{" "}
        <a href="#" onClick={(e) => (e.preventDefault(), onSelectAll())}>
          {t("تحديد الكل")}
        </a>
        {selectedCount > 0 && (
          <>
            {" · "}
            <a href="#" onClick={(e) => (e.preventDefault(), onClear())}>
              {t("إلغاء التحديد")}
            </a>
          </>
        )}
      </span>
    </div>
  );
}
