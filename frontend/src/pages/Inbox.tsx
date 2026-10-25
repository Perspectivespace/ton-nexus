import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  SectionLabel,
  useToast,
} from "@/components/ui";
import { useScreenBack } from "@/lib/backButton";
import { BackLink } from "@/components/BackLink";

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
  const toast = useToast();

  async function act(approve: boolean) {
    setBusy(approve ? "approve" : "reject");
    try {
      await review.mutateAsync({
        id: item.id,
        approve,
        note: note.trim() || null,
      });
      toast({ kind: approve ? "ok" : "info", title: approve ? "Сдача одобрена" : "Сдача отклонена", sub: `#${item.id}` });
      onDone();
    } catch (e) {
      toast({ kind: "danger", title: "Решение не сохранено", sub: e instanceof Error ? e.message : "Ошибка" });
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
            сдача #{item.id} · задание #{item.task_id}
          </p>
          <p className="mt-0.5 text-[12px] text-[var(--text-dim)]">пользователь #{item.user_id}</p>
        </div>
        <StatusPill tone="live">на проверке</StatusPill>
      </div>

      {item.proof_text && (
        <div>
          <p className="ui-label mb-1">Подтверждение</p>
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
          Открыть ссылку ↗
        </a>
      )}

      {!item.proof_text && !item.proof_url && (
        <p className="text-[12px] text-[var(--text-dim)]">Подтверждение не приложено</p>
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
  useScreenBack("/");
  const { data: me, isLoading: meLoading } = useMe();
  const subs = usePendingSubmissions();
  const approvals = usePendingTaskApprovals();
  const approveTask = useApproveTask();
  const rejectTask = useRejectTask();
  const toast = useToast();

  const canModerate = me?.is_owner || me?.is_admin || me?.is_ambassador;

  if (meLoading || subs.isLoading) {
    return <LoadingPanel label="Открываем модерацию…" />;
  }

  if (!canModerate) {
    return (
      <div className="space-y-4">
        <ScreenHeader eyebrow="Управление" title="Модерация" />
        <ErrorPanel message="Модерация доступна амбассадорам, админам и владельцу." />
        <BackLink />
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
        eyebrow="Управление"
        title="Модерация"
        action={
          <StatusPill tone={list.length ? "live" : "ok"}>{list.length} сдач</StatusPill>
        }
      />

      <div className="ui-cut hero p-4">
        <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
          «Одобрить» начисляет TON и XP исполнителю. «Отклонить» — без выплаты. Слоты задания
          обновляются автоматически.
        </p>
      </div>

      {showTaskQueue && (
        <section className="space-y-3">
          <SectionLabel
            action={
              <StatusPill tone={pendingTasks.length ? "warn" : "neutral"}>
                {pendingTasks.length} на одобрение
              </StatusPill>
            }
          >
            Публикации заданий
          </SectionLabel>

          {approvals.isError && (
            <p className="ui-onbg text-[12px]">Очередь публикаций недоступна (нужны права админа или владельца).</p>
          )}

          {!approvals.isError && pendingTasks.length === 0 && (
            <p className="ui-onbg text-[12px]">Нет заданий на одобрение</p>
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
                  onClick={() =>
                    approveTask.mutate(t.id, {
                      onSuccess: () => toast({ kind: "ok", title: "Задание опубликовано", sub: `#${t.id}` }),
                      onError: (e) => toast({ kind: "danger", title: "Не удалось одобрить", sub: e.message }),
                    })
                  }
                >
                  Одобрить
                </button>
                <button
                  type="button"
                  className="ui-btn danger flex-1"
                  disabled={rejectTask.isPending}
                  onClick={() =>
                    rejectTask.mutate(t.id, {
                      onSuccess: () => toast({ kind: "info", title: "Задание отклонено", sub: `#${t.id}` }),
                      onError: (e) => toast({ kind: "danger", title: "Не удалось отклонить", sub: e.message }),
                    })
                  }
                >
                  Отклонить
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <SectionLabel
          action={
            <StatusPill tone={subs.isFetching ? "live" : "neutral"}>
              {subs.isFetching ? "синхр." : `${list.length}`}
            </StatusPill>
          }
        >
          Сдачи на проверку
        </SectionLabel>

        {list.length === 0 && (
          <EmptyPanel
            title="Очередь пуста"
            body="Новых сдач нет. Когда пользователь отправит подтверждение, оно появится здесь."
          />
        )}

        <AnimatePresence mode="popLayout">
          {list.map((item) => (
            <SubmissionCard key={item.id} item={item} onDone={() => subs.refetch()} />
          ))}
        </AnimatePresence>
      </section>

      <BackLink />
    </div>
  );
}
