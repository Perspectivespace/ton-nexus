import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import {
  useMe,
  usePendingWithdrawals,
  useReviewWithdraw,
  type WithdrawOut,
} from "@/api/hooks";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  EmptyPanel,
  Readout,
} from "@/components/ui";

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function WithdrawCard({
  item,
  onDone,
}: {
  item: WithdrawOut;
  onDone: () => void;
}) {
  const review = useReviewWithdraw();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [copied, setCopied] = useState(false);

  async function copyWallet() {
    try {
      await navigator.clipboard.writeText(item.wallet_address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* */
    }
  }

  async function act(approve: boolean) {
    setBusy(approve ? "approve" : "reject");
    try {
      await review.mutateAsync({
        id: item.id,
        approve,
        note: note.trim() || null,
      });
      onDone();
    } catch {
      /* */
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="panel space-y-4 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-mono text-[var(--text-dim)]">
            req #{item.id} · user #{item.user_id}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--text-dim)]">{formatDate(item.created_at)}</p>
        </div>
        <StatusPill tone="warn">hold</StatusPill>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <Readout label="Сумма (hold)" value={Number(item.amount).toFixed(4)} unit="TON" />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)]">
            Кошелёк
          </p>
          <button
            type="button"
            onClick={copyWallet}
            className="mono mt-1 w-full break-all rounded-xl border border-[var(--line)] bg-white/[0.02] px-3 py-2 text-left text-[12px] text-[var(--text)]"
          >
            {item.wallet_address}
            <span className="mt-1 block text-[10px] text-[var(--accent)]">
              {copied ? "скопировано" : "тап — копировать"}
            </span>
          </button>
        </div>
      </div>

      <label className="block text-[11px] font-medium text-[var(--text-dim)]">
        Заметка
        <input
          className="input-field"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="tx hash / причина отказа"
          disabled={!!busy}
        />
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary flex-1"
          disabled={!!busy}
          onClick={() => act(true)}
        >
          {busy === "approve" ? "…" : "Approve · выплатить"}
        </button>
        <button
          type="button"
          className="btn-ghost flex-1 border-[var(--danger)]/40 text-[var(--danger)]"
          disabled={!!busy}
          onClick={() => act(false)}
        >
          {busy === "reject" ? "…" : "Reject · возврат"}
        </button>
      </div>

      {review.isError && (
        <p className="text-[12px] text-[var(--danger)]">
          {review.error instanceof Error ? review.error.message : "Ошибка"}
        </p>
      )}
    </motion.div>
  );
}

export function WithdrawQueue() {
  const { data: me, isLoading: meLoading } = useMe();
  const q = usePendingWithdrawals();

  const allowed = me?.is_owner || me?.is_admin;

  if (meLoading || q.isLoading) {
    return <LoadingPanel label="Загрузка очереди выводов…" />;
  }

  if (!allowed) {
    return (
      <div className="space-y-4">
        <ScreenHeader eyebrow="Касса" title="Выводы" />
        <ErrorPanel message="Очередь только для owner / admin." />
        <Link to="/" className="btn-ghost inline-flex text-[13px] no-underline">
          ← Контур
        </Link>
      </div>
    );
  }

  if (q.isError) {
    return <ErrorPanel message="Не удалось загрузить pending withdraw" />;
  }

  const list = q.data || [];

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Касса"
        title="Выводы"
        action={
          <StatusPill tone={list.length ? "warn" : "ok"}>{list.length} hold</StatusPill>
        }
      />

      <div className="panel panel-glow p-4">
        <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
          Средства уже списаны с баланса (hold). Approve — фиксируете внешнюю выплату. Reject — TON
          возвращается пользователю.
        </p>
      </div>

      {list.length === 0 && (
        <EmptyPanel
          title="Очередь пуста"
          body="Нет заявок в статусе pending. Новые запросы появятся здесь."
        />
      )}

      <AnimatePresence mode="popLayout">
        {list.map((item) => (
          <WithdrawCard key={item.id} item={item} onDone={() => q.refetch()} />
        ))}
      </AnimatePresence>

      <div className="flex gap-2">
        <Link to="/owner" className="btn-ghost flex-1 justify-center text-[13px] no-underline">
          Экономика
        </Link>
        <Link to="/" className="btn-ghost flex-1 justify-center text-[13px] no-underline">
          Контур
        </Link>
      </div>
    </div>
  );
}
