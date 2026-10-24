import { useState } from "react";
import { motion } from "framer-motion";
import { useMe, useMyWithdrawals } from "@/api/hooks";
import { api } from "@/api/client";
import { IconOut } from "@/components/icons";
import { Button, List, ListRow, Num, Panel, ScreenHeader, SectionLabel, Tag, type Tone } from "@/components/ui";

const W_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "ожидает", tone: "warn" },
  paid: { label: "выплачено", tone: "ok" },
  rejected: { label: "отклонено", tone: "danger" },
  approved: { label: "одобрено", tone: "ok" },
};

export function Wallet() {
  const { data: me, refetch } = useMe();
  const mine = useMyWithdrawals();
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
      mine.refetch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <ScreenHeader eyebrow="Кошелёк" title="Баланс" />

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Panel level="hero" see cut="l" lift="l2" className="p-5">
          <p className="ui-label ui-shade">Доступно</p>
          <Num
            value={me ? Number(me.balance).toFixed(4) : "—"}
            unit="TON"
            size="xl"
            glow
            className="ui-shade mt-2 block !text-[40px] !leading-[48px]"
          />
        </Panel>
      </motion.div>

      <Panel className="space-y-4 p-5">
        <div>
          <h2 className="ui-h">Вывод</h2>
          <p className="ui-sec mt-1">Средства холдятся до решения владельца. При отказе — возврат на баланс.</p>
        </div>
        <label className="block ui-sec">
          Сумма
          <input
            className="input-field mono"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="block ui-sec">
          Адрес TON
          <input
            className="input-field mono text-[13px]"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="UQ… / EQ…"
          />
        </label>
        <span className="ui-spill">
          <Button kind="primary" size="lg" block icon={<IconOut size={20} />} disabled={loading} onClick={submit}>
            Запросить вывод
          </Button>
        </span>
        {msg && <p className="ui-sec">{msg}</p>}
      </Panel>

      {(mine.data?.length ?? 0) > 0 && (
        <div className="space-y-2.5">
          <SectionLabel>Мои заявки</SectionLabel>
          <List>
            {(mine.data || []).slice(0, 5).map((w) => {
              const st = W_STATUS[w.status] ?? { label: w.status, tone: "neutral" as Tone };
              return (
                <ListRow
                  key={w.id}
                  title={<span className="ui-num s-m">{Number(w.amount).toFixed(4)} TON</span>}
                  trailing={<Tag tone={st.tone}>{st.label}</Tag>}
                />
              );
            })}
          </List>
        </div>
      )}
    </div>
  );
}
