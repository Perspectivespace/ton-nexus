import { useState } from "react";
import { motion } from "framer-motion";
import { useMe, useMyWithdrawals } from "@/api/hooks";
import { api } from "@/api/client";
import { IconOut } from "@/components/icons";
import { Button, Field, HoldButton, List, ListRow, Num, Panel, ScreenHeader, SectionLabel, Sheet, Tag, useToast, type Tone } from "@/components/ui";

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
  const [loading, setLoading] = useState(false);
  const [ask, setAsk] = useState(false);
  const toast = useToast();

  const ready = amount.trim() !== "" && wallet.trim() !== "";

  async function submit() {
    setAsk(false);
    setLoading(true);
    try {
      await api("/api/v1/withdraw", {
        method: "POST",
        body: JSON.stringify({ amount, wallet_address: wallet }),
      });
      toast({ kind: "ok", title: "Заявка на вывод создана", sub: `${amount} TON · подтвердят вручную` });
      refetch();
      mine.refetch();
    } catch (e) {
      toast({ kind: "danger", title: "Заявка не создана", sub: e instanceof Error ? e.message : "Ошибка" });
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
        <Field label="Сумма" unit="TON">
          <input
            className="ui-input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Адрес TON">
          <input
            className="ui-input"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="UQ… / EQ…"
          />
        </Field>
        <span className="ui-spill">
          <Button kind="primary" size="lg" block icon={<IconOut size={20} />} disabled={loading || !ready} onClick={() => setAsk(true)}>
            Запросить вывод
          </Button>
        </span>
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

      <Sheet open={ask} onClose={() => setAsk(false)} title="Вывод TON">
        <p className="ui-label">Сумма</p>
        <Num value={amount.trim()} unit="TON" size="l" className="mt-1 block" />
        <p className="ui-label mt-4">На адрес</p>
        <p className="mono mt-1 break-all text-[13px] leading-snug text-[var(--text)]">{wallet.trim()}</p>
        <p className="ui-sec mt-4">
          Сумма сразу уйдёт в холд. Владелец выплатит вручную; при отказе TON вернётся на баланс.
        </p>
        <div className="mt-5 grid gap-2">
          <HoldButton block disabled={loading} onConfirm={submit}>
            Удерживайте — вывести
          </HoldButton>
          <Button kind="ghost" block onClick={() => setAsk(false)}>
            Отмена
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
