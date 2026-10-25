import { useState } from "react";
import { usePromoRedeem, type PromoRedeemOut } from "@/api/hooks";
import { Button, Field, Panel, useToast } from "@/components/ui";

function rewardLine(r: PromoRedeemOut) {
  return [
    Number(r.reward_ton) > 0 && `+${Number(r.reward_ton).toFixed(4)} TON`,
    r.reward_xp > 0 && `+${r.reward_xp} XP`,
    r.reward_focus > 0 && `Фокус +${r.reward_focus}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Ввод промокода. Живёт в «Балансе»: код начисляет TON, опыт или фокус. */
export function PromoPanel() {
  const promo = usePromoRedeem();
  const toast = useToast();
  const [code, setCode] = useState("");
  const short = code.trim().length < 3;

  function onPromo() {
    promo.mutate(code, {
      onSuccess: (r) => {
        setCode("");
        toast({ kind: "ok", title: "Промокод активирован", sub: rewardLine(r) || r.code });
      },
    });
  }

  return (
    <Panel className="space-y-4 p-5">
      <div className="min-w-0">
        <h2 className="ui-h">Промокод</h2>
        <p className="ui-sec mt-1">Начисляет TON, опыт или фокус. Один код — один раз на аккаунт.</p>
      </div>
      <Field label="Код" error={promo.isError ? (promo.error instanceof Error ? promo.error.message : "Код не принят") : undefined}>
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
        {promo.isPending ? "Проверка…" : short ? "Введите код" : "Активировать"}
      </Button>
    </Panel>
  );
}
