import { useEffect, useState } from "react";
import {
  useOwnerAddSlots,
  useOwnerCancel,
  useOwnerPrice,
  useOwnerTaskSummary,
  useTaskUpdate,
  type ManageOut,
  type OwnerAction,
  type OwnerTaskSummary,
} from "@/api/hooks";
import { Button, Field, Readout, Sheet, StatusPill, Tabs, useToast } from "@/components/ui";

const FINAL = ["cancelled", "closed"];

const ACTION_RU: Record<string, string> = {
  cancel: "Отмена",
  add_slots: "Добавлены выполнения",
  set_price: "Новая цена",
};

function ton(v: string | number) {
  return String(Number(v));
}

/** Строка журнала: «Отмена · −0.55 TON создателю» */
export function actionLine(a: OwnerAction): string {
  const parts = [ACTION_RU[a.action] ?? a.action];
  const c = Number(a.creator_delta);
  const p = Number(a.platform_delta);
  if (c > 0) parts.push(`списано с создателя ${ton(c)} TON`);
  if (c < 0) parts.push(`возвращено создателю ${ton(-c)} TON`);
  if (p > 0) parts.push(`платформа добавила ${ton(p)} TON`);
  if (p < 0) parts.push(`платформа оставила себе ${ton(-p)} TON`);
  return parts.join(" · ");
}

/** Текст подтверждения отмены */
export function cancelConfirmText(s: OwnerTaskSummary): string {
  if (s.task.task_type === "partner") return "Продажи закроются. Бюджета у услуги нет, возвращать нечего.";
  const refund = Number(s.refundable);
  const head = refund > 0 ? `Создателю вернётся ${ton(refund)} TON за свободные места.` : "Возвращать создателю нечего.";
  const pend = s.pending > 0 ? ` Заявок на проверке: ${s.pending}. Их можно будет одобрить или отклонить.` : "";
  return head + pend + " Отмену нельзя откатить.";
}

