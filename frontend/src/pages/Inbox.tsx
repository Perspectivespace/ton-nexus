import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import {
  useMe,
  usePendingSubmissions,
  useReviewSubmission,
  usePendingTaskApprovals,
  useApproveTask,
  useRejectTask,
  type InboxSubmission,
} from "@/api/hooks";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  EmptyPanel,
  Field,
} from "@/components/ui";

function SubmissionCard({
  item,
  onDone,
}: {
  item: InboxSubmission;
  onDone: () => void;
}) {
  const review = useReviewSubmission();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

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
      className="ui-cut space-y-3 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-mono text-[var(--text-dim)]">
            sub #{item.id} · task #{item.task_id}
          </p>
          <p className="mt-0.5 text-[12px] text-[var(--text-dim)]">user #{item.user_id}</p>
        </div>
        <StatusPill tone="live">на проверке</StatusPill>
      </div>

      {item.proof_text && (
        <div>
          <p className="eyebrow mb-1">Proof</p>
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{item.proof_text}</p>
        </div>
      )}

      {item.proof_url && (
        <a
          href={item.proof_url}
          target="_blank"
          rel="noopener noreferrer"
          className="ui-btn secondary sm"
        >
          Открыть proof URL ↗
        </a>
      )}

      {!item.proof_text && !item.proof_url && (
        <p className="text-[12px] text-[var(--text-dim)]">Proof не приложен</p>
      )}

      <Field label="Заметка модератора">
        <input
          className="ui-input sans"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="опционально"
          disabled={!!busy}
        />
      </Field>

      <div className="flex gap-2">
        <button
          type="button"
          className="ui-btn primary flex-1"
          disabled={!!busy}
          onClick={() => act(true)}
        >
          {busy === "approve" ? "…" : "Одобрить"}
        </button>
        <button
          type="button"
          className="ui-btn danger flex-1"
          disabled={!!busy}
          onClick={() => act(false)}
        >
          {busy === "reject" ? "…" : "Отклонить"}
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

export function Inbox() {
  const { data: me, isLoading: meLoading } = useMe();
  const subs = usePendingSubmissions();
  const approvals = usePendingTaskApprovals();
  const approveTask = useApproveTask();
  const rejectTask = useRejectTask();

  const canModerate = me?.is_owner || me?.is_admin || me?.is_ambassador;

  if (meLoading || subs.isLoading) {
    return <LoadingPanel label="Открытие inbox модерации…" />;
  }

  if (!canModerate) {
    return (
      <div className="space-y-4">
        <ScreenHeader eyebrow="Модерация" title="Входящие" />
        <ErrorPanel message="Inbox для амбассадоров, админов и владельца." />
        <Link to="/" className="ui-btn secondary sm no-underline">
          ← Контур
        </Link>
      </div>
    );
  }

  if (subs.isError) {
    return <ErrorPanel message="Не удалось загрузить очередь сдач" />;
  }

  const list = subs.data || [];
  const pendingTasks = approvals.data || [];
  const showTaskQueue = me?.is_admin || me?.is_owner;

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Модерация"
        title="Входящие"
        action={
          <StatusPill tone={list.length ? "live" : "ok"}>{list.length} сдач</StatusPill>
        }
      />

      <div className="ui-cut hero p-4">
        <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
          Approve начисляет TON и XP исполнителю. Reject — без выплаты. Слоты задания обновляются
          автоматически.
        </p>
      </div>

      {showTaskQueue && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Публикации заданий</p>
            <StatusPill tone={pendingTasks.length ? "warn" : "neutral"}>
              {pendingTasks.length} на одобрение
            </StatusPill>
          </div>

          {approvals.isError && (
            <p className="text-[12px] text-[var(--text-dim)]">
              Очередь публикаций недоступна (нужны admin/owner).
            </p>
          )}

          {!approvals.isError && pendingTasks.length === 0 && (
            <p className="text-[12px] text-[var(--text-dim)]">Нет заданий на approve</p>
          )}

          {pendingTasks.map((t) => (
            <div key={t.id} className="ui-cut space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[14px] font-medium">{t.title}</p>
                  <p className="mt-1 line-clamp-2 text-[12px] text-[var(--text-dim)]">
                    {t.description}
                  </p>
                  <p className="mono mt-2 text-[11px] text-[var(--accent)]">
                    {Number(t.reward).toFixed(4)} TON · {t.total_slots} слотов
                  </p>
                </div>
                <StatusPill tone="warn">ждёт</StatusPill>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="ui-btn primary flex-1"
                  disabled={approveTask.isPending}
                  onClick={() => approveTask.mutate(t.id)}
                >
                  Одобрить
                </button>
                <button
                  type="button"
                  className="ui-btn danger flex-1"
                  disabled={rejectTask.isPending}
                  onClick={() => rejectTask.mutate(t.id)}
                >
                  Отклонить
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Сдачи proof</p>
          <StatusPill tone={subs.isFetching ? "live" : "neutral"}>
            {subs.isFetching ? "синхр." : `${list.length}`}
          </StatusPill>
        </div>

        {list.length === 0 && (
          <EmptyPanel
            title="Очередь пуста"
            body="Новых сдач нет. Когда пользователь отправит proof — он появится здесь."
          />
        )}

        <AnimatePresence mode="popLayout">
          {list.map((item) => (
            <SubmissionCard key={item.id} item={item} onDone={() => subs.refetch()} />
          ))}
        </AnimatePresence>
      </section>

      <Link to="/tasks" className="ui-btn secondary sm no-underline">
        ← Лента заданий
      </Link>
    </div>
  );
}
