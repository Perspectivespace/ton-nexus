import { useState } from "react";
import { motion } from "framer-motion";
import { useMe, useMyWithdrawals, useWithdrawLimits } from "@/api/hooks";
import type { MeOut } from "@/api/types";
import { WorkArea } from "@/components/WorkArea";
import { api } from "@/api/client";
import { IconGear, IconHistory, IconOut } from "@/components/icons";
import { prefersReducedMotion } from "@/components/ui/press";
import { Button, Field, HoldButton, List, ListRow, Num, Panel, ScreenHeader, Sheet, Tag, useToast, type Tone } from "@/components/ui";

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

/** Метка уровня в шапке «Профиля»: «ур. 7 · 1 240 XP» */
export function levelTag(me: Pick<MeOut, "level" | "xp"> | undefined) {
  if (!me) return null;
  return `ур. ${me.level} · ${me.xp.toLocaleString("ru-RU")} XP`;
}

type Panel3 = "withdraw" | "history" | "settings" | null;

/**
 * «Профиль» (/wallet, псевдоним /profile, DESIGN.md §14.1): уровень в шапке, баланс,
 * строки «Вывод», «История», «Настройки» (каждая открывает шторку) и последним — «Управление» команды.
 */
export function Wallet() {
  const { data: me, refetch } = useMe();
  const mine = useMyWithdrawals();
  const limits = useWithdrawLimits();
  const [typed, setAmount] = useState<string | null>(null);
  const [wallet, setWallet] = useState("");
  const [loading, setLoading] = useState(false);
  const [sheet, setSheet] = useState<Panel3>(null);
  const [ask, setAsk] = useState(false);
  const toast = useToast();

  const min = limits.data ? Number(limits.data.min_ton) : null;
  const amount = typed ?? (limits.data?.min_ton ? String(Number(limits.data.min_ton)) : "");
  const sum = Number(amount.replace(",", "."));
  const balance = me ? Number(me.balance) : null;
  const list = mine.data || [];
  const pending = list.find((w) => w.status === "pending");
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
  const closeSheet = () => {
    setSheet(null);
    setAsk(false);
  };

  async function submit() {
    setLoading(true);
    try {
      await api("/api/v1/withdraw", {
        method: "POST",
        body: JSON.stringify({ amount: amount.replace(",", "."), wallet_address: addr }),
      });
      toast({ kind: "ok", title: "Заявка на вывод создана", sub: `${amount} TON · подтвердят вручную` });
      closeSheet();
      refetch();
      mine.refetch();
    } catch (e) {
      setAsk(false);
      toast({ kind: "danger", title: "Заявка не создана", sub: e instanceof Error ? e.message : "Ошибка" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <ScreenHeader title="Профиль" action={me ? <Tag tone="amber" dot={false}>{levelTag(me)}</Tag> : undefined} />

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
          {me && (me.focus_tokens > 0 || me.block_tokens > 0) && (
            <p className="ui-sec ui-shade mt-1 !text-[12px] !leading-[16px]">
              Жетоны: Фокус <span className="ui-num text-[var(--text)]">{me.focus_tokens}</span> · Запрет{" "}
              <span className="ui-num text-[var(--text)]">{me.block_tokens}</span>
            </p>
          )}
        </Panel>
      </motion.div>

      <List>
        <ListRow
          icon={<IconOut size={20} />}
          title="Вывод"
          sub={
            pending
              ? `${Number(pending.amount).toFixed(4)} TON на проверке`
              : min != null
                ? `На кошелёк TON · от ${min} TON`
                : "На кошелёк TON"
          }
          trailing={pending ? <Tag tone="warn">ждёт</Tag> : undefined}
          onClick={() => setSheet("withdraw")}
        />
        <ListRow
          icon={<IconHistory size={20} />}
          iconTone="muted"
          title="История"
          sub={list.length > 0 ? `Заявки на вывод · ${list.length}` : "Заявок на вывод пока нет"}
          onClick={() => setSheet("history")}
        />
        <ListRow icon={<IconGear size={20} />} iconTone="muted" title="Настройки" sub="Тема, анимации, язык" onClick={() => setSheet("settings")} />
      </List>

      {/* «Управление» команды — последним разделом; игроку не рендерится (видимость по роли — в WorkArea) */}
      <WorkArea />

      <Sheet
        open={sheet === "withdraw"}
        onClose={closeSheet}
        title="Вывод TON"
        sub={ask ? "Проверьте и подтвердите" : pending ? "Заявка на проверке" : `Баланс ${balance != null ? balance.toFixed(4) : "—"} TON`}
        footer={
          pending ? undefined : ask ? (
            <div className="grid gap-2">
              <HoldButton block disabled={loading} onConfirm={submit}>
                Удерживайте — вывести
              </HoldButton>
              <Button kind="ghost" block onClick={() => setAsk(false)}>
                Назад к форме
              </Button>
            </div>
          ) : (
            <span className="ui-spill">
              <Button kind="primary" size="lg" block icon={<IconOut size={20} />} disabled={loading || !ready} aria-describedby={why ? "withdraw-why" : undefined} onClick={() => setAsk(true)}>
                Запросить вывод
              </Button>
            </span>
          )
        }
      >
        {pending ? (
          // Пока заявка на проверке, форма не нужна: новую всё равно не создать — показываем статус
          <div className="space-y-3" aria-live="polite">
            <Num value={Number(pending.amount).toFixed(4)} unit="TON" size="l" className="block" />
            <p className="mono text-[12px] leading-[16px] text-[var(--text-2)]">
              {[shortAddr(pending.wallet_address || ""), fmtDate(pending.created_at)].filter(Boolean).join(" · ")}
            </p>
            <p className="ui-sec">
              Сумма заморожена до решения владельца. При отказе вернётся на баланс. Новую заявку можно создать после решения.
            </p>
          </div>
        ) : ask ? (
          <div>
            <p className="ui-label">Сумма</p>
            <Num value={amount.trim()} unit="TON" size="l" className="mt-1 block" />
            <p className="ui-label mt-4">На адрес</p>
            <p className="mono mt-1 break-all text-[13px] leading-snug text-[var(--text)]">{addr}</p>
            <p className="ui-sec mt-4">Сумма сразу заморозится. Владелец выплатит вручную; при отказе TON вернётся на баланс.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="ui-sec">
              Сумма замораживается до решения владельца. При отказе — возврат на баланс.
              {min != null && ` Минимум — ${min} TON.`}
            </p>
            <Field label="Сумма" unit="TON">
              <input className="ui-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
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
            {why && (
              <p id="withdraw-why" className="ui-sec !text-[12px] !leading-[16px]">
                {why}
              </p>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={sheet === "history"} onClose={closeSheet} title="История" sub="Заявки на вывод TON">
        {list.length === 0 ? (
          <p className="ui-sec">
            Заявок на вывод пока нет. Начисления за майнинг, задания и отметки видны сразу в балансе — отдельной ленты операций пока нет.
          </p>
        ) : (
          <List>
            {list.map((w) => {
              const st = W_STATUS[w.status] ?? { label: w.status, tone: "neutral" as Tone };
              return (
                <ListRow
                  key={w.id}
                  title={<span className="ui-num s-m">{Number(w.amount).toFixed(4)} TON</span>}
                  sub={[fmtDate(w.created_at), shortAddr(w.wallet_address || "")].filter(Boolean).join(" · ")}
                  trailing={<Tag tone={st.tone}>{st.label}</Tag>}
                />
              );
            })}
          </List>
        )}
      </Sheet>

      <Sheet open={sheet === "settings"} onClose={closeSheet} title="Настройки" sub="Берутся из Telegram и системы">
        <SettingsInfo />
      </Sheet>
    </div>
  );
}

/**
 * Настройки — честно только то, что есть: тема и язык идут из Telegram, анимации — из системы и мощности устройства.
 * Переключателей в приложении пока нет, поэтому строки без шеврона.
 */
function SettingsInfo() {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  const theme = root?.dataset.theme === "light" ? "Дневной HUD" : "Ночь";
  const lowEnd = !!root?.classList.contains("low-end");
  const motionMode = prefersReducedMotion() ? "Уменьшены (система)" : lowEnd ? "Облегчённые" : "Полные";
  return (
    <div className="space-y-3">
      <List>
        <ListRow title="Тема" sub="Как в Telegram" value={theme} />
        <ListRow title="Анимации" sub="По системе и мощности устройства" value={motionMode} />
        <ListRow title="Язык" sub="Интерфейс" value="Русский" />
      </List>
      <p className="ui-sec !text-[12px] !leading-[16px]">
        Тема меняется вместе с темой Telegram, анимации — системной настройкой «Уменьшить движение».
      </p>
    </div>
  );
}
