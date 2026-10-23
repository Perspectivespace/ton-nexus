import { useMemo, useState } from "react";

/**
 * Typed editor for economy settings values (JSON).
 * - primitives → one input (numbers stay numbers, numeric strings like TON stay strings)
 * - nested objects → grouped fields
 * - arrays of flat objects → rows with per-field inputs, add/remove row/field
 * - anything else → JSON textarea with validation
 */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Draft = null | boolean | string | Draft[] | { [k: string]: Draft };
type Path = (string | number)[];
type Obj = Record<string, Json>;

const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isPrim = (v: unknown) => v === null || typeof v !== "object";
const NUMERIC = /^-?\d+(?:[.,]\d+)?$/;

function isRowArray(v: unknown): v is Obj[] {
  return Array.isArray(v) && v.every((r) => isObj(r) && Object.values(r).every(isPrim));
}

/** Can this value be edited with the structured form? */
function formable(v: unknown, depth = 0): boolean {
  if (isPrim(v)) return true;
  if (depth > 2) return false;
  if (Array.isArray(v)) return v.length > 0 && isRowArray(v);
  return Object.values(v as Obj).every((x) => formable(x, depth + 1));
}

function toDraft(v: Json): Draft {
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(toDraft);
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toDraft(x)]));
  return v;
}

/** Merge rows to know each column's type (first occurrence wins). */
function rowTemplate(rows: Obj[]): Obj {
  const t: Obj = {};
  for (const r of rows) for (const [k, v] of Object.entries(r)) if (!(k in t)) t[k] = v;
  return t;
}

function fromDraft(d: Draft, tmpl: Json | undefined, path: string): Json {
  if (typeof tmpl === "number") {
    const s = String(d ?? "").trim().replace(",", ".");
    const n = Number(s);
    if (s === "" || !Number.isFinite(n)) throw new Error(`«${path}»: нужно число`);
    return n;
  }
  if (Array.isArray(d)) {
    const rt = Array.isArray(tmpl) && isRowArray(tmpl) ? rowTemplate(tmpl) : undefined;
    return d.map((x, i) => fromDraft(x, rt, `${path} #${i + 1}`));
  }
  if (d !== null && typeof d === "object") {
    const t = isObj(tmpl) ? tmpl : {};
    return Object.fromEntries(
      Object.entries(d).map(([k, x]) => [k, fromDraft(x, t[k], path ? `${path} → ${k}` : k)]),
    );
  }
  if (typeof tmpl === "string" && typeof d === "string") return d.trim();
  return d;
}

function setAt(d: Draft, path: Path, val: Draft | undefined): Draft {
  if (path.length === 0) return val as Draft;
  const [h, ...rest] = path;
  if (Array.isArray(d)) {
    const next = d.slice();
    if (val === undefined && rest.length === 0) next.splice(h as number, 1);
    else next[h as number] = setAt(next[h as number], rest, val);
    return next;
  }
  const next = { ...(d as Record<string, Draft>) };
  if (val === undefined && rest.length === 0) delete next[h as string];
  else next[h as string] = setAt(next[h as string], rest, val);
  return next;
}

const human = (k: string) => k.replace(/_/g, " ");
const capsCls =
  "mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--text-dim)]";
const chipCls =
  "rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-2.5 py-1 font-mono text-[11px] transition hover:border-[var(--accent)]";

