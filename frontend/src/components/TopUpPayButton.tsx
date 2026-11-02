import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTonConnectUI } from "@tonconnect/ui-react";
import { Button, useToast } from "@/components/ui";
import { api } from "@/api/client";
import { ensureConnected } from "@/lib/tonconnectFlow";

type TxPayload = { to: string; amount_nano: string; payload: string; valid_until: number };

export default function TopUpPayButton({
  amount,
  disabled,
  network,
  onSent,
}: {
  amount: string;
  disabled: boolean;
  network: string;
  onSent: () => void;
}) {
  const [ui] = useTonConnectUI();
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();

  const pay = async () => {
    setLoading(true);
    try {
      await ensureConnected(ui);
      const tx = await api<TxPayload>(`/api/v1/deposits/tx-payload?amount=${encodeURIComponent(amount)}`);
      await ui.sendTransaction({
        validUntil: tx.valid_until,
        network: network === "testnet" ? "-3" : "-239",
        messages: [{ address: tx.to, amount: tx.amount_nano, payload: tx.payload }],
      });
      toast({ kind: "ok", title: "Перевод отправлен", sub: "Зачислим после подтверждения сети, обычно 5–30 секунд" });
      // одна внеочередная проверка, когда блок уже должен попасть в сеть
      window.setTimeout(() => {
        api("/api/v1/deposits/check", { method: "POST" })
          .catch(() => undefined)
          .finally(() => {
            qc.invalidateQueries({ queryKey: ["me"] });
            qc.invalidateQueries({ queryKey: ["deposits", "mine"] });
            qc.invalidateQueries({ queryKey: ["balance"] });
          });
      }, 15000);
      onSent();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка";
      const cancelled = /reject|declin|cancel|отклон|не подключ/i.test(msg);
      toast({ kind: cancelled ? "info" : "danger", title: cancelled ? "Перевод отменён" : msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button block size="lg" disabled={disabled || loading} onClick={pay}>
      {loading ? "Ожидание кошелька…" : "Пополнить через кошелёк"}
    </Button>
  );
}
