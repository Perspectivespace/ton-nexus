import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMe, useCreateTask, useTaskQuote } from "@/api/hooks";
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
import { VisitPriceBlock } from "@/components/tasks/VisitPriceBlock";
import { PartnerPriceBlock } from "@/components/tasks/PartnerPriceBlock";
import { TaskTypeSelect, allowedTaskTypes, type TaskType } from "@/components/tasks/TaskTypeSelect";

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
  const [xp, setXp] = useState("10");
  const [minLevel, setMinLevel] = useState("1");
  const [targetUrl, setTargetUrl] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("visit");
  const [publish, setPublish] = useState(false);
  const [campaignBp, setCampaignBp] = useState("");
  const [campaignXp, setCampaignXp] = useState("");
  const [partnerTg, setPartnerTg] = useState("");
  const toast = useToast();

  const canDirectPublish = !!(me?.is_owner || me?.is_admin);
  const isVisit = taskType === "visit";
  const isCampaign = taskType === "campaign";
  const isPartner = taskType === "partner";
  const isManual = isCampaign || isPartner; // цену вписывает владелец
  const isPriced = isVisit || isManual;
  const partnerTgN = /^\d{1,15}$/.test(partnerTg.trim()) ? Number(partnerTg.trim()) : null;
  // visit — любой вошедший; campaign и partner — только владелец; legacy — амбассадор+

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
      const t = await create.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        ...(isVisit
          ? {}
          : isManual
            ? {
                reward: rewardClean,
                commission_bp: bpOverride,
                xp_reward: campaignXp.trim() ? Number(campaignXp) || 0 : null,
                ...(isPartner ? { partner_telegram_id: partnerTgN } : {}),
              }
            : { reward, xp_reward: Number(xp) || 0 }),
        total_slots: Number(slots) || 1,
        task_type: taskType,
        target_url: targetUrl.trim() || null,
        min_level: Number(minLevel) || 1,
        publish: canDirectPublish ? publish : false,
      });
      const statusHint =
        t.status === "active"
          ? "опубликовано"
          : t.status === "pending_approval"
            ? "на проверке у админа или владельца"
            : t.status === "draft"
              ? "черновик"
              : t.status;
      toast({ kind: "ok", title: "Задание создано", sub: `#${t.id} · ${statusHint}` });
      setTimeout(() => nav(t.status === "active" ? `/tasks/${t.id}` : "/inbox"), 1200);
    } catch (e) {
      toast({ kind: "danger", title: "Задание не создано", sub: e instanceof Error ? e.message : "Ошибка" });
    }
  }

  if (isLoading) return <LoadingPanel label="Проверка роли…" />;

  if (!me) {
    return (
      <div className="space-y-4">
        <ScreenHeader eyebrow="Заработок" title="Новое задание" />
        <ErrorPanel message="Войдите через Telegram, чтобы создать задание." />
        <BackLink to="/tasks" label="Лента" />
      </div>
    );
  }

  if (!allowedTaskTypes(me).includes(taskType)) {
    return (
      <div className="space-y-4">
        <ScreenHeader eyebrow="Заработок" title="Новое задание" />
        <ErrorPanel message="Этот тип доступен амбассадору, админу и владельцу. Выберите «Переход на сторонний ресурс»." />
        <BackLink to="/tasks" label="Лента" />
      </div>
    );
  }

  const rewardN = Number(reward) || 0;
  const budgetHint = (rewardN * slotsN * 1.1).toFixed(4);

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Заработок"
        title="Новое задание"
        action={
          <StatusPill tone={!canDirectPublish ? "warn" : "live"}>
            {canDirectPublish ? "сразу в ленту" : "на одобрение"}
          </StatusPill>
        }
      />

      <div className="ui-cut hero p-4">
        <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
          {isVisit
            ? "Переход: цена и комиссия из тарифа владельца. Ссылка обязательна; награду исполнителю задаёт тариф."
            : isCampaign
              ? "Кампания: награду и условия вписываете вручную. Комиссия и XP по умолчанию из тарифа, можно поменять."
              : isPartner
                ? "Партнёрская услуга: покупатель платит цену со своего баланса, партнёр получает её за вычетом комиссии платформы."
              : canDirectPublish
              ? "Админ или владелец: можно сразу опубликовать — бюджет (награда × места + комиссия) спишется с баланса."
              : "Амбассадор: задание уйдёт на одобрение. После одобрения — публикация, бюджет уйдёт в холд."}
        </p>
      </div>

      {isPartner ? (
        <PartnerPriceBlock quote={quote} loading={quoteQ.isFetching} />
      ) : isPriced ? (
        <VisitPriceBlock quote={quote} loading={quoteQ.isFetching} />
      ) : (
        me && (
          <div className="ui-cut grid grid-cols-2 gap-3 p-4">
            <Readout label="Ваш баланс" value={Number(me.balance).toFixed(4)} unit="TON" />
            <Readout label="Ориентир бюджета" value={budgetHint} unit="TON" hint="×1.1 комиссия" />
          </div>
        )
      )}

      <form onSubmit={onSubmit} className="ui-cut space-y-4 p-5">
        <Field label="Заголовок">
          <input
            className="ui-input sans"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={isVisit ? "Перейди по ссылке / подпишись" : "Подпишись на канал / репост"}
            minLength={3}
            required
            disabled={create.isPending}
          />
        </Field>

        <Field label="Описание / бриф">
          <textarea
            className="ui-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              isVisit
                ? "Что открыть и как подтвердить (скрин)…"
                : isCampaign
                  ? "Условия кампании по договорённости…"
                  : "Что сделать и как подтвердить…"
            }
            minLength={3}
            required
            disabled={create.isPending}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Тип">
            <TaskTypeSelect me={me} value={taskType} onChange={setTaskType} disabled={create.isPending} />
          </Field>
          <Field label="Мин. уровень">
            <input
              className="ui-input"
              value={minLevel}
              onChange={(e) => setMinLevel(e.target.value)}
              disabled={create.isPending}
            />
          </Field>
        </div>

        {(isVisit || isManual || taskType === "link") && (
          <Field label={isVisit ? "Ссылка на ресурс" : isManual ? "Ссылка (необязательно)" : "Ссылка на цель"}>
            <input
              className="ui-input"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://… или t.me/…"
              required={isVisit}
              disabled={create.isPending}
            />
          </Field>
        )}

        {isPartner && (
          <Field label="Партнёр: Telegram ID">
            <input
              className="ui-input"
              inputMode="numeric"
              value={partnerTg}
              onChange={(e) => setPartnerTg(e.target.value)}
              placeholder="кто получает деньги"
              required
              disabled={create.isPending}
            />
          </Field>
        )}

        {isManual ? (
          <div className="space-y-3" data-testid="campaign-fields">
            <div className="grid grid-cols-2 gap-3">
              <Field label={isPartner ? "Цена, TON" : "Награда, TON"}>
                <input
                  className="ui-input"
                  inputMode="decimal"
                  value={reward}
                  onChange={(e) => setReward(e.target.value)}
                  required
                  disabled={create.isPending}
                />
              </Field>
              <Field label={isPartner ? "Число продаж" : "Число выполнений"}>
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
              <Field label="Комиссия, %">
                <input
                  className="ui-input"
                  inputMode="decimal"
                  value={campaignBp}
                  onChange={(e) => setCampaignBp(e.target.value)}
                  placeholder={quote ? `тариф ${quote.commission_bp / 100}` : "из тарифа"}
                  disabled={create.isPending}
                />
              </Field>
              <Field label="XP" unit="XP">
                <input
                  className="ui-input"
                  inputMode="numeric"
                  value={campaignXp}
                  onChange={(e) => setCampaignXp(e.target.value)}
                  placeholder={quote ? `тариф ${quote.xp}` : "из тарифа"}
                  disabled={create.isPending}
                />
              </Field>
            </div>
            {bpInvalid && <p className="text-[12px] text-[var(--danger-text)]">Комиссия: от 0 до 100%</p>}
            {quoteQ.isError && (
              <p className="text-[12px] text-[var(--danger-text)]">
                {quoteQ.error instanceof Error ? quoteQ.error.message : "Проверьте награду и число выполнений"}
              </p>
            )}
          </div>
        ) : isVisit ? (
          <Field label="Число выполнений">
            <input
              className="ui-input"
              value={slots}
              onChange={(e) => setSlots(e.target.value)}
              required
              disabled={create.isPending}
            />
          </Field>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Field label="Награда, TON">
              <input
                className="ui-input"
                value={reward}
                onChange={(e) => setReward(e.target.value)}
                required
                disabled={create.isPending}
              />
            </Field>
            <Field label="Мест (исполнителей)">
              <input
                className="ui-input"
                value={slots}
                onChange={(e) => setSlots(e.target.value)}
                required
                disabled={create.isPending}
              />
            </Field>
            <Field label="XP" unit="XP">
              <input className="ui-input" value={xp} onChange={(e) => setXp(e.target.value)} disabled={create.isPending} />
            </Field>
          </div>
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
            {isPartner ? "Сразу опубликовать (ничего не списывается)" : "Сразу опубликовать (списать бюджет)"}
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
            ? "Создание…"
            : canDirectPublish && publish
              ? "Создать и опубликовать"
              : canDirectPublish
                ? "Создать черновик"
                : "Отправить на одобрение"}
        </button>
      </form>

      <BackLink to="/tasks" label="Лента" />
    </div>
  );
}
