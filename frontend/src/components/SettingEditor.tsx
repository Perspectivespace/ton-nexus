import { useMemo, useState } from "react";
import { Field as UiField } from "@/components/ui/Field";
import { cx } from "@/components/ui/press";
import {
  HIDDEN_KEYS,
  SETTINGS,
  fieldMeta,
  fromInput,
  toInput,
  type FieldMeta,
} from "@/lib/settingsMeta";

/**
 * Owner editor for an economy setting. The structure of the value is fixed:
 * only leaf values are editable, technical keys (id, code…) are kept as-is.
 * Unusual shapes (arrays of primitives, deep nesting) are shown read-only.
 */

type Obj = Record<string, unknown>;
type Path = (string | number)[];

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isLeaf = (v: unknown) => v === null || typeof v !== "object";
/** поле, которое редактируется одной строкой, хотя значение — массив (pct_list) */
const asLeaf = (m: FieldMeta, v: unknown) => isLeaf(v) || m.kind === "pct_list";
const pkey = (p: Path) => p.join(".");
const capsCls = "ui-label mb-2 block";

type Ctx = {
  settingKey: string;
  draft: Record<string, string>;
  errors: Record<string, string>;
  set: (k: string, v: string) => void;
};

function Field({
  ctx,
  path,
  m,
  extraHint,
}: {
  ctx: Ctx;
  path: Path;
  m: FieldMeta;
  extraHint?: string;
}) {
  const k = pkey(path);
  const err = ctx.errors[k];
  const hint = [m.hint, extraHint].filter(Boolean).join(" · ");
  const numeric = m.kind !== "text" && m.kind !== "pct_list";
  if (m.kind === "bool")
    return (
      <UiField label={m.label} error={err || undefined} hint={hint || undefined}>
        <select className="ui-input" disabled={m.readOnly} value={ctx.draft[k] ?? "0"} onChange={(e) => ctx.set(k, e.target.value)}>
          <option value="1">Вкл</option>
          <option value="0">Выкл</option>
        </select>
      </UiField>
    );
  return (
    <UiField label={m.label} unit={m.unit || undefined} error={err || undefined} hint={hint || undefined}>
      <input
        className="ui-input"
        inputMode={numeric ? (m.kind === "int" ? "numeric" : "decimal") : undefined}
        readOnly={m.readOnly}
        aria-readonly={m.readOnly || undefined}
        style={m.readOnly ? { opacity: 0.6, cursor: "default" } : undefined}
        value={ctx.draft[k] ?? ""}
        onChange={(e) => ctx.set(k, e.target.value)}
      />
    </UiField>
  );
}

function ReadOnlyValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="col-span-2">
      <span className={capsCls}>{label}</span>
      <p className="ui-num s-s block text-[var(--text-2)]">
        {Array.isArray(value) ? value.map((x) => (isLeaf(x) ? String(x) : "…")).join(", ") : "…"}
      </p>
      <span className="ui-sys mt-1 block">Только просмотр</span>
    </div>
  );
}

function Group({ ctx, value, path }: { ctx: Ctx; value: Obj; path: Path }) {
  const meta = SETTINGS[ctx.settingKey];
  const entries = Object.entries(value).filter(([k]) => !HIDDEN_KEYS.has(k));
  const total = meta?.chanceHints
    ? entries.reduce((s, [k]) => s + (Number(ctx.draft[pkey([...path, k])]) || 0), 0)
    : 0;
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-3">
      {entries.map(([k, v]) => {
        const m = fieldMeta(ctx.settingKey, k, v);
        const p = [...path, k];
        if (asLeaf(m, v)) {
          const single = entries.length === 1 || m.kind === "text" || m.kind === "pct_list" || m.label.length > 18;
          return (
            <div key={k} className={single ? "col-span-2" : ""}>
              <Field
                ctx={ctx}
                path={p}
                m={m}
                extraHint={
                  total > 0
                    ? `шанс ≈ ${(((Number(ctx.draft[pkey(p)]) || 0) / total) * 100).toFixed(1)}%`
                    : undefined
                }
              />
            </div>
          );
        }
        if (path.length < 1 && Array.isArray(v) && v.length && v.every((r) => isObj(r) && Object.values(r).every(isLeaf))) {
          return (
            <div key={k} className="col-span-2">
              <span className={capsCls}>{m.label}</span>
              <Rows ctx={ctx} rows={v as Obj[]} path={p} titleKey={meta?.rowTitle} />
            </div>
          );
        }
        if (isObj(v) && path.length < 2) {
          return (
            <fieldset key={k} className="se-sub col-span-2">
              <legend className={capsCls}>{m.label}</legend>
              <Group ctx={ctx} value={v} path={p} />
            </fieldset>
          );
        }
        return <ReadOnlyValue key={k} label={m.label} value={v} />;
      })}
    </div>
  );
}

