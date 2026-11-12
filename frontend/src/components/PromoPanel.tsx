import { useState } from "react";
import { usePromoRedeem, type PromoRedeemOut } from "@/api/hooks";
import { ApiError } from "@/api/client";
import { Button, Field, Panel, useToast } from "@/components/ui";
import { t } from "@/i18n";

function rewardLine(r: PromoRedeemOut) {
  return [
    Number(r.reward_ton) > 0 && `+${Number(r.reward_ton).toFixed(4)} TON`,
    r.reward_xp > 0 && `+${r.reward_xp} XP`,
    r.reward_focus > 0 && t("promo.focusReward", { rewardFocus: r.reward_focus }),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Ответ сервера → понятный текст. Неверный и «не вовремя» введённый секретный код — один и тот же ответ. */
export function promoErrorText(e: unknown): string {
  const status = e instanceof ApiError ? e.status : 0;
  const msg = e instanceof Error ? e.message : "";
  if (status === 429 || /too many/i.test(msg)) return t("promo.tooMany");
  if (/already redeemed/i.test(msg)) return t("promo.already");
  if (/fully used/i.test(msg)) return t("promo.usedUp");
  if (/expired/i.test(msg)) return t("promo.expired");
  return t("promo.rejected");
}

/** Ввод промокода — вкладка «Промокод» в «Заработке» (/tasks?tab=promo): код начисляет TON, опыт или фокус. */
export function PromoPanel() {
  const promo = usePromoRedeem();
  const toast = useToast();
  const [code, setCode] = useState("");
  const short = code.trim().length < 3;

  function onPromo() {
    promo.mutate(code, {
      onSuccess: (r) => {
        setCode("");
        toast({ kind: "ok", title: t("promo.done"), sub: rewardLine(r) || r.code });
      },
    });
  }

  return (
    <Panel className="space-y-4 p-5">
      <div className="min-w-0">
        <h2 className="ui-h">{t("promo.title")}</h2>
        <p className="ui-sec mt-1">{t("promo.sub")}</p>
      </div>
      <Field label={t("promo.code")} error={promo.isError ? promoErrorText(promo.error) : undefined}>
        <input
          className="ui-input uppercase tracking-wider"
          value={code}
          onChange={(e) => {
            setCode(e.target.value.toUpperCase());
            if (promo.isError) promo.reset();
          }}
          placeholder="NEXUS-START"
          disabled={promo.isPending}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Button kind="secondary" block disabled={promo.isPending || short} onClick={onPromo}>
        {promo.isPending ? t("promo.checking") : short ? t("promo.enter") : t("promo.activate")}
      </Button>
    </Panel>
  );
}
