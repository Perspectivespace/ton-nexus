import { t } from "@/i18n";
/** Типы, которые можно создать. Старые manual_proof и link перенесены миграцией 017 в visit/campaign. */
export type TaskType = "visit" | "campaign" | "partner";

type Roles = { is_owner?: boolean; is_admin?: boolean; is_ambassador?: boolean } | null | undefined;

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  get visit() { return t("tasks.typeVisit"); },
  get campaign() { return t("tasks.typeCampaign"); },
  get partner() { return t("tasks.typePartner"); },
};

/** Где можно потребовать скриншот-подтверждение */
export const PROOF_TASK_TYPES: TaskType[] = ["visit", "campaign"];

/** Какие типы видит пользователь: «Кампания» и «Партнёрская услуга» только владельцу */
export function allowedTaskTypes(me: Roles): TaskType[] {
  const out: TaskType[] = ["visit"];
  if (me?.is_owner) out.push("campaign", "partner");
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
