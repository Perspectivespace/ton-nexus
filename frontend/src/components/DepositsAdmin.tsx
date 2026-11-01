import { useState } from "react";
import {
  useAdminDeposits,
  useAssignDeposit,
  type AdminDeposit,
} from "@/api/hooks";
import {
  EmptyPanel,
  ErrorPanel,
  Field,
  LoadingPanel,
  Readout,
  StatusPill,
  useToast,
} from "@/components/ui";

const STATUS_RU: Record<string, string> = {
  unmatched: "без мемо",
  below_min: "меньше минимума",
};

function when(d: AdminDeposit) {
  const date = d.utime ? new Date(d.utime * 1000) : new Date(d.created_at);
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const short = (s: string) =>
  s.length > 20 ? `${s.slice(0, 10)}…${s.slice(-6)}` : s;

function DepositCard({
  item,
  canAssign,
}: {
  item: AdminDeposit;
  canAssign: boolean;
}) {
  const assign = useAssignDeposit();
  const toast = useToast();
  const [tg, setTg] = useState("");
  const [note, setNote] = useState("");
  const tgValid = /^\d{1,15}$/.test(tg.trim());

  async function submit() {
    try {
      await assign.mutateAsync({
        id: item.id,
        telegram_id: Number(tg.trim()),
        note: note.trim() || null,
      });
      toast({
        kind: "ok",
        title: "Зачислено",
        sub: `${item.amount_ton} TON → ${tg.trim()}`,
      });
    } catch (e) {
      toast({
        kind: "danger",
        title: "Не зачислено",
        sub: e instanceof Error ? e.message : "Ошибка",
      });
    }
  }

  return (
    <div className="ui-cut space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[11px] text-[var(--text-dim)]">
          перевод #{item.id} · {when(item)}
        </p>
        <StatusPill tone="warn">
          {STATUS_RU[item.status] ?? item.status}
        </StatusPill>
      </div>
      <Readout label="Сумма" value={item.amount_ton} unit="TON" />
      <div className="space-y-1 text-[12px]">
        <p className="break-all text-[var(--text-dim)]">
          Комментарий:{" "}
          <span className="mono text-[var(--text)]">{item.comment || "—"}</span>
        </p>
        {item.from_address && (
          <p className="text-[var(--text-dim)]">
            От:{" "}
            <span className="mono text-[var(--text)]">
              {short(item.from_address)}
            </span>
          </p>
        )}
        <p className="text-[var(--text-dim)]">
          Хеш:{" "}
          <span className="mono text-[var(--text)]">{short(item.tx_hash)}</span>
        </p>
      </div>
      {canAssign && (
        <div className="space-y-2">
          <Field label="Telegram ID игрока">
            <input
              className="ui-input"
              inputMode="numeric"
              value={tg}
              onChange={(e) => setTg(e.target.value)}
              placeholder="например 123456789"
              disabled={assign.isPending}
            />
          </Field>
          <Field label="Заметка">
            <input
              className="ui-input"
              value={note}
              maxLength={255}
              onChange={(e) => setNote(e.target.value)}
              placeholder="почему зачисляем вручную"
              disabled={assign.isPending}
            />
          </Field>
          <button
            type="button"
            className="ui-btn primary w-full"
            disabled={!tgValid || assign.isPending}
            onClick={submit}
          >
            {assign.isPending ? "…" : `Зачислить ${item.amount_ton} TON`}
          </button>
        </div>
      )}
    </div>
  );
}

/** Касса → «Пополнения»: переводы, которые не зачислились сами. Зачислять может только владелец. */
export function DepositsAdmin({ isOwner }: { isOwner: boolean }) {
  const q = useAdminDeposits();
  if (q.isLoading) return <LoadingPanel label="Загрузка пополнений…" />;
  if (q.isError)
    return <ErrorPanel message="Не удалось загрузить пополнения" />;
  const list = q.data || [];
  return (
    <div className="space-y-4">
      <div className="ui-cut hero p-4">
        <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
          Переводы без мемо или меньше минимума. Найдите игрока по комментарию
          или по его сообщению и зачислите вручную — сумма попадёт на баланс
          один раз.
          {!isOwner && " Зачислять может только владелец."}
        </p>
      </div>
      {list.length === 0 ? (
        <EmptyPanel
          title="Всё зачислено"
          body="Нет переводов, ждущих ручного зачисления."
        />
      ) : (
        list.map((d) => <DepositCard key={d.id} item={d} canAssign={isOwner} />)
      )}
    </div>
  );
}
