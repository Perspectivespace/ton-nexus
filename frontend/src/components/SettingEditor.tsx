import { useMemo, useState } from "react";
import { Field as UiField } from "@/components/ui/Field";
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
const pkey = (p: Path) => p.join(".");
const capsCls = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--text-dim)]";

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
  const numeric = m.kind !== "text";
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
      <p className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] p-3 font-mono text-[12px] text-[var(--text-dim)]">
        {Array.isArray(value) ? value.map((x) => (isLeaf(x) ? String(x) : "…")).join(", ") : "…"}
        <span className="mt-1 block text-[11px]">Только просмотр</span>
      </p>
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
        if (isLeaf(v)) {
          const single = entries.length === 1 || m.kind === "text" || m.label.length > 18;
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
            <fieldset key={k} className="col-span-2 rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 pb-3 pt-1">
              <legend className="px-1 font-mono text-[11px] uppercase tracking-wide text-[var(--accent)]">
                {m.label}
              </legend>
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
    <div className="space-y-2.5">
      {rows.map((row, i) => {
        const title = String(row[titleKey ?? "label"] ?? row.label ?? `#${i + 1}`);
        const fields = Object.entries(row).filter(
          ([k]) => !HIDDEN_KEYS.has(k) && k !== titleKey,
        );
        return (
          <div key={i} className="rounded-xl border border-[var(--line)] bg-[var(--surface-3)] p-3">
            <p className="mb-2 truncate font-mono text-[12px] text-[var(--accent)]">{title}</p>
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
        if (isLeaf(y)) {
          const m = fieldMeta(settingKey, k, y);
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
  saving,
  onSave,
  onCancel,
}: {
  settingKey: string;
  value: unknown;
  saving: boolean;
  onSave: (v: unknown) => Promise<void>;
  onCancel: () => void;
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
    <div className="space-y-4">
      {isLeaf(value) ? (
        <Field ctx={ctx} path={[]} m={leaves.get("")![1]} />
      ) : isObj(value) ? (
        <Group ctx={ctx} value={value} path={[]} />
      ) : (
        <ReadOnlyValue label="Значение" value={value} />
      )}
      {err && <p className="text-[12px] text-[var(--danger)]">{err}</p>}
      <div className="flex gap-2 pt-1">
        <button type="button" className="btn-primary flex-1" onClick={save} disabled={saving}>
          {saving ? "Сохранение…" : "Применить"}
        </button>
        <button type="button" className="btn-ghost px-4" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}
