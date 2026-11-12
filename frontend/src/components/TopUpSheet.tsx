import { lazy, Suspense, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, useToast } from "@/components/ui";
import { api } from "@/api/client";
import type { DepositInfo } from "@/api/hooks";
import { haptic } from "@/lib/haptics";
import { LazyTonConnectProvider } from "@/lib/tonconnect";
import { t } from "@/i18n";

/** Кнопка «Пополнить через кошелёк» — с TON Connect, грузится отдельным чанком только при открытой шторке */
const PayButton = lazy(() => import("./TopUpPayButton"));

type Props = {
  info: DepositInfo | undefined;
  onClose: () => void;
};

const AMOUNT_RE = /^\d+(\.\d{1,9})?$/;

/** Ошибка суммы на клиенте (сервер проверяет то же самое ещё раз) */
export function amountError(amount: string, minTon: string): string | null {
  const s = amount.trim();
  if (!AMOUNT_RE.test(s)) return t("topup.enterAmount");
  if (Number(s) < Number(minTon)) return t("topup.min", { minTon });
  if (Number(s) > 10000) return t("topup.max");
  return null;
}

export function TopUpSheet({ info, onClose }: Props) {
  const [amount, setAmount] = useState("1");
  const [showManual, setShowManual] = useState(false);
  const [checking, setChecking] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();

  if (!info) return <p className="ui-sec">{t("ui.loadingDots")}</p>;
  if (!info.enabled) return <p className="ui-sec">{t("topup.soon")}</p>;

  const err = amountError(amount, info.min_ton);

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    haptic.select();
    toast({ title: t("ui.copied") });
  };

  const check = async () => {
    setChecking(true);
    try {
      const rows = await api<{ status: string }[]>("/api/v1/deposits/check", { method: "POST" });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["deposits", "mine"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
      const credited = rows.filter((r) => r.status === "credited" || r.status === "manual").length;
      toast({ title: credited ? t("topup.credited", { credited }) : t("topup.notYet"), sub: t("topup.confirmTime") });
    } catch (e) {
      toast({ kind: "danger", title: e instanceof Error ? e.message : t("ui.error") });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field label={t("topup.amount")} unit="TON" error={amount && err ? err : undefined} hint={t("topup.min", { minTon: info.min_ton })}>
        <input
          className="ui-input mono"
          inputMode="decimal"
          aria-label={t("topup.amountTon")}
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(",", ".").trim())}
        />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        {["1", "5", "10"].map((v) => (
          <Button key={v} kind="secondary" size="sm" haptics="select" onClick={() => setAmount(v)} aria-pressed={amount === v}>
            {v} TON
          </Button>
        ))}
      </div>
      <LazyTonConnectProvider>
        <Suspense fallback={<Button block size="lg" disabled>{t("ui.loadingDots")}</Button>}>
          <PayButton amount={amount} disabled={!!err} network={info.network} onSent={onClose} />
        </Suspense>
      </LazyTonConnectProvider>
      <Button kind="ghost" size="sm" block onClick={() => setShowManual((v) => !v)} aria-expanded={showManual}>
        {showManual ? t("ui.hide") : t("topup.fromExchange")}
      </Button>
      {showManual && (
        <div className="space-y-3 rounded-lg border border-[var(--line)] p-3">
          <p className="ui-label">{t("topup.projectAddress")}</p>
          <p className="mono break-all text-[12px]">{info.project_address || "—"}</p>
          <Button kind="secondary" block onClick={() => copy(info.project_address)}>{t("topup.copyAddress")}</Button>
          <p className="ui-label">{t("topup.memo")}</p>
          <p className="mono text-lg">{info.memo}</p>
          <Button kind="secondary" block onClick={() => copy(info.memo)}>{t("topup.copyMemo")}</Button>
          <p className="text-[12px] text-[var(--warn)]">
            {t("topup.memoRequired")}{" "}{info.memo}{t("topup.memoWhy")}</p>
          <Button kind="secondary" block disabled={checking} onClick={check}>
            {checking ? t("topup.checking") : t("topup.iSent")}
          </Button>
        </div>
      )}
    </div>
  );
}
