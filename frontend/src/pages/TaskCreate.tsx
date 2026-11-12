import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMe, useCreateTask, useTaskQuote } from "@/api/hooks";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  Field,
  useToast,
} from "@/components/ui";
import { useScreenBack } from "@/lib/backButton";
import { BackLink } from "@/components/BackLink";
import { VisitPriceBlock } from "@/components/tasks/VisitPriceBlock";
import { PartnerPriceBlock } from "@/components/tasks/PartnerPriceBlock";
import {
  TaskTypeSelect,
  allowedTaskTypes,
  PROOF_TASK_TYPES,
  type TaskType,
} from "@/components/tasks/TaskTypeSelect";
import { t } from "@/i18n";

/** «12.5» (%) → 1250 bp; пусто → null (тариф); мусор → NaN */
function pctToBp(v: string): number | null {
  const s = v.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100) return NaN;
  return Math.round(n * 100);
}

export function TaskCreate() {
  useScreenBack("/tasks");
  const { data: me, isLoading } = useMe();
  const create = useCreateTask();
  const nav = useNavigate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reward, setReward] = useState("0.05");
  const [slots, setSlots] = useState("10");
  const [minLevel, setMinLevel] = useState("1");
  const [targetUrl, setTargetUrl] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("visit");
  const [publish, setPublish] = useState(false);
  const [campaignBp, setCampaignBp] = useState("");
  const [campaignXp, setCampaignXp] = useState("");
  const [partnerTg, setPartnerTg] = useState("");
  const [proofRequired, setProofRequired] = useState(false);
  const toast = useToast();

  const canDirectPublish = !!(me?.is_owner || me?.is_admin);
  const isVisit = taskType === "visit";
  const isCampaign = taskType === "campaign";
  const isPartner = taskType === "partner";
  const isManual = isCampaign || isPartner; // цену вписывает владелец
  const isPriced = isVisit || isManual;
  const proofAllowed = PROOF_TASK_TYPES.includes(taskType);
  const partnerTgN = /^\d{1,15}$/.test(partnerTg.trim()) ? Number(partnerTg.trim()) : null;
  // visit — любой вошедший; campaign и partner — только владелец

  const slotsN = Math.max(1, Number(slots) || 1);
  const bpOverride = pctToBp(campaignBp);
  const bpInvalid = bpOverride !== null && Number.isNaN(bpOverride);
  const rewardClean = reward.trim().replace(",", ".");
  const quoteQ = useTaskQuote(
    isVisit
      ? { task_type: "visit", total_slots: slotsN }
      : isManual && !bpInvalid
        ? { task_type: isPartner ? "partner" : "campaign", total_slots: slotsN, reward: rewardClean, commission_bp: bpOverride }
        : null,
  );
  const quote = quoteQ.data ?? null;

  useEffect(() => {
    if (me && !allowedTaskTypes(me).includes(taskType)) setTaskType("visit");
  }, [me, taskType]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const task = await create.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        ...(isManual
          ? {
              reward: rewardClean,
              commission_bp: bpOverride,
              xp_reward: campaignXp.trim() ? Number(campaignXp) || 0 : null,
              ...(isPartner ? { partner_telegram_id: partnerTgN } : {}),
            }
          : {}),
        proof_required: proofAllowed && proofRequired,
        total_slots: Number(slots) || 1,
        task_type: taskType,
        target_url: targetUrl.trim() || null,
        min_level: Number(minLevel) || 1,
        publish: canDirectPublish ? publish : false,
      });
      const statusHint =
        task.status === "active"
          ? t("taskNew.published")
          : task.status === "pending_approval"
            ? t("taskNew.inReview")
            : task.status === "draft"
              ? t("taskStatus.draft")
              : task.status;
      toast({ kind: "ok", title: t("taskNew.created"), sub: `#${task.id} · ${statusHint}` });
      setTimeout(() => nav(task.status === "active" ? `/tasks/${task.id}` : "/inbox"), 1200);
    } catch (e) {
      toast({ kind: "danger", title: t("taskNew.notCreated"), sub: e instanceof Error ? e.message : t("ui.error") });
    }
  }

  if (isLoading) return <LoadingPanel label={t("taskNew.checkingRole")} />;

  if (!me) {
    return (
      <div className="space-y-4">
        <ScreenHeader eyebrow={t("nav.earn")} title={t("taskNew.title")} />
        <ErrorPanel message={t("taskNew.signIn")} />
        <BackLink to="/tasks" label={t("task.feed")} />
      </div>
    );
  }

  if (!allowedTaskTypes(me).includes(taskType)) {
    return (
      <div className="space-y-4">
        <ScreenHeader eyebrow={t("nav.earn")} title={t("taskNew.title")} />
        <ErrorPanel message={t("taskNew.ownerOnly")} />
        <BackLink to="/tasks" label={t("task.feed")} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow={t("nav.earn")}
        title={t("taskNew.title")}
        action={
          <StatusPill tone={!canDirectPublish ? "warn" : "live"}>
            {canDirectPublish ? t("taskNew.direct") : t("taskNew.toApprove")}
          </StatusPill>
        }
      />

      <div className="ui-cut hero p-4">
        <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
          {isVisit
            ? t("taskNew.hintVisit")
            : isCampaign
              ? t("taskNew.hintCampaign")
              : t("taskNew.hintPartner")}
        </p>
      </div>

      {isPartner ? (
        <PartnerPriceBlock quote={quote} loading={quoteQ.isFetching} />
      ) : (
        <VisitPriceBlock quote={quote} loading={quoteQ.isFetching} />
      )}

      <form onSubmit={onSubmit} className="ui-cut space-y-4 p-5">
        <Field label={t("taskNew.fTitle")}>
          <input
            className="ui-input sans"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={isVisit ? t("taskNew.phTitleVisit") : t("taskNew.phTitleCampaign")}
            minLength={3}
            required
            disabled={create.isPending}
          />
        </Field>

        <Field label={t("taskNew.fDesc")}>
          <textarea
            className="ui-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              isVisit
                ? t("taskNew.phDescVisit")
                : isCampaign
                  ? t("taskNew.phDescCampaign")
                  : t("taskNew.phDesc")
            }
            minLength={3}
            required
            disabled={create.isPending}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("taskNew.fType")}>
            <TaskTypeSelect me={me} value={taskType} onChange={setTaskType} disabled={create.isPending} />
          </Field>
          <Field label={t("taskNew.fMinLevel")}>
            <input
              className="ui-input"
              value={minLevel}
              onChange={(e) => setMinLevel(e.target.value)}
              disabled={create.isPending}
            />
          </Field>
        </div>

        {isPriced && (
          <Field label={isVisit ? t("taskNew.fLink") : t("taskNew.fLinkOpt")}>
            <input
              className="ui-input"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder={t("taskNew.phLink")}
              required={isVisit}
              disabled={create.isPending}
            />
          </Field>
        )}

        {isPartner && (
          <Field label={t("taskNew.fPartner")}>
            <input
              className="ui-input"
              inputMode="numeric"
              value={partnerTg}
              onChange={(e) => setPartnerTg(e.target.value)}
              placeholder={t("taskNew.partnerHint")}
              required
              disabled={create.isPending}
            />
          </Field>
        )}

        {isManual ? (
          <div className="space-y-3" data-testid="campaign-fields">
            <div className="grid grid-cols-2 gap-3">
              <Field label={isPartner ? t("taskNew.fPrice") : t("taskNew.fReward")}>
                <input
                  className="ui-input"
                  inputMode="decimal"
                  value={reward}
                  onChange={(e) => setReward(e.target.value)}
                  required
                  disabled={create.isPending}
                />
              </Field>
              <Field label={isPartner ? t("taskNew.fSales") : t("taskNew.fSlots")}>
                <input
                  className="ui-input"
                  inputMode="numeric"
                  value={slots}
                  onChange={(e) => setSlots(e.target.value)}
                  required
                  disabled={create.isPending}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("taskNew.fFee")}>
                <input
                  className="ui-input"
                  inputMode="decimal"
                  value={campaignBp}
                  onChange={(e) => setCampaignBp(e.target.value)}
                  placeholder={quote ? t("taskNew.tariff", { commissionBp: quote.commission_bp / 100 }) : t("taskNew.fromTariff")}
                  disabled={create.isPending}
                />
              </Field>
              <Field label="XP" unit="XP">
                <input
                  className="ui-input"
                  inputMode="numeric"
                  value={campaignXp}
                  onChange={(e) => setCampaignXp(e.target.value)}
                  placeholder={quote ? t("taskNew.tariffXp", { xp: quote.xp }) : t("taskNew.fromTariff")}
                  disabled={create.isPending}
                />
              </Field>
            </div>
            {bpInvalid && <p className="text-[12px] text-[var(--danger-text)]">{t("taskNew.feeRange")}</p>}
            {quoteQ.isError && (
              <p className="text-[12px] text-[var(--danger-text)]">
                {quoteQ.error instanceof Error ? quoteQ.error.message : t("taskNew.checkReward")}
              </p>
            )}
          </div>
        ) : (
          <Field label={t("taskNew.fSlots")}>
            <input
              className="ui-input"
              value={slots}
              onChange={(e) => setSlots(e.target.value)}
              required
              disabled={create.isPending}
            />
          </Field>
        )}

        {proofAllowed && (
          <label className="flex items-start gap-2 text-[13px] leading-snug text-[var(--text-dim)]" data-testid="proof-required">
            <input
              type="checkbox"
              checked={proofRequired}
              onChange={(e) => setProofRequired(e.target.checked)}
              disabled={create.isPending}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
            />
            <span>
              <span className="text-[var(--text)]">{t("taskNew.proofShot")}</span>
              <br />
              {t("taskNew.proofShotHint")}</span>
          </label>
        )}

        {canDirectPublish && (
          <label className="flex items-center gap-2 text-[13px] text-[var(--text-dim)]">
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
              disabled={create.isPending}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            {isPartner ? t("taskNew.publishFree") : t("taskNew.publishCharge")}
          </label>
        )}

        <button
          type="submit"
          className="ui-btn primary block"
          disabled={
            create.isPending ||
            title.trim().length < 3 ||
            description.trim().length < 3 ||
            (isVisit && !targetUrl.trim()) ||
            (isPriced && quoteQ.isError) ||
            (isManual && (bpInvalid || !(Number(rewardClean) > 0))) ||
            (isPartner && partnerTgN == null)
          }
        >
          {create.isPending
            ? t("taskNew.creating")
            : canDirectPublish && publish
              ? t("taskNew.createPublish")
              : canDirectPublish
                ? t("taskNew.createDraft")
                : t("taskNew.sendApproval")}
        </button>
      </form>

      <BackLink to="/tasks" label={t("task.feed")} />
    </div>
  );
}
