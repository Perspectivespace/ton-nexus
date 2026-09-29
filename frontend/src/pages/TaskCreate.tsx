import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useMe, useCreateTask } from "@/api/hooks";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  Readout,
} from "@/components/ui";

export function TaskCreate() {
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
  const [result, setResult] = useState<string | null>(null);

  const canCreate = me?.is_owner || me?.is_admin || me?.is_ambassador;
  const canDirectPublish = me?.is_owner || me?.is_admin;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
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
            ? "на проверке у admin/owner"
            : t.status === "draft"
              ? "черновик"
              : t.status;
      setResult(`#${t.id} · ${statusHint}`);
      setTimeout(() => nav(t.status === "active" ? `/tasks/${t.id}` : "/inbox"), 1200);
    } catch {
      /* */
    }
  }

  if (isLoading) return <LoadingPanel label="Проверка роли…" />;

  if (!canCreate) {
    return (
      <div className="space-y-4">
        <ScreenHeader eyebrow="Маркет" title="Новое задание" />
        <ErrorPanel message="Создание доступно амбассадору, admin и owner." />
        <Link to="/tasks" className="btn-ghost inline-flex text-[13px] no-underline">
          ← Лента
        </Link>
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
            {canDirectPublish ? "direct" : "на approve"}
          </StatusPill>
        }
      />

      <div className="panel panel-glow p-4">
        <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
          {canDirectPublish
            ? "Admin/owner: можно сразу опубликовать — бюджет (награда × слоты + ~10%) спишется с баланса."
            : "Амбассадор: задание уйдёт на approve. После одобрения — публикация и hold бюджета."}
        </p>
      </div>

      {me && (
        <div className="panel grid grid-cols-2 gap-3 p-4">
          <Readout label="Ваш баланс" value={Number(me.balance).toFixed(4)} unit="TON" />
          <Readout label="Ориентир бюджета" value={budgetHint} unit="TON" hint="×1.1 комиссия" />
        </div>
      )}

      <form onSubmit={onSubmit} className="panel space-y-4 p-5">
        <label className="block text-[11px] font-medium text-[var(--text-dim)]">
          Заголовок
          <input
            className="input-field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Подпишись на канал / репост"
            minLength={3}
            required
            disabled={create.isPending}
          />
        </label>

        <label className="block text-[11px] font-medium text-[var(--text-dim)]">
          Описание / бриф
          <textarea
            className="input-field min-h-[100px] resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Что сделать и как подтвердить…"
            minLength={3}
            required
            disabled={create.isPending}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[11px] font-medium text-[var(--text-dim)]">
            Тип
            <select
              className="input-field"
              value={taskType}
              onChange={(e) => setTaskType(e.target.value as "manual_proof" | "link")}
              disabled={create.isPending}
            >
              <option value="manual_proof">Proof вручную</option>
              <option value="link">Ссылка</option>
            </select>
          </label>
          <label className="block text-[11px] font-medium text-[var(--text-dim)]">
            Мин. уровень
            <input
              className="input-field mono"
              value={minLevel}
              onChange={(e) => setMinLevel(e.target.value)}
              disabled={create.isPending}
            />
          </label>
        </div>

        {taskType === "link" && (
          <label className="block text-[11px] font-medium text-[var(--text-dim)]">
            Target URL
            <input
              className="input-field mono text-[13px]"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://t.me/…"
              disabled={create.isPending}
            />
          </label>
        )}

        <div className="grid grid-cols-3 gap-2">
          <label className="block text-[11px] font-medium text-[var(--text-dim)]">
            Награда TON
            <input
              className="input-field mono"
              value={reward}
              onChange={(e) => setReward(e.target.value)}
              required
              disabled={create.isPending}
            />
          </label>
          <label className="block text-[11px] font-medium text-[var(--text-dim)]">
            Слоты
            <input
              className="input-field mono"
              value={slots}
              onChange={(e) => setSlots(e.target.value)}
              required
              disabled={create.isPending}
            />
          </label>
          <label className="block text-[11px] font-medium text-[var(--text-dim)]">
            XP
            <input
              className="input-field mono"
              value={xp}
              onChange={(e) => setXp(e.target.value)}
              disabled={create.isPending}
            />
          </label>
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
          className="btn-primary w-full"
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
                : "Отправить на approve"}
        </button>

        {create.isError && (
          <ErrorPanel
            message={create.error instanceof Error ? create.error.message : "Ошибка создания"}
          />
        )}

        {result && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-[var(--success)]/25 bg-[var(--success)]/5 p-3 text-[13px]"
          >
            Задание {result}
          </motion.div>
        )}
      </form>

      <Link to="/tasks" className="btn-ghost inline-flex text-[13px] no-underline">
        ← Лента
      </Link>
    </div>
  );
}
