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
import { t } from "@/i18n";

const TASK_STATUS_RU: Record<string, string> = {
  get active() { return t("taskStatus.active"); },
  get draft() { return t("taskStatus.draft"); },
  get pending_approval() { return t("taskStatus.pending"); },
  get paused() { return t("taskStatus.paused"); },
  get rejected() { return t("taskStatus.rejected"); },
  get completed() { return t("taskStatus.finished"); },
  get closed() { return t("taskStatus.closed"); },
  get cancelled() { return t("taskStatus.cancelled"); },
};

export function TaskDetail() {
  useScreenBack("/tasks");
  const { id } = useParams();
  const taskId = Number(id) || 0;
  const { data: me } = useMe();
  const { data: task, isLoading, error } = useTask(taskId);
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
      toast({ kind: "ok", title: t("task.submitted"), sub: t("task.submittedSub") });
    } catch (e) {
      toast({ kind: "danger", title: t("task.submitFailed"), sub: e instanceof Error ? e.message : t("ui.error") });
    }
  }

  async function onBuy() {
    if (buy.isPending) return;
    try {
      const r = await buy.mutateAsync();
      toast({
        kind: "ok",
        title: r.already ? t("task.alreadyBought") : t("task.bought"),
        sub: r.already ? t("task.notCharged") : `−${Number(r.amount)} TON${r.xp ? ` · +${r.xp} XP` : ""}`,
      });
    } catch (e) {
      toast({ kind: "danger", title: t("task.buyFailed"), sub: e instanceof Error ? e.message : t("ui.error") });
    }
  }

  if (isLoading) return <LoadingPanel label={t("task.loading")} />;
  if (error || !task) return <ErrorPanel message={t("task.notFound")} />;

  const slotsLeft = task.total_slots - task.filled_slots;
  const levelOk = (me?.level ?? 1) >= task.min_level;
  const isOwn = me?.id === task.creator_id;
  const isPartnerTask = task.task_type === "partner";
  const canSubmit =
    task.status === "active" && slotsLeft > 0 && levelOk && !isOwn && !done && !submit.isSuccess;
  const proofRequired = !!task.proof_required;
  const proofAllowed = proofRequired || task.task_type === "visit" || task.task_type === "campaign";
  const proofErr = proofFileError(proofFile);
  const sending = submit.isPending || upload.isPending;
  const submitBlocked =
    sending ||
    !!proofErr ||
    (proofRequired ? !proofFile : !proofText.trim() && !proofUrl.trim() && !proofFile);

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow={t("task.title")}
        title={task.title}
        action={<BackLink to="/tasks" label={t("task.feed")} />}
      />

      <div className="ui-cut hero space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={task.status === "active" ? "live" : "neutral"}>{TASK_STATUS_RU[task.status] ?? task.status}</StatusPill>
          <StatusPill tone={slotsLeft > 0 ? "ok" : "warn"}>
            {isPartnerTask ? t("task.sold") : t("task.taken")} {task.filled_slots}{" "}{t("task.of")}{" "}{task.total_slots}
          </StatusPill>
          {!levelOk && <StatusPill tone="danger">{t("task.needLvl")}{" "}{task.min_level}</StatusPill>}
          {proofRequired && <StatusPill tone="neutral">{t("task.needScreenshot")}</StatusPill>}
          {isOwn && <StatusPill tone="neutral">{t("task.yours")}</StatusPill>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Readout
            label={isPartnerTask ? t("task.price") : t("task.reward")}
            value={isPartnerTask ? String(Number(task.reward)) : Number(task.reward).toFixed(4)}
            unit="TON"
            hint={isPartnerTask && task.partner_name ? t("task.partner", { partnerName: task.partner_name }) : undefined}
          />
          <Readout label={t("task.xp")} value={`+${task.xp_reward}`} unit="XP" />
        </div>

        <div>
          <p className="eyebrow mb-2">{t("task.brief")}</p>
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{task.description}</p>
        </div>

        {task.target_url && (
          <a
            href={task.target_url}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-btn secondary sm"
          >
            {t("task.openLink")}</a>
        )}
      </div>

      {isPartnerTask && (
        <PartnerBuyPanel
          state={{
            status: task.status,
            price: task.reward,
            slotsLeft,
            minLevel: task.min_level,
            myLevel: me?.level ?? 1,
            myBalance: me?.balance ?? null,
            isPartner: me?.id != null && me.id === task.partner_user_id,
            purchased: !!task.purchased || !!buy.data,
            pending: buy.isPending,
            error: buy.isError ? (buy.error instanceof Error ? buy.error.message : t("task.buyError")) : null,
          }}
          onBuy={onBuy}
        />
      )}

      {me?.is_owner && <OwnerTaskPanel taskId={task.id} />}

      {!isPartnerTask && (
        <div className="ui-cut space-y-4 p-5">
          <div className="flex items-center justify-between">
            <p className="eyebrow">{t("task.submission")}</p>
            <StatusPill
              tone={done || submit.isSuccess ? "ok" : canSubmit ? "live" : "neutral"}
            >
              {done || submit.isSuccess
                ? t("wallet.inReview")
                : canSubmit
                  ? t("task.ready")
                  : t("taskStatus.closed")}
            </StatusPill>
          </div>

          {!canSubmit && !done && !submit.isSuccess && (
            <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
              {isOwn
                ? t("task.ownTask")
                : !levelOk
                  ? t("task.levelRequired", { minLevel: task.min_level })
                  : slotsLeft <= 0
                    ? t("task.noSlots")
                    : task.status !== "active"
                      ? t("task.inactive")
                      : t("task.cantSubmit")}
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
              <Field label={proofRequired ? t("task.commentOptional") : t("task.proofText")}>
                <textarea
                  className="ui-input"
                  value={proofText}
                  disabled={done || submit.isSuccess || sending}
                  onChange={(e) => setProofText(e.target.value)}
                  placeholder={proofRequired ? t("task.commentPh") : t("task.proofPh")}
                />
              </Field>
              {!proofRequired && (
                <Field label={t("task.proofLink")}>
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
                  {upload.isPending ? t("proof.loading") : submit.isPending ? t("task.sending") : t("task.submit")}
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
                    : t("task.screenshotFailed")
                  : submit.error instanceof Error
                    ? submit.error.message
                    : t("task.submitError")
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
                {t("task.sentToMod")}{" "}
                <span className="mono font-semibold text-[var(--success)]">
                  {Number(task.reward).toFixed(4)} TON
                </span>
                {task.xp_reward > 0 && t("task.plusXp", { xpReward: task.xp_reward })}.
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
