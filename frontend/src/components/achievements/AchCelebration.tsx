import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useAchFresh, useAchSeen } from "@/api/achievements";
import { Button } from "@/components/ui";
import { fmtNum, t } from "@/i18n";
import { haptic } from "@/lib/haptics";
import { pushBack } from "@/lib/backButton";
import { AchBadge } from "./AchBadge";
import { metalName, tierTitle, tonText } from "./text";

/**
 * Праздничное окно при новой ступени: приходит из /achievements/fresh (досчёт при входе и после событий).
 * Закрытие отмечает награды показанными (POST /seen). Анимации разовые, без backdrop-filter.
 */
export function AchCelebration({ enabled }: { enabled: boolean }) {
  const { data } = useAchFresh(enabled);
  const seen = useAchSeen();
  const navigate = useNavigate();
  const items = data?.items ?? [];
  const open = enabled && items.length > 0;
  const okRef = useRef<HTMLButtonElement>(null);

  const close = (more?: boolean) => {
    if (!items.length) return;
    seen.mutate(items.map((a) => a.id));
    if (more) navigate("/achievements");
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    haptic.success();
    okRef.current?.focus();
    const back = () => closeRef.current();
    const pop = pushBack(back);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && back();
    window.addEventListener("keydown", esc);
    return () => {
      pop();
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  if (!open) return null;
  const main = items[items.length - 1];
  const rest = items.slice(0, -1);
  const pending = items.filter((a) => a.status === "pending");
  const pendingTon = pending.reduce((s, a) => s + Number(a.ton), 0);
  const ton = items.filter((a) => a.status === "paid").reduce((s, a) => s + Number(a.ton), 0);
  const xp = items.filter((a) => a.status === "paid").reduce((s, a) => s + a.xp, 0);

  return createPortal(
    <div className="ach-cel" role="dialog" aria-modal="true" aria-labelledby="ach-cel-t">
      <div className="ach-cel-scrim" onClick={() => close()} />
      <div className={`ach-cel-card m-${main.metal}`}>
        <div className="ach-cel-rays" aria-hidden />
        <p className="ach-cel-eb">{items.length > 1 ? t("ach.celebrateN", { n: items.length }) : t("ach.celebrate")}</p>
        <div className="ach-cel-badge">
          <AchBadge metal={main.metal} branch={main.branch} size={128} label={metalName(main.metal)} />
        </div>
        <h2 id="ach-cel-t" className="ach-cel-t">
          {tierTitle(main.branch, main.tier, main.index)}
        </h2>
        <p className="ach-cel-m">{metalName(main.metal)}</p>
        {rest.length > 0 && (
          <ul className="ach-cel-rest">
            {rest.slice(-4).map((a) => (
              <li key={a.id} title={tierTitle(a.branch, a.tier, a.index)}>
                <AchBadge metal={a.metal} branch={a.branch} size={36} />
              </li>
            ))}
          </ul>
        )}
        {(ton > 0 || xp > 0) && (
          <p className="ach-cel-rw ui-num">{[ton > 0 ? `+${tonText(String(ton))}` : "", xp > 0 ? `+${fmtNum(xp)} XP` : ""].filter(Boolean).join(" · ")}</p>
        )}
        {pendingTon > 0 && <p className="ach-cel-note">{t("ach.celebratePending", { ton: fmtNum(pendingTon, { maximumFractionDigits: 8 }) })}</p>}
        <div className="ach-cel-act">
          <Button ref={okRef} kind="primary" block disabled={seen.isPending} onClick={() => close()}>
            {t("ach.celebrateOk")}
          </Button>
          <Button kind="ghost" block disabled={seen.isPending} onClick={() => close(true)}>
            {t("ach.celebrateMore")}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