function Leaf({
  label,
  value,
  tmpl,
  onChange,
  onRemove,
}: {
  label: string;
  value: Draft;
  tmpl: Json | undefined;
  onChange: (v: Draft) => void;
  onRemove?: () => void;
}) {
  const head = (
    <span className={`${capsCls} flex items-center justify-between gap-2`}>
      <span className="truncate">{human(label)}</span>
      {onRemove && (
        <button
          type="button"
          aria-label="Убрать поле"
          onClick={onRemove}
          className="text-[13px] leading-none text-[var(--text-dim)] hover:text-[var(--danger)]"
        >
          ×
        </button>
      )}
    </span>
  );
  if (typeof tmpl === "boolean" || typeof value === "boolean") {
    return (
      <label className="block">
        {head}
        <input
          type="checkbox"
          className="mt-2 h-4 w-4 accent-[var(--accent)]"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
      </label>
    );
  }
  const s = value == null ? "" : String(value);
  const numeric = typeof tmpl === "number" || (typeof tmpl === "string" && NUMERIC.test(tmpl));
  return (
    <label className="block min-w-0">
      {head}
      <input
        className="input-field mono w-full text-[14px]"
        inputMode={numeric ? "decimal" : undefined}
        value={s}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Rows({
  rows,
  tmpl,
  onSet,
}: {
  rows: Draft[];
  tmpl: Obj[];
  onSet: (path: Path, v: Draft | undefined) => void;
}) {
  const t = useMemo(() => rowTemplate(tmpl), [tmpl]);
  const common = useMemo(
    () => Object.keys(t).filter((k) => tmpl.every((r) => k in r)),
    [t, tmpl],
  );
  const blank = (k: string): Draft => (typeof t[k] === "number" ? "0" : typeof t[k] === "boolean" ? false : "");

  return (
    <div className="space-y-2.5">
      {rows.map((row, i) => {
        const r = row as Record<string, Draft>;
        const missing = Object.keys(t).filter((k) => !(k in r));
        const title = String(r.label ?? r.id ?? r.name ?? "");
        return (
          <div key={i} className="rounded-xl border border-[var(--line)] bg-black/15 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[12px] text-[var(--accent)]">
                #{i + 1}
                {title && <span className="text-[var(--text-dim)]"> · {title}</span>}
              </span>
              <button
                type="button"
                className={`${chipCls} text-[var(--danger)]`}
                onClick={() => onSet([i], undefined)}
              >
                Удалить
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Object.keys(r).map((k) => (
                <Leaf
                  key={k}
                  label={k}
                  value={r[k]}
                  tmpl={t[k]}
                  onChange={(v) => onSet([i, k], v)}
                  onRemove={common.includes(k) ? undefined : () => onSet([i, k], undefined)}
                />
              ))}
            </div>
            {missing.length > 0 && (
              <select
                className="input-field mono mt-2 w-full py-2 text-[12px]"
                value=""
                onChange={(e) => e.target.value && onSet([i, e.target.value], blank(e.target.value))}
              >
                <option value="">+ поле…</option>
                {missing.map((k) => (
                  <option key={k} value={k}>
                    {human(k)}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className={`${chipCls} w-full py-2 text-[var(--accent)]`}
        onClick={() =>
          onSet([rows.length], Object.fromEntries(common.map((k) => [k, blank(k)])))
        }
      >
        + Добавить строку
      </button>
    </div>
  );
}

function Node({
  label,
  value,
  tmpl,
  path,
  onSet,
}: {
  label: string;
  value: Draft;
  tmpl: Json | undefined;
  path: Path;
  onSet: (path: Path, v: Draft | undefined) => void;
}) {
  if (Array.isArray(value)) {
    return (
      <div className="col-span-2">
        {label && <span className={capsCls}>{human(label)}</span>}
        <Rows rows={value} tmpl={isRowArray(tmpl) ? tmpl : []} onSet={(p, v) => onSet([...path, ...p], v)} />
      </div>
    );
  }
  if (value !== null && typeof value === "object") {
    const t = isObj(tmpl) ? tmpl : {};
    const inner = (
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(value).map(([k, v]) => (
          <Node key={k} label={k} value={v} tmpl={t[k]} path={[...path, k]} onSet={onSet} />
        ))}
      </div>
    );
    if (!label) return inner;
    return (
      <fieldset className="col-span-2 rounded-xl border border-[var(--line)] bg-black/10 p-3">
        <legend className="px-1 font-mono text-[11px] uppercase tracking-wide text-[var(--accent)]">
          {human(label)}
        </legend>
        {inner}
      </fieldset>
    );
  }
  return (
    <Leaf
      label={label || "значение"}
      value={value}
      tmpl={tmpl}
      onChange={(v) => onSet(path, v)}
    />
  );
}

export function SettingEditor({
  value,
  saving,
  onSave,
  onCancel,
}: {
  value: unknown;
  saving: boolean;
  onSave: (v: unknown) => Promise<void>;
  onCancel: () => void;
}) {
  const original = value as Json;
  const canForm = useMemo(() => formable(original), [original]);
  const [mode, setMode] = useState<"form" | "json">(canForm ? "form" : "json");
  const [draft, setDraft] = useState<Draft>(() => toDraft(original));
  const [text, setText] = useState(() => JSON.stringify(original, null, 2));
  const [err, setErr] = useState<string | null>(null);

  const onSet = (path: Path, v: Draft | undefined) => setDraft((d) => setAt(d, path, v));

  function parseJson(): Json {
    let v: Json;
    try {
      v = JSON.parse(text) as Json;
    } catch {
      throw new Error("Неверный JSON");
    }
    const kind = (x: unknown) => (Array.isArray(x) ? "array" : x === null ? "null" : typeof x);
    if (original !== null && kind(v) !== kind(original))
      throw new Error(`Тип должен остаться: ${kind(original)}`);
    return v;
  }

  const current = (): Json => (mode === "form" ? fromDraft(draft, original, "") : parseJson());

  function switchMode() {
    setErr(null);
    try {
      if (mode === "form") {
        setText(JSON.stringify(current(), null, 2));
        setMode("json");
      } else {
        const v = parseJson();
        if (!formable(v)) throw new Error("Эту структуру можно править только как JSON");
        setDraft(toDraft(v));
        setMode("form");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function save() {
    setErr(null);
    try {
      await onSave(current());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <div className="space-y-3">
      {!isPrim(original) && (
        <div className="flex justify-end">
          <button type="button" className={`${chipCls} text-[var(--text-dim)]`} onClick={switchMode}>
            {mode === "form" ? "{ } JSON" : "Форма"}
          </button>
        </div>
      )}
      {mode === "form" ? (
        <Node label="" value={draft} tmpl={original} path={[]} onSet={onSet} />
      ) : (
        <textarea
          className="input-field mono min-h-[220px] w-full resize-y text-[12px] leading-relaxed tracking-normal"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
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