export function OwnerTaskPanelView({
  summary,
  busy,
  onCancel,
  onAddSlots,
  onPrice,
  onEdit,
}: {
  summary: OwnerTaskSummary;
  busy?: boolean;
  onCancel: () => void;
  onAddSlots: (count: number, mode: "charge" | "free") => void;
  onPrice: (reward: string, mode: "creator" | "absorb") => void;
  onEdit?: (patch: { title: string; description: string; target_url: string; xp_reward: number }) => void;
}) {
  const t = summary.task;
  const isPartner = t.task_type === "partner";
  const final = FINAL.includes(t.status);
  const [count, setCount] = useState("10");
  const [slotMode, setSlotMode] = useState<"charge" | "free">("charge");
  const [price, setPrice] = useState(ton(t.reward));
  const [priceMode, setPriceMode] = useState<"creator" | "absorb">("creator");
  const [confirm, setConfirm] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [description, setDescription] = useState(t.description);
  const [url, setUrl] = useState(t.target_url ?? "");
  const [xp, setXp] = useState(String(t.xp_reward));
  useEffect(() => setPrice(ton(t.reward)), [t.reward]);

  const countN = Number(count);
  const countOk = Number.isInteger(countN) && countN >= 1 && countN <= 10000;
  const priceOk = Number(price.replace(",", ".")) > 0;

  return (
    <div className="ui-cut space-y-4 p-5" data-testid="owner-panel">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Управление</p>
        <StatusPill tone={final ? "neutral" : "live"}>владелец</StatusPill>
      </div>

      {!isPartner && (
        <div className="grid grid-cols-2 gap-3">
          <Readout label="Оплатил создатель" value={ton(summary.charged)} unit="TON" />
          <Readout label="Выплачено" value={ton(summary.paid_out)} unit="TON" />
          <Readout label="На проверке" value={String(summary.pending)} hint="заявок" />
          <Readout label="Можно вернуть" value={ton(summary.refundable)} unit="TON" hint={`комиссия ${summary.commission_bp / 100}%`} />
        </div>
      )}

      {final ? (
        <p className="text-[13px] text-[var(--text-dim)]">
          Задание {t.status === "closed" ? "закрыто" : "отменено"}. Менять его больше нельзя.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            <p className="ui-label">{isPartner ? "Добавить продажи" : "Добавить выполнения"}</p>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                className="ui-input"
                inputMode="numeric"
                aria-label="Сколько добавить"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                disabled={busy}
              />
              <Button kind="secondary" disabled={busy || !countOk} onClick={() => onAddSlots(countN, slotMode)}>
                Добавить
              </Button>
            </div>
            {!isPartner && (
              <Tabs
                kind="line"
                label="Кто платит за новые выполнения"
                items={[
                  { value: "charge", label: "С баланса создателя" },
                  { value: "free", label: "За счёт платформы" },
                ]}
                value={slotMode}
                onChange={setSlotMode}
              />
            )}
          </div>

          <div className="space-y-2">
            <p className="ui-label">{isPartner ? "Цена для покупателя" : "Награда за выполнение"}</p>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                className="ui-input"
                inputMode="decimal"
                aria-label="Новая цена, TON"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={busy}
              />
              <Button
                kind="secondary"
                disabled={busy || !priceOk || Number(price) === Number(t.reward)}
                onClick={() => onPrice(price.replace(",", ".").trim(), priceMode)}
              >
                Сменить
              </Button>
            </div>
            {!isPartner && (
              <Tabs
                kind="line"
                label="Разница бюджета"
                items={[
                  { value: "creator", label: "Создатель доплачивает / получает возврат" },
                  { value: "absorb", label: "Разницу берёт платформа" },
                ]}
                value={priceMode}
                onChange={setPriceMode}
              />
            )}
            <p className="text-[12px] text-[var(--text-dim)]">Действует на выплаты после изменения, включая заявки на проверке.</p>
          </div>

          {isPartner && onEdit && (
            <form
              className="space-y-3"
              data-testid="partner-edit"
              onSubmit={(e) => {
                e.preventDefault();
                onEdit({ title: title.trim(), description: description.trim(), target_url: url.trim(), xp_reward: Number(xp) || 0 });
              }}
            >
              <p className="ui-label">Карточка услуги</p>
              <Field label="Название">
                <input className="ui-input sans" value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
              </Field>
              <Field label="Описание">
                <textarea className="ui-input" value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Ссылка">
                  <input className="ui-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" disabled={busy} />
                </Field>
                <Field label="XP" unit="XP">
                  <input className="ui-input" inputMode="numeric" value={xp} onChange={(e) => setXp(e.target.value)} disabled={busy} />
                </Field>
              </div>
              <Button kind="secondary" type="submit" block disabled={busy || title.trim().length < 3 || description.trim().length < 3}>
                Сохранить карточку
              </Button>
            </form>
          )}

          <Button kind="danger" block disabled={busy} onClick={() => setConfirm(true)}>
            {isPartner ? "Закрыть продажи" : "Отменить задание"}
          </Button>
        </>
      )}

      {summary.log.length > 0 && (
        <div className="space-y-1">
          <p className="ui-label">Журнал</p>
          <ul className="space-y-1 text-[12px] text-[var(--text-dim)]">
            {summary.log.map((a) => (
              <li key={a.id}>
                <span className="mono">{a.created_at ? new Date(a.created_at).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }) : ""}</span>{" "}
                {actionLine(a)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={isPartner ? "Закрыть продажи?" : "Отменить задание?"}
        footer={
          <div className="flex gap-2">
            <Button
              kind="danger"
              className="flex-1"
              disabled={busy}
              onClick={() => {
                setConfirm(false);
                onCancel();
              }}
            >
              {isPartner ? "Закрыть" : "Отменить задание"}
            </Button>
            <Button kind="secondary" onClick={() => setConfirm(false)}>
              Назад
            </Button>
          </div>
        }
      >
        <p className="text-[14px] leading-relaxed" data-testid="cancel-confirm">
          {cancelConfirmText(summary)}
        </p>
      </Sheet>
    </div>
  );
}

/** Панель «Управление» для владельца на экране задания */
export function OwnerTaskPanel({ taskId }: { taskId: number }) {
  const q = useOwnerTaskSummary(taskId, true);
  const cancel = useOwnerCancel(taskId);
  const add = useOwnerAddSlots(taskId);
  const price = useOwnerPrice(taskId);
  const edit = useTaskUpdate(taskId);
  const toast = useToast();
  const busy = cancel.isPending || add.isPending || price.isPending || edit.isPending;

  async function run(p: Promise<ManageOut>, title: string) {
    try {
      const r = await p;
      toast({ kind: "ok", title: r.already ? "Без изменений" : title, sub: r.note ?? undefined });
      q.refetch();
    } catch (e) {
      toast({ kind: "danger", title: "Не получилось", sub: e instanceof Error ? e.message : "Ошибка" });
    }
  }

  if (!q.data) return null;
  return (
    <OwnerTaskPanelView
      summary={q.data}
      busy={busy}
      onCancel={() => run(cancel.mutateAsync(null), "Задание отменено")}
      onAddSlots={(count, mode) => run(add.mutateAsync({ count, mode }), "Выполнения добавлены")}
      onPrice={(reward, mode) => run(price.mutateAsync({ reward, mode }), "Цена изменена")}
      onEdit={async (patch) => {
        try {
          await edit.mutateAsync({ ...patch, target_url: patch.target_url });
          toast({ kind: "ok", title: "Карточка сохранена" });
          q.refetch();
        } catch (e) {
          toast({ kind: "danger", title: "Не сохранилось", sub: e instanceof Error ? e.message : "Ошибка" });
        }
      }}
    />
  );
}