function Rows({
  ctx,
  rows,
  path,
  titleKey,
}: {
  ctx: Ctx;
  rows: Obj[];
  path: Path;
  titleKey?: string;
}) {
  const meta = SETTINGS[ctx.settingKey];
  const weightKeys = rows.map((_, i) => pkey([...path, i, "weight"]));
  const total = weightKeys.reduce((s, k) => s + (Number(ctx.draft[k]) || 0), 0);
  return (
    <div>
      {rows.map((row, i) => {
        const title = String(row[titleKey ?? "label"] ?? row.label ?? `#${i + 1}`);
        const fields = Object.entries(row).filter(
          ([k]) => !HIDDEN_KEYS.has(k) && k !== titleKey,
        );
        return (
          <div key={i} className="se-sub">
            <p className={cx(capsCls, "truncate")}>{title}</p>
            <div className="grid grid-cols-2 gap-2">
              {fields.map(([k, v]) => {
                const base = fieldMeta(ctx.settingKey, k, v);
                const m = meta?.lockField?.(row, k) ? { ...base, readOnly: true } : base;
                let extra: string | undefined;
                if (k === "weight" && total > 0) {
                  const w = Number(ctx.draft[pkey([...path, i, k])]) || 0;
                  extra = `шанс ≈ ${((w / total) * 100).toFixed(1)}%`;
                }
                return <Field key={k} ctx={ctx} path={[...path, i, k]} m={m} extraHint={extra} />;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Collect editable leaves → { path: [meta, originalValue] }. */
function collect(settingKey: string, v: unknown, path: Path, out: Map<string, [Path, FieldMeta, unknown]>) {
  const meta = SETTINGS[settingKey];
  const walk = (x: unknown, p: Path, depth: number, row?: Obj) => {
    if (isObj(x)) {
      for (const [k, y] of Object.entries(x)) {
        if (HIDDEN_KEYS.has(k)) continue;
        const m = fieldMeta(settingKey, k, y);
        if (asLeaf(m, y)) {
          const locked = m.readOnly || (row && meta?.lockField?.(row, k)) || (row && k === meta?.rowTitle);
          out.set(pkey([...p, k]), [[...p, k], locked ? { ...m, readOnly: true } : m, y]);
        } else if (depth < 1) walk(y, [...p, k], depth + 1);
      }
    } else if (Array.isArray(x) && x.every((r) => isObj(r) && Object.values(r).every(isLeaf))) {
      x.forEach((r, i) => walk(r, [...p, i], depth + 1, r as Obj));
    }
  };
  walk(v, path, 0);
}

function setIn(root: unknown, path: Path, val: unknown): unknown {
  if (!path.length) return val;
  const [h, ...rest] = path;
  const copy: any = Array.isArray(root) ? root.slice() : { ...(root as Obj) };
  copy[h as any] = setIn(copy[h as any], rest, val);
  return copy;
}

export function SettingEditor({
  settingKey,
  value,
  formId,
  onSave,
}: {
  settingKey: string;
  value: unknown;
  /** id формы: кнопка «Сохранить» живёт в закреплённом низу шторки (type="submit" form={formId}) */
  formId: string;
  onSave: (v: unknown) => Promise<void>;
}) {
  const leaves = useMemo(() => {
    const out = new Map<string, [Path, FieldMeta, unknown]>();
    if (isLeaf(value)) out.set("", [[], fieldMeta(settingKey, "value", value), value]);
    else collect(settingKey, value, [], out);
    return out;
  }, [settingKey, value]);

  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries([...leaves].map(([k, [, m, v]]) => [k, toInput(m, v)])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const ctx: Ctx = {
    settingKey,
    draft,
    errors,
    set: (k, v) => {
      setDraft((d) => ({ ...d, [k]: v }));
      if (errors[k]) setErrors((e) => ({ ...e, [k]: "" }));
    },
  };

  async function save() {
    setErr(null);
    const errs: Record<string, string> = {};
    let next: unknown = value;
    for (const [k, [path, m, orig]] of leaves) {
      if (m.readOnly) continue;
      try {
        next = setIn(next, path, fromInput(m, draft[k] ?? "", orig));
      } catch (e) {
        errs[k] = e instanceof Error ? e.message : "Ошибка";
      }
    }
    // Weighted pickers need at least one positive weight.
    if (!Object.keys(errs).length && isObj(next)) {
      const weightSets: number[][] = [];
      if (settingKey === "upgrade_type_weights") weightSets.push(Object.values(next).map(Number));
      if (Array.isArray(next.items)) weightSets.push((next.items as Obj[]).map((r) => Number(r.weight ?? 0)));
      if (weightSets.some((ws) => ws.reduce((a, b) => a + b, 0) <= 0)) {
        setErr("Хотя бы один вес должен быть больше 0");
        return;
      }
    }
    // призы «Башни»: бюджет до 0.0001 TON; включить можно только с бюджетом
    if (!Object.keys(errs).length && settingKey === "tower_prizes" && isObj(next)) {
      if ((String(next.budget_ton ?? "").split(".")[1] ?? "").length > 4)
        errs[pkey(["budget_ton"])] = "не больше 4 знаков после точки";
      else if (next.enabled === true && !(Number(next.budget_ton) > 0))
        errs[pkey(["budget_ton"])] = "чтобы включить призы, задайте бюджет больше 0";
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      setErr("Проверьте выделенные поля");
      return;
    }
    try {
      await onSave(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <form
      id={formId}
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {isLeaf(value) ? (
        <Field ctx={ctx} path={[]} m={leaves.get("")![1]} />
      ) : isObj(value) ? (
        <Group ctx={ctx} value={value} path={[]} />
      ) : (
        <ReadOnlyValue label="Значение" value={value} />
      )}
      {err && (
        <p className="ui-fhint err" role="alert">
          {err}
        </p>
      )}
    </form>
  );
}
