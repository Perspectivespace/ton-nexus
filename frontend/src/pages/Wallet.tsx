import { useMe } from "@/api/hooks";
import { useState } from "react";
import { api } from "@/api/client";

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
      setMsg("Заявка отправлена. Ожидает подтверждения владельца.");
      refetch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">Кошелёк</p>
        <h1 className="text-2xl font-semibold">Баланс</h1>
      </header>

      <div className="panel p-4">
        <p className="text-xs text-[var(--text-dim)]">Доступно</p>
        <p className="mono text-3xl">
          {me ? Number(me.balance).toFixed(4) : "—"}{" "}
          <span className="text-sm text-[var(--text-dim)]">TON</span>
        </p>
      </div>

      <div className="panel space-y-3 p-4">
        <h2 className="text-sm font-medium">Вывод (manual)</h2>
        <label className="block text-xs text-[var(--text-dim)]">
          Сумма
          <input
            className="mt-1 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--bg-elevated)] px-3 py-2 text-[var(--text)] outline-none"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="block text-xs text-[var(--text-dim)]">
          Адрес TON (UQ/EQ…)
          <input
            className="mt-1 w-full rounded-xl border border-[var(--line-strong)] bg-[var(--bg-elevated)] px-3 py-2 font-mono text-sm text-[var(--text)] outline-none"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="UQ..."
          />
        </label>
        <button type="button" className="btn-primary w-full" disabled={loading} onClick={submit}>
          Запросить вывод
        </button>
        {msg && <p className="text-sm text-[var(--text-dim)]">{msg}</p>}
      </div>
    </div>
  );
}
