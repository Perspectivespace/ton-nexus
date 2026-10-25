import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMe, useCreateTask } from "@/api/hooks";
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
  const [taskType, setTaskType] = useState<"manual_proof" | "link">("manual_proof");
  const [publish, setPublish] = useState(false);
  const toast = useToast();

  const canCreate = me?.is_owner || me?.is_admin || me?.is_ambassador;
  const canDirectPublish = me?.is_owner || me?.is_admin;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const t = await create.mutateAsync({
        title: title.trim(),
        description: description.trim(),
        reward,
        total_slots: Number(slots) || 1,
        task_type: taskType,
        target_url: targetUrl.trim() || null,
        min_level: Number(minLevel) || 1,
        xp_reward: Number(xp) || 0,
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

  if (!canCreate) {
    return (
      <div className="space-y-4">
        <ScreenHeader eyebrow="Маркет" title="Новое задание" />
        <ErrorPanel message="Создание доступно амбассадору, админу и владельцу." />
        <BackLink to="/tasks" label="Лента" />
      </div>
    );
  }

  const slotsN = Math.max(1, Number(slots) || 1);
  const rewardN = Number(reward) || 0;
  const budgetHint = (rewardN * slotsN * 1.1).toFixed(4);

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Маркет"
        title="Новое задание"
        action={
          <StatusPill tone={me?.is_ambassador && !canDirectPublish ? "warn" : "live"}>
            {canDirectPublish ? "сразу в ленту" : "на одобрение"}
          </StatusPill>
        }
      />

      <div className="ui-cut hero p-4">
        <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
          {canDirectPublish
            ? "Админ или владелец: можно сразу опубликовать — бюджет (награда × слоты + ~10%) спишется с баланса."
            : "Амбассадор: задание уйдёт на одобрение. После одобрения — публикация, бюджет уйдёт в холд."}
        </p>
      </div>

      {me && (
        <div className="ui-cut grid grid-cols-2 gap-3 p-4">
          <Readout label="Ваш баланс" value={Number(me.balance).toFixed(4)} unit="TON" />
          <Readout label="Ориентир бюджета" value={budgetHint} unit="TON" hint="×1.1 комиссия" />
        </div>
      )}

      <form onSubmit={onSubmit} className="ui-cut space-y-4 p-5">
        <Field label="Заголовок">
          <input
            className="ui-input sans"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Подпишись на канал / репост"
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
            placeholder="Что сделать и как подтвердить…"
            minLength={3}
            required
            disabled={create.isPending}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Тип">
            <select
              className="ui-input"
              value={taskType}
              onChange={(e) => setTaskType(e.target.value as "manual_proof" | "link")}
              disabled={create.isPending}
            >
              <option value="manual_proof">Подтверждение вручную</option>
              <option value="link">Ссылка</option>
            </select>
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

        {taskType === "link" && (
          <Field label="Ссылка на цель">
            <input
              className="ui-input"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://t.me/…"
              disabled={create.isPending}
            />
          </Field>
        )}

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
          <Field label="Слоты">
            <input
              className="ui-input"
              value={slots}
              onChange={(e) => setSlots(e.target.value)}
              required
              disabled={create.isPending}
            />
          </Field>
          <Field label="XP" unit="XP">
            <input
              className="ui-input"
              value={xp}
              onChange={(e) => setXp(e.target.value)}
              disabled={create.isPending}
            />
          </Field>
        </div>

        {canDirectPublish && (
          <label className="flex items-center gap-2 text-[13px] text-[var(--text-dim)]">
            <input
              type="checkbox"
              checked={publish}
              onChange={(e) => setPublish(e.target.checked)}
              disabled={create.isPending}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Сразу опубликовать (списать бюджет)
          </label>
        )}

        <button
          type="submit"
          className="ui-btn primary block"
          disabled={
            create.isPending || title.trim().length < 3 || description.trim().length < 3
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
