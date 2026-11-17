import { useEffect, useState } from "react";
import { Field, Sheet } from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { t } from "@/i18n";

export type SubmissionRejectReason = "low_quality" | "wrong_task" | "duplicate" | "forged" | "other";
export type TaskRejectReason = "bad_task" | "other";

const SUBMISSION: SubmissionRejectReason[] = ["low_quality", "wrong_task", "duplicate", "forged", "other"];
const TASK: TaskRejectReason[] = ["bad_task", "other"];

const LABEL = {
  low_quality: () => [t("inbox.reason.low_quality"), t("inbox.reasonHint.low_quality")],
  wrong_task: () => [t("inbox.reason.wrong_task"), t("inbox.reasonHint.wrong_task")],
  duplicate: () => [t("inbox.reason.duplicate"), t("inbox.reasonHint.duplicate")],
  forged: () => [t("inbox.reason.forged"), t("inbox.reasonHint.forged")],
  bad_task: () => [t("inbox.reason.bad_task"), t("inbox.reasonHint.bad_task")],
  other: () => [t("inbox.reason.other"), t("inbox.reasonHint.other")],
} as const;

/**
 * Шторка причины отказа (сдача или задание). Код причины уходит в «Честность» (теневой режим) —
 * исполнитель его не видит. «Другое» — только с заметкой.
 */
export function RejectReasonSheet({
  open,
  kind,
  initialNote = "",
  busy = false,
  onClose,
  onConfirm,
}: {
  open: boolean;
  kind: "submission" | "task";
  initialNote?: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (reason: string, note: string | null) => void;
}) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState(initialNote);
  useEffect(() => {
    if (open) {
      setReason(null);
      setNote(initialNote);
    }
  }, [open, initialNote]);

  const options: (keyof typeof LABEL)[] = kind === "task" ? TASK : SUBMISSION;
  const needNote = reason === "other" && !note.trim();
  const ready = !!reason && !needNote && !busy;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("inbox.reasonTitle")}
      sub={t("inbox.reasonSub")}
      footer={
        <button
          type="button"
          className="ui-btn danger w-full"
          disabled={!ready}
          onClick={() => reason && onConfirm(reason, note.trim() || null)}
        >
          {busy ? "…" : t("inbox.reject")}
        </button>
      }
    >
      <div className="rr-list" role="radiogroup" aria-label={t("inbox.reasonTitle")}>
        {options.map((r) => {
          const [title, hint] = LABEL[r]();
          return (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={reason === r}
            className={`rr-opt${reason === r ? " on" : ""}`}
            disabled={busy}
            onClick={() => {
              haptic.select();
              setReason(r);
            }}
          >
            <i className="d" aria-hidden />
            <span className="m">
              <span className="t">{title}</span>
              <span className="s">{hint}</span>
            </span>
          </button>
          );
        })}
      </div>
      <Field label={t("inbox.reasonNote")} className="rr-note" error={needNote ? t("inbox.noteRequired") : undefined}>
        <textarea
          className="ui-input sans"
          rows={2}
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder={reason === "other" ? t("inbox.reasonHint.other") : t("inbox.optional")}
          disabled={busy}
          aria-invalid={needNote || undefined}
        />
      </Field>
    </Sheet>
  );
}
