import { useState } from "react";
import { motion } from "framer-motion";
import { useMe } from "@/api/hooks";
import { api } from "@/api/client";
import { IconWallet } from "@/components/icons";

export function Wallet() {
  const { data: me, refetch } = useMe();
  const [amount, setAmount] = useState("0.2");
  const [wallet, setWallet] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setMsg(null);
    try {
      await api("/api/v1/withdraw", {
        method: "POST",
        body: JSON.stringify({ amount, wallet_address: wallet }),
      });
      setMsg("Заявка принята. Владелец подтвердит вручную.");
      refetch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between">
        <div>
          <p className="eyebrow">Кошелёк</p>
          <h1 className="text-[26px] font-semibold tracking-tight">Баланс</h1>
        </div>
        <div className="rounded-2xl border border-[var(--line)] p-3 text-[var(--text-dim)]">
          <IconWallet size={22} />
        </div>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="panel panel-glow p-5"
      >
        <p className="text-[11px] font-medium text-[var(--text-dim)]">Доступно</p>
        <p className="mono mt-1 text-[32px] font-semibold tracking-tight">
          {me ? Number(me.balance).toFixed(4) : "—"}
          <span className="ml-1 text-sm font-normal text-[var(--text-dim)]">TON</span>
        </p>
      </motion.div>

      <div className="panel space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold">Вывод</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-dim)]">
            Средства холдятся до решения владельца. При отказе — возврат на баланс.
          </p>
        </div>
        <label className="block text-[11px] font-medium text-[var(--text-dim)]">
          Сумма
          <input
            className="input-field mono"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="block text-[11px] font-medium text-[var(--text-dim)]">
          Адрес TON
          <input
            className="input-field mono text-[13px]"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="UQ… / EQ…"
          />
        </label>
        <button type="button" className="btn-primary w-full" disabled={loading} onClick={submit}>
          Запросить вывод
        </button>
        {msg && <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">{msg}</p>}
      </div>
    </div>
  );
}
