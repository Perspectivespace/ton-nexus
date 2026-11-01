import { lazy, Suspense, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Field, useToast } from "@/components/ui";
import { api } from "@/api/client";
import type { DepositInfo } from "@/api/hooks";
import { haptic } from "@/lib/haptics";
import { LazyTonConnectProvider } from "@/lib/tonconnect";

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
  if (!AMOUNT_RE.test(s)) return "Введите сумму, например 1.5";
  if (Number(s) < Number(minTon)) return `Минимум ${minTon} TON`;
  if (Number(s) > 10000) return "Не больше 10 000 TON";
  return null;
}

export function TopUpSheet({ info, onClose }: Props) {
  const [amount, setAmount] = useState("1");
  const [showManual, setShowManual] = useState(false);
  const [checking, setChecking] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();

  if (!info) return <p className="ui-sec">Загрузка…</p>;
  if (!info.enabled) return <p className="ui-sec">Пополнение скоро будет доступно.</p>;

  const err = amountError(amount, info.min_ton);

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    haptic.select();
    toast({ title: "Скопировано" });
  };

  const check = async () => {
    setChecking(true);
    try {
      const rows = await api<{ status: string }[]>("/api/v1/deposits/check", { method: "POST" });
      qc.invalidateQueries({ queryKey: ["me"] });
      qc.invalidateQueries({ queryKey: ["deposits", "mine"] });
      const credited = rows.filter((r) => r.status === "credited" || r.status === "manual").length;
      toast({ title: credited ? `Зачислено пополнений: ${credited}` : "Пока не видим перевод", sub: "Сеть подтверждает перевод за 5–30 секунд" });
    } catch (e) {
      toast({ kind: "danger", title: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Сумма" unit="TON" error={amount && err ? err : undefined} hint={`Минимум ${info.min_ton} TON`}>
        <input
          className="ui-input mono"
          inputMode="decimal"
          aria-label="Сумма TON"
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
        <Suspense fallback={<Button block size="lg" disabled>Загрузка…</Button>}>
          <PayButton amount={amount} disabled={!!err} network={info.network} onSent={onClose} />
        </Suspense>
      </LazyTonConnectProvider>
      <Button kind="ghost" size="sm" block onClick={() => setShowManual((v) => !v)} aria-expanded={showManual}>
        {showManual ? "Скрыть" : "Перевод с биржи или другого кошелька"}
      </Button>
      {showManual && (
        <div className="space-y-3 rounded-lg border border-[var(--line)] p-3">
          <p className="ui-label">Адрес проекта</p>
          <p className="mono break-all text-[12px]">{info.project_address || "—"}</p>
          <Button kind="secondary" block onClick={() => copy(info.project_address)}>Скопировать адрес</Button>
          <p className="ui-label">Комментарий (мемо)</p>
          <p className="mono text-lg">{info.memo}</p>
          <Button kind="secondary" block onClick={() => copy(info.memo)}>Скопировать мемо</Button>
          <p className="text-[12px] text-[var(--warn)]">
            Обязательно укажите комментарий {info.memo}. Без него перевод зачислят только вручную через поддержку.
          </p>
          <Button kind="secondary" block disabled={checking} onClick={check}>
            {checking ? "Проверяем…" : "Я перевёл — проверить"}
          </Button>
        </div>
      )}
    </div>
  );
}
