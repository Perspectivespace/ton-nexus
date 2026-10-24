import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useMe, useTask, useTaskSubmit } from "@/api/hooks";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  Readout,
  Field,
} from "@/components/ui";

const TASK_STATUS_RU: Record<string, string> = {
  active: "активно",
  draft: "черновик",
  pending_approval: "на одобрении",
  paused: "пауза",
  rejected: "отклонено",
  completed: "завершено",
  closed: "закрыто",
};

export function TaskDetail() {
  const { id } = useParams();
  const taskId = Number(id) || 0;
  const { data: me } = useMe();
  const { data: t, isLoading, error } = useTask(taskId);
  const submit = useTaskSubmit(taskId);
  const [proofText, setProofText] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [done, setDone] = useState(false);

  async function onSubmit() {
    try {
      await submit.mutateAsync({
        proof_text: proofText.trim() || null,
        proof_url: proofUrl.trim() || null,
      });
      setDone(true);
    } catch {
      /* */
    }
  }

  if (isLoading) return <LoadingPanel label="Загрузка задания…" />;
  if (error || !t) return <ErrorPanel message="Задание не найдено или недоступно" />;

  const slotsLeft = t.total_slots - t.filled_slots;
  const levelOk = (me?.level ?? 1) >= t.min_level;
  const isOwn = me?.id === t.creator_id;
  const canSubmit =
    t.status === "active" && slotsLeft > 0 && levelOk && !isOwn && !done && !submit.isSuccess;

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Задание"
        title={t.title}
        action={
          <Link
            to="/tasks"
            className="rounded-xl border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-dim)] no-underline"
          >
            ← Лента
          </Link>
        }
      />

      <div className="panel panel-glow space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={t.status === "active" ? "live" : "neutral"}>{TASK_STATUS_RU[t.status] ?? t.status}</StatusPill>
          <StatusPill tone={slotsLeft > 0 ? "ok" : "warn"}>
            {t.filled_slots}/{t.total_slots} слотов
          </StatusPill>
          {!levelOk && <StatusPill tone="danger">нужен ур. {t.min_level}</StatusPill>}
          {isOwn && <StatusPill tone="neutral">ваше задание</StatusPill>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Readout label="Награда" value={Number(t.reward).toFixed(4)} unit="TON" />
          <Readout label="Опыт" value={`+${t.xp_reward}`} unit="XP" />
        </div>

        <div>
          <p className="eyebrow mb-2">Бриф</p>
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{t.description}</p>
        </div>

        {t.target_url && (
          <a
            href={t.target_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost inline-flex text-[13px]"
          >
            Открыть ссылку задания ↗
          </a>
        )}
      </div>

      <div className="panel space-y-4 p-5">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Сдача</p>
          <StatusPill
            tone={done || submit.isSuccess ? "ok" : canSubmit ? "live" : "neutral"}
          >
            {done || submit.isSuccess
              ? "на проверке"
              : canSubmit
                ? "готово к сдаче"
                : "закрыто"}
          </StatusPill>
        </div>

        {!canSubmit && !done && !submit.isSuccess && (
          <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
            {isOwn
              ? "Нельзя сдавать своё задание."
              : !levelOk
                ? `Требуется уровень ${t.min_level}.`
                : slotsLeft <= 0
                  ? "Слоты закончились."
                  : t.status !== "active"
                    ? "Задание неактивно."
                    : "Сдача недоступна."}
          </p>
        )}

        {(canSubmit || done || submit.isSuccess) && (
          <>
            <Field label="Подтверждение (текст)">
              <textarea
                className="ui-input"
                value={proofText}
                disabled={done || submit.isSuccess || submit.isPending}
                onChange={(e) => setProofText(e.target.value)}
                placeholder="Скрин / описание выполнения…"
              />
            </Field>
            <Field label="Ссылка на подтверждение">
              <input
                className="ui-input"
                value={proofUrl}
                disabled={done || submit.isSuccess || submit.isPending}
                onChange={(e) => setProofUrl(e.target.value)}
                placeholder="https://…"
              />
            </Field>

            {canSubmit && (
              <button
                type="button"
                className="btn-primary w-full"
                disabled={submit.isPending || (!proofText.trim() && !proofUrl.trim())}
                onClick={onSubmit}
              >
                {submit.isPending ? "Отправка…" : "Сдать на проверку"}
              </button>
            )}
          </>
        )}

        {submit.isError && (
          <ErrorPanel
            message={submit.error instanceof Error ? submit.error.message : "Ошибка сдачи"}
          />
        )}

        <AnimatePresence>
          {(done || submit.isSuccess) && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-[var(--success)]/25 bg-[var(--success)]/5 p-4 text-[13px] leading-relaxed"
            >
              Заявка ушла модератору. После approve —{" "}
              <span className="mono font-semibold text-[var(--success)]">
                {Number(t.reward).toFixed(4)} TON
              </span>
              {t.xp_reward > 0 && ` и +${t.xp_reward} XP`}.
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
