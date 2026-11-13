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
import { ProofImage } from "@/components/tasks/ProofUpload";
import { RejectReasonSheet } from "@/components/tasks/RejectReasonSheet";
import { t } from "@/i18n";

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
  const [reasonOpen, setReasonOpen] = useState(false);
  const toast = useToast();

  async function act(approve: boolean, rejectReason?: string, rejectNote?: string | null) {
    setBusy(approve ? "approve" : "reject");
    try {
      await review.mutateAsync({
        id: item.id,
        approve,
        note: approve ? note.trim() || null : rejectNote ?? null,
        rejectReason: approve ? null : rejectReason,
      });
      setReasonOpen(false);
      toast({ kind: approve ? "ok" : "info", title: approve ? t("inbox.approved") : t("inbox.rejected"), sub: `#${item.id}` });
      onDone();
    } catch (e) {
      toast({ kind: "danger", title: t("inbox.notSaved"), sub: e instanceof Error ? e.message : t("ui.error") });
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
            {t("inbox.submissionNo")}{item.id}{" "}{t("inbox.taskNo")}{item.task_id}
          </p>
          <p className="mt-0.5 text-[12px] text-[var(--text-dim)]">{t("inbox.userNo")}{item.user_id}</p>
        </div>
        <StatusPill tone="live">{t("wallet.inReview")}</StatusPill>
      </div>

      {item.proof_text && (
        <div>
          <p className="ui-label mb-1">{t("inbox.proof")}</p>
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
          {t("inbox.openLink")}</a>
      )}

      {item.proof_image_id != null && <ProofImage proofId={item.proof_image_id} state={item.proof_image_state} />}

      {!item.proof_text && !item.proof_url && item.proof_image_id == null && (
        <p className="text-[12px] text-[var(--text-dim)]">{t("inbox.noProof")}</p>
      )}

      <Field label={t("inbox.modNote")}>
        <input
          className="ui-input sans"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("inbox.optional")}
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
          {busy === "approve" ? "…" : t("inbox.approve")}
        </button>
        <button
          type="button"
          className="ui-btn danger flex-1"
          disabled={!!busy}
          onClick={() => setReasonOpen(true)}
        >
          {busy === "reject" ? "…" : t("inbox.reject")}
        </button>
      </div>

      <RejectReasonSheet
        open={reasonOpen}
        kind="submission"
        initialNote={note.trim()}
        busy={busy === "reject"}
        onClose={() => setReasonOpen(false)}
        onConfirm={(reason, n) => act(false, reason, n)}
      />

      {review.isError && (
        <p className="text-[12px] text-[var(--danger)]">
          {review.error instanceof Error ? review.error.message : t("ui.error")}
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
  const [rejectingTask, setRejectingTask] = useState<number | null>(null);
  const toast = useToast();

  const canModerate = me?.is_owner || me?.is_admin || me?.is_ambassador;

  if (meLoading || subs.isLoading) {
    return <LoadingPanel label={t("inbox.opening")} />;
  }

  if (!canModerate) {
    return (
      <div className="space-y-4">
        <ScreenHeader eyebrow={t("inbox.manage")} title={t("inbox.moderation")} />
        <ErrorPanel message={t("inbox.noAccess")} />
        <BackLink />
      </div>
    );
  }

  if (subs.isError) {
    return <ErrorPanel message={t("inbox.queueFailed")} />;
  }

  const list = subs.data || [];
  const pendingTasks = approvals.data || [];
  const showTaskQueue = me?.is_admin || me?.is_owner;

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow={t("inbox.manage")}
        title={t("inbox.moderation")}
        action={
          <StatusPill tone={list.length ? "live" : "ok"}>{list.length}{" "}{t("inbox.submissionsShort")}</StatusPill>
        }
      />

      <div className="ui-cut hero p-4">
        <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
          {t("inbox.rules")}</p>
      </div>

      {showTaskQueue && (
        <section className="space-y-3">
          <SectionLabel
            action={
              <StatusPill tone={pendingTasks.length ? "warn" : "neutral"}>
                {pendingTasks.length}{" "}{t("inbox.toApprove")}</StatusPill>
            }
          >
            {t("inbox.publications")}</SectionLabel>

          {approvals.isError && (
            <p className="ui-onbg text-[12px]">{t("inbox.pubUnavailable")}</p>
          )}

          {!approvals.isError && pendingTasks.length === 0 && (
            <p className="ui-onbg text-[12px]">{t("inbox.noPub")}</p>
          )}

          {pendingTasks.map((task) => (
            <div key={task.id} className="ui-cut space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[14px] font-medium">{task.title}</p>
                  <p className="mt-1 line-clamp-2 text-[12px] text-[var(--text-dim)]">
                    {task.description}
                  </p>
                  <p className="mono mt-2 text-[11px] text-[var(--accent)]">
                    {Number(task.reward).toFixed(4)}{" "}{t("inbox.tonSlots")}{" "}{task.total_slots}
                  </p>
                </div>
                <StatusPill tone="warn">{t("wallet.pendingShort")}</StatusPill>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="ui-btn primary flex-1"
                  disabled={approveTask.isPending}
                  onClick={() =>
                    approveTask.mutate(task.id, {
                      onSuccess: () => toast({ kind: "ok", title: t("inbox.published"), sub: `#${task.id}` }),
                      onError: (e) => toast({ kind: "danger", title: t("inbox.approveFailed"), sub: e.message }),
                    })
                  }
                >
                  {t("inbox.approve")}</button>
                <button
                  type="button"
                  className="ui-btn danger flex-1"
                  disabled={rejectTask.isPending}
                  onClick={() => setRejectingTask(task.id)}
                >
                  {t("inbox.reject")}</button>
              </div>
            </div>
          ))}
          <RejectReasonSheet
            open={rejectingTask != null}
            kind="task"
            busy={rejectTask.isPending}
            onClose={() => setRejectingTask(null)}
            onConfirm={(reason, note) => {
              const id = rejectingTask;
              if (id == null) return;
              rejectTask.mutate(
                { taskId: id, reason, note },
                {
                  onSuccess: () => {
                    setRejectingTask(null);
                    toast({ kind: "info", title: t("inbox.taskRejected"), sub: `#${id}` });
                  },
                  onError: (e) => toast({ kind: "danger", title: t("inbox.rejectFailed"), sub: e.message }),
                },
              );
            }}
          />
        </section>
      )}

      <section className="space-y-3">
        <SectionLabel
          action={
            <StatusPill tone={subs.isFetching ? "live" : "neutral"}>
              {subs.isFetching ? t("home.syncing") : `${list.length}`}
            </StatusPill>
          }
        >
          {t("inbox.toReview")}</SectionLabel>

        {list.length === 0 && (
          <EmptyPanel
            title={t("inbox.empty")}
            body={t("inbox.emptySub")}
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
