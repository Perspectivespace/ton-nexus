import { useState } from "react";
import { motion } from "framer-motion";
import { useMe, useMyWithdrawals, useWithdrawLimits } from "@/api/hooks";
import { PromoPanel } from "@/components/PromoPanel";
import { WorkArea } from "@/components/WorkArea";
import { api } from "@/api/client";
import { IconOut } from "@/components/icons";
import { Button, Field, HoldButton, List, ListRow, Num, Panel, ScreenHeader, SectionLabel, Sheet, Tag, useToast, type Tone } from "@/components/ui";

/** Тот же формат, что проверяет сервер */
const TON_ADDR = /^(UQ|EQ)[A-Za-z0-9_-]{46}$/;

const W_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "на проверке", tone: "warn" },
  paid: { label: "выплачено", tone: "ok" },
  rejected: { label: "отклонено", tone: "danger" },
  approved: { label: "одобрено", tone: "ok" },
};

function shortAddr(a: string) {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a;
}

function fmtDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function Wallet() {
  const { data: me, refetch } = useMe();
  const mine = useMyWithdrawals();
  const limits = useWithdrawLimits();
  const [typed, setAmount] = useState<string | null>(null);
  const [wallet, setWallet] = useState("");
  const [loading, setLoading] = useState(false);
  const [ask, setAsk] = useState(false);
  const toast = useToast();

  const min = limits.data ? Number(limits.data.min_ton) : null;
  const amount = typed ?? (limits.data?.min_ton ? String(Number(limits.data.min_ton)) : "");
  const sum = Number(amount.replace(",", "."));
  const balance = me ? Number(me.balance) : null;
  const pending = (mine.data || []).find((w) => w.status === "pending");
  const addr = wallet.trim();
  const addrOk = TON_ADDR.test(addr);

  // Кнопка отражает доступность (п. 14, правило 13): первая причина, почему вывести нельзя
  const why = !amount.trim() || !Number.isFinite(sum) || sum <= 0
      ? "Введите сумму."
      : min != null && sum < min
        ? `Минимум для вывода — ${min} TON.`
        : balance != null && sum > balance
          ? `На балансе ${balance.toFixed(4)} TON — меньше суммы вывода.`
          : !addr
            ? "Укажите адрес TON."
            : !addrOk
              ? "Адрес TON начинается с UQ или EQ, всего 48 символов."
              : null;
  const ready = !why;

  async function submit() {
    setAsk(false);
    setLoading(true);
    try {
      await api("/api/v1/withdraw", {
        method: "POST",
        body: JSON.stringify({ amount: amount.replace(",", "."), wallet_address: addr }),
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
      <ScreenHeader title="Профиль" />

      {/* «Управление» команды — временно вверху «Профиля» (до PR «б»); для обычного игрока не рендерится */}
      <WorkArea />

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

      {pending ? (
        // Пока заявка на проверке, форма не нужна: новую всё равно не создать — показываем статус
        <Panel className="space-y-3 p-5" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <h2 className="ui-h">Вывод</h2>
            <Tag tone="warn">на проверке</Tag>
          </div>
          <Num value={Number(pending.amount).toFixed(4)} unit="TON" size="l" className="block" />
          <p className="mono text-[12px] leading-[16px] text-[var(--text-2)]">
            {[shortAddr(pending.wallet_address || ""), fmtDate(pending.created_at)].filter(Boolean).join(" · ")}
          </p>
          <p className="ui-sec">
            Сумма заморожена до решения владельца. При отказе вернётся на баланс. Новую заявку можно создать после решения.
          </p>
        </Panel>
      ) : (
        <Panel className="space-y-4 p-5">
          <div>
            <h2 className="ui-h">Вывод</h2>
            <p className="ui-sec mt-1">
              Сумма замораживается до решения владельца. При отказе — возврат на баланс.
              {min != null && ` Минимум — ${min} TON.`}
            </p>
          </div>
          <Field label="Сумма" unit="TON">
            <input
              className="ui-input"
              inputMode="decimal"
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
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <span className="ui-spill">
            <Button kind="primary" size="lg" block icon={<IconOut size={20} />} disabled={loading || !ready} aria-describedby={why ? "withdraw-why" : undefined} onClick={() => setAsk(true)}>
              Запросить вывод
            </Button>
          </span>
          {why && (
            <p id="withdraw-why" className="ui-sec !text-[12px] !leading-[16px]">
              {why}
            </p>
          )}
        </Panel>
      )}

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

      <PromoPanel />

      <Sheet open={ask} onClose={() => setAsk(false)} title="Вывод TON">
        <p className="ui-label">Сумма</p>
        <Num value={amount.trim()} unit="TON" size="l" className="mt-1 block" />
        <p className="ui-label mt-4">На адрес</p>
        <p className="mono mt-1 break-all text-[13px] leading-snug text-[var(--text)]">{addr}</p>
        <p className="ui-sec mt-4">
          Сумма сразу заморозится. Владелец выплатит вручную; при отказе TON вернётся на баланс.
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
