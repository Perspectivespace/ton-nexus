export type TaskType = "visit" | "campaign" | "partner" | "manual_proof" | "link";

type Roles = { is_owner?: boolean; is_admin?: boolean; is_ambassador?: boolean } | null | undefined;

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  visit: "Переход на сторонний ресурс",
  campaign: "Кампания",
  partner: "Партнёрская услуга",
  manual_proof: "Подтверждение вручную",
  link: "Ссылка",
};

/** Какие типы видит пользователь: «Кампания» и «Партнёрская услуга» только владельцу, legacy — амбассадору+ */
export function allowedTaskTypes(me: Roles): TaskType[] {
  const out: TaskType[] = ["visit"];
  if (me?.is_owner) out.push("campaign", "partner");
  if (me?.is_owner || me?.is_admin || me?.is_ambassador) out.push("manual_proof", "link");
  return out;
}

export function TaskTypeSelect({
  me,
  value,
  onChange,
  disabled,
}: {
  me: Roles;
  value: TaskType;
  onChange: (t: TaskType) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className="ui-input"
      value={value}
      onChange={(e) => onChange(e.target.value as TaskType)}
      disabled={disabled}
    >
      {allowedTaskTypes(me).map((t) => (
        <option key={t} value={t}>
          {TASK_TYPE_LABEL[t]}
        </option>
      ))}
    </select>
  );
}
