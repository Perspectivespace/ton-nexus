import { useState } from "react";
import { useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useMe, useProofUpload, useTask, useTaskBuy, useTaskSubmit } from "@/api/hooks";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  Readout,
  Field,
  useToast,
} from "@/components/ui";
import { useScreenBack } from "@/lib/backButton";
import { BackLink } from "@/components/BackLink";
import { PartnerBuyPanel } from "@/components/tasks/PartnerBuyPanel";
import { OwnerTaskPanel } from "@/components/tasks/OwnerTaskPanel";
import { ProofUpload, proofFileError } from "@/components/tasks/ProofUpload";

const TASK_STATUS_RU: Record<string, string> = {
  active: "активно",
  draft: "черновик",
  pending_approval: "на одобрении",
  paused: "пауза",
  rejected: "отклонено",
  completed: "завершено",
  closed: "закрыто",
  cancelled: "отменено",
};

export function TaskDetail() {
  useScreenBack("/tasks");
  const { id } = useParams();
  const taskId = Number(id) || 0;
  const { data: me } = useMe();
  const { data: t, isLoading, error } = useTask(taskId);
  const submit = useTaskSubmit(taskId);
  const buy = useTaskBuy(taskId);
  const [proofText, setProofText] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [done, setDone] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  // id уже загруженного файла: если сдача упала, повторно не грузим
  const [uploaded, setUploaded] = useState<{ file: File; id: number } | null>(null);
  const upload = useProofUpload(taskId);
  const toast = useToast();

  async function onSubmit() {
    try {
      let proofUploadId: number | null = null;
      if (proofFile) {
        if (uploaded && uploaded.file === proofFile) {
          proofUploadId = uploaded.id;
        } else {
          const up = await upload.mutateAsync(proofFile);
          setUploaded({ file: proofFile, id: up.id });
          proofUploadId = up.id;
        }
      }
      await submit.mutateAsync({
        proof_text: proofText.trim() || null,
        proof_url: proofUrl.trim() || null,
        proof_upload_id: proofUploadId,
      });
      setDone(true);
      toast({ kind: "ok", title: "Сдано на проверку", sub: "награда придёт после одобрения" });
    } catch (e) {
      toast({ kind: "danger", title: "Не удалось сдать", sub: e instanceof Error ? e.message : "Ошибка" });
    }
  }

  async function onBuy() {
    if (buy.isPending) return;
    try {
      const r = await buy.mutateAsync();
      toast({
        kind: "ok",
        title: r.already ? "Уже куплено" : "Покупка оплачена",
        sub: r.already ? "повторно не списали" : `−${Number(r.amount)} TON${r.xp ? ` · +${r.xp} XP` : ""}`,
      });
    } catch (e) {
      toast({ kind: "danger", title: "Покупка не прошла", sub: e instanceof Error ? e.message : "Ошибка" });
    }
  }

  if (isLoading) return <LoadingPanel label="Загрузка задания…" />;
  if (error || !t) return <ErrorPanel message="Задание не найдено или недоступно" />;

  const slotsLeft = t.total_slots - t.filled_slots;
  const levelOk = (me?.level ?? 1) >= t.min_level;
  const isOwn = me?.id === t.creator_id;
  const isPartnerTask = t.task_type === "partner";
  const canSubmit =
    t.status === "active" && slotsLeft > 0 && levelOk && !isOwn && !done && !submit.isSuccess;
  const proofRequired = !!t.proof_required;
  const proofAllowed = proofRequired || t.task_type === "visit" || t.task_type === "campaign";
  const proofErr = proofFileError(proofFile);
  const sending = submit.isPending || upload.isPending;
  const submitBlocked =
    sending ||
    !!proofErr ||
    (proofRequired ? !proofFile : !proofText.trim() && !proofUrl.trim() && !proofFile);

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Задание"
        title={t.title}
        action={<BackLink to="/tasks" label="Лента" />}
      />

      <div className="ui-cut hero space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={t.status === "active" ? "live" : "neutral"}>{TASK_STATUS_RU[t.status] ?? t.status}</StatusPill>
          <StatusPill tone={slotsLeft > 0 ? "ok" : "warn"}>
            {isPartnerTask ? "продано" : "занято"} {t.filled_slots} из {t.total_slots}
          </StatusPill>
          {!levelOk && <StatusPill tone="danger">нужен ур. {t.min_level}</StatusPill>}
          {proofRequired && <StatusPill tone="neutral">нужен скриншот</StatusPill>}
          {isOwn && <StatusPill tone="neutral">ваше задание</StatusPill>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Readout
            label={isPartnerTask ? "Цена" : "Награда"}
            value={isPartnerTask ? String(Number(t.reward)) : Number(t.reward).toFixed(4)}
            unit="TON"
            hint={isPartnerTask && t.partner_name ? `партнёр ${t.partner_name}` : undefined}
          />
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
            className="ui-btn secondary sm"
          >
            Открыть ссылку задания ↗
          </a>
        )}
      </div>

      {isPartnerTask && (
        <PartnerBuyPanel
          state={{
            status: t.status,
            price: t.reward,
            slotsLeft,
            minLevel: t.min_level,
            myLevel: me?.level ?? 1,
            myBalance: me?.balance ?? null,
            isPartner: me?.id != null && me.id === t.partner_user_id,
            purchased: !!t.purchased || !!buy.data,
            pending: buy.isPending,
            error: buy.isError ? (buy.error instanceof Error ? buy.error.message : "Ошибка покупки") : null,
          }}
          onBuy={onBuy}
        />
      )}

      {me?.is_owner && <OwnerTaskPanel taskId={t.id} />}

      {!isPartnerTask && (
        <div className="ui-cut space-y-4 p-5">
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
                    ? "Места закончились."
                    : t.status !== "active"
                      ? "Задание неактивно."
                      : "Сдача недоступна."}
            </p>
          )}

          {(canSubmit || done || submit.isSuccess) && (
            <>
              {proofAllowed && !(done || submit.isSuccess) && (
                <ProofUpload
                  file={proofFile}
                  onChange={(f) => setProofFile(f)}
                  required={proofRequired}
                  disabled={sending}
                />
              )}
              <Field label={proofRequired ? "Комментарий (необязательно)" : "Подтверждение (текст)"}>
                <textarea
                  className="ui-input"
                  value={proofText}
                  disabled={done || submit.isSuccess || sending}
                  onChange={(e) => setProofText(e.target.value)}
                  placeholder={proofRequired ? "Что сделано, ник/аккаунт…" : "Описание выполнения…"}
                />
              </Field>
              {!proofRequired && (
                <Field label="Ссылка на подтверждение">
                  <input
                    className="ui-input"
                    value={proofUrl}
                    disabled={done || submit.isSuccess || sending}
                    onChange={(e) => setProofUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </Field>
              )}

              {canSubmit && (
                <button
                  type="button"
                  className="ui-btn primary block"
                  disabled={submitBlocked}
                  onClick={onSubmit}
                >
                  {upload.isPending ? "Загрузка скриншота…" : submit.isPending ? "Отправка…" : "Сдать на проверку"}
                </button>
              )}
            </>
          )}

          {(submit.isError || upload.isError) && (
            <ErrorPanel
              message={
                upload.isError
                  ? upload.error instanceof Error
                    ? upload.error.message
                    : "Скриншот не загрузился"
                  : submit.error instanceof Error
                    ? submit.error.message
                    : "Ошибка сдачи"
              }
            />
          )}

          <AnimatePresence>
            {(done || submit.isSuccess) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-xl border border-[var(--success)]/25 bg-[var(--success)]/5 p-4 text-[13px] leading-relaxed"
              >
                Заявка ушла модератору. После одобрения —{" "}
                <span className="mono font-semibold text-[var(--success)]">
                  {Number(t.reward).toFixed(4)} TON
                </span>
                {t.xp_reward > 0 && ` и +${t.xp_reward} XP`}.
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
