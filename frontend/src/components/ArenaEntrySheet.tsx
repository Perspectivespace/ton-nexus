import { Link } from "react-router-dom";
import { fmtTon } from "@/lib/arena/api";
import { type ArenaPosterModel } from "@/lib/arena/poster";
import { haptic } from "@/lib/haptics";
import { t, tp } from "@/i18n";

/**
 * Компактная карточка входа с ворот Арены: играть, история боёв, живая очередь.
 * Если Арена закрыта — без кнопки «В бой» и без счётчика, история остаётся (как API /history).
 */
export function ArenaEntrySheet({ model, onClose }: { model: ArenaPosterModel; onClose: () => void }) {
  const closed = model.kind === "closed";
  const bits: string[] = [];
  if (!closed && model.kind === "queue") {
    bits.push(tp("entry.queue", model.waiting));
    if (model.roomsOpen) bits.push(tp("entry.rooms", model.roomsOpen));
  } else if (!closed) {
    bits.push(t("poster.openSub"));
  }
  if (!closed && model.stakeNano) bits.push(t("poster.stakeFrom", { stake: fmtTon(model.stakeNano) }));
  return (
    <div className="cad-card az-entry" role="dialog" aria-modal="true" aria-labelledby="az-entry-title">
      <div className="cc-top">
        <span className="cc-kicker">{t("poster.kicker")}</span>
        <button type="button" className="az-x" aria-label={t("ui.close")} onClick={onClose}>
          ×
        </button>
      </div>
      <h3 id="az-entry-title" className="cc-title">
        {t("entry.title")}
      </h3>
      {closed ? (
        <>
          <p className="cc-sub">{t("entry.closed")}</p>
          <p className="cc-body">{t("entry.closedSub")}</p>
        </>
      ) : (
        <p className="cc-sub">{bits.join(" · ")}</p>
      )}
      <div className="az-acts">
        {!closed && (
          <Link to="/arena" className="cc-go" onClick={() => haptic.tap()}>
            {t("entry.play")}
          </Link>
        )}
        <Link to="/arena/history" className={closed ? "cc-go" : "cc-close"} onClick={() => haptic.tap()}>
          {t("entry.history")}
        </Link>
      </div>
    </div>
  );
}
