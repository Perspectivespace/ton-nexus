import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useMe,
  useEconomySettings,
  useEconomyUpdate,
  usePromoCreate,
  useOwnerStats,
  usePromoList,
  type EconomySetting,
} from "@/api/hooks";
import { api } from "@/api/client";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  EmptyPanel,
} from "@/components/ui";

const GROUP_RU: Record<string, string> = {
  miner: "Майнер",
  miner_upgrade: "Усиление",
  tasks: "Задания",
  withdraw: "Вывод",
  growth: "Рост",
  daily: "Daily",
  progression: "Уровни",
  roulette: "Рулетка",
  custom: "Прочее",
};

function formatValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v !== "object") return String(v);
  if (Array.isArray(v)) return v.join(", ");
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 0) return "—";
  // single key → just the value
  if (entries.length === 1) {
    const val = entries[0][1];
    if (typeof val === "object" && val !== null) return formatValue(val);
    return String(val);
  }
  // multiple → show values only, nested objects summarized
  return entries
    .map(([, val]) => {
      if (typeof val === "object" && val !== null) {
        const inner = Object.entries(val as Record<string, unknown>)
          .map(([, iv]) => String(iv))
          .join("/");
        return inner || "—";
      }
      return String(val);
    })
    .join(" · ");
}

function SettingRow({
  item,
  onSaved,
}: {
  item: EconomySetting;
  onSaved: () => void;
}) {
  const update = useEconomyUpdate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const isComplex = typeof item.value === "object" && item.value !== null && !Array.isArray(item.value);

  function startEdit() {
    if (isComplex) {
      const obj = item.value as Record<string, unknown>;
      const d: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) d[k] = String(v ?? "");
      setDraft(d);
    } else {
      setDraft({ value: String(item.value ?? "") });
    }
    setEditing(true);
    setErr(null);
  }

  async function save() {
    setErr(null);
    let value: unknown;
    if (isComplex) {
      value = {};
      for (const [k, v] of Object.entries(draft)) {
        const num = Number(v);
        (value as Record<string, unknown>)[k] = v.trim() !== "" && !Number.isNaN(num) ? num : v;
      }
    } else {
      const v = draft.value ?? "";
      const num = Number(v);
      value = v.trim() !== "" && !Number.isNaN(num) ? num : v;
    }
    try {
      await update.mutateAsync({ key: item.key, value });
      onSaved();
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <div className="panel overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium leading-snug">{item.label || item.key}</p>
            {item.description && (
              <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-dim)]">{item.description}</p>
            )}
          </div>
          {!editing && (
            <button
              type="button"
              onClick={startEdit}
              className="shrink-0 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-1.5 font-mono text-[12px] text-[var(--accent)] transition hover:border-[var(--accent)]"
            >
              Изменить
            </button>
          )}
        </div>
        {!editing && (
          <p className="mt-3 font-mono text-[15px] leading-relaxed text-[var(--text)]">
            {formatValue(item.value)}
          </p>
        )}
      </div>
      {editing && (
        <div className="space-y-3 border-t border-[var(--line)] bg-[var(--bg-elev)]/40 p-4">
          {isComplex ? (
            <div className="space-y-2.5">
              {Object.keys(draft).map((k) => (
                <label key={k} className="block">
                  <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[var(--text-dim)]">
                    {k.replace(/_/g, " ")}
                  </span>
                  <input
                    className="input-field mono w-full text-[14px]"
                    value={draft[k]}
                    onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
          ) : (
            <input
              className="input-field mono w-full text-[14px]"
              value={draft.value ?? ""}
              onChange={(e) => setDraft({ value: e.target.value })}
              autoFocus
            />
          )}
          {err && <p className="text-[12px] text-[var(--danger)]">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="btn-primary flex-1"
              onClick={save}
              disabled={update.isPending}
            >
              {update.isPending ? "Сохранение…" : "Применить"}
            </button>
            <button
              type="button"
              className="btn-ghost px-4"
              onClick={() => setEditing(false)}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PromoCreatePanel() {
  const create = usePromoCreate();
  const [code, setCode] = useState("");
  const [ton, setTon] = useState("0.1");
  const [xp, setXp] = useState("0");
  const [focus, setFocus] = useState("0");
  const [maxUses, setMaxUses] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setMsg(null);
    try {
      const r = await create.mutateAsync({
        code: code.trim().toUpperCase(),
        reward_ton: ton || 0,
        reward_xp: Number(xp) || 0,
        reward_focus: Number(focus) || 0,
        max_uses: maxUses ? Number(maxUses) : null,
      });
      setMsg(`Создан: ${r.code}`);
      setCode("");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Новый промокод</p>
        <StatusPill tone="neutral">create</StatusPill>
      </div>
      <label className="block text-[11px] font-medium text-[var(--text-dim)]">
        Код
        <input
          className="input-field mono uppercase"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="WELCOME"
        />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className="block text-[11px] text-[var(--text-dim)]">
          TON
          <input className="input-field mono" value={ton} onChange={(e) => setTon(e.target.value)} />
        </label>
        <label className="block text-[11px] text-[var(--text-dim)]">
          XP
          <input className="input-field mono" value={xp} onChange={(e) => setXp(e.target.value)} />
        </label>
        <label className="block text-[11px] text-[var(--text-dim)]">
          Фокус
          <input
            className="input-field mono"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
          />
        </label>
      </div>
      <label className="block text-[11px] text-[var(--text-dim)]">
        Max uses (пусто = ∞)
        <input
          className="input-field mono"
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
          placeholder="100"
        />
      </label>
      <button
        type="button"
        className="btn-primary w-full"
        disabled={create.isPending || code.length < 3}
        onClick={submit}
      >
        {create.isPending ? "…" : "Создать промокод"}
      </button>
      {msg && <p className="text-[12px] text-[var(--text-dim)]">{msg}</p>}
    </div>
  );
}

function OverviewTab() {
  const { data, isLoading, error } = useOwnerStats();
  if (isLoading) return <LoadingPanel label="Загрузка статистики…" />;
  if (error) return <ErrorPanel message="Не удалось загрузить статистику" />;
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="panel p-4">
        <p className="eyebrow">Пользователи</p>
        <p className="mt-1 font-mono text-2xl font-medium">{data?.total_users ?? 0}</p>
      </div>
      <div className="panel p-4">
        <p className="eyebrow">Сегодня</p>
        <p className="mt-1 font-mono text-2xl font-medium">{data?.registrations_today ?? 0}</p>
      </div>
    </div>
  );
}

function PromosTab() {
  const { data, isLoading, error, refetch } = usePromoList();
  if (isLoading) return <LoadingPanel label="Загрузка промокодов…" />;
  if (error) return <ErrorPanel message="Не удалось загрузить промокоды" />;
  return (
    <div className="space-y-4">
      <PromoCreatePanel />
      {!data?.length ? (
        <EmptyPanel title="Нет промокодов" body="Создайте первый код выше." />
      ) : (
        <ul className="space-y-2">
          {data.map((p) => (
            <li key={p.id} className="panel flex items-center justify-between p-3">
              <div>
                <p className="font-mono text-[13px] font-medium">{p.code}</p>
                <p className="text-[11px] text-[var(--text-dim)]">
                  {p.reward_ton} TON · {p.reward_xp} XP · {p.used_count}
                  {p.max_uses != null ? ` / ${p.max_uses}` : ""}
                </p>
              </div>
              <StatusPill tone={p.is_active ? "ok" : "neutral"}>
                {p.is_active ? "active" : "off"}
              </StatusPill>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn-ghost text-[12px]" onClick={() => refetch()}>
        Обновить список
      </button>
    </div>
  );
}

function DeployButton() {
  const [status, setStatus] = useState<"idle" | "running" | "ok" | "err">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    if (!confirm("Обновить Mini App с GitHub и пересобрать?")) return;
    setStatus("running");
    setMsg(null);
    try {
      const data = await api<{ ok: boolean; stdout: string; stderr: string }>("/api/v1/admin/deploy", { method: "POST" });
      setStatus(data.ok ? "ok" : "err");
      setMsg(data.ok ? "Обновлено" : (data.stderr || "Ошибка сборки"));
    } catch (e) {
      setStatus("err");
      setMsg(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={status === "running"}
      title={msg || undefined}
      className="rounded-full border border-[var(--line)] px-3 py-1 text-[11px] font-medium text-[var(--text-dim)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
    >
      {status === "running" ? "Обновление…" : status === "ok" ? "Готово" : "Обновить"}
    </button>
  );
}

export function Owner() {
  const { data: me, isLoading: meLoading } = useMe();
  const { data, isLoading, error, refetch, isFetching } = useEconomySettings();
  const [tab, setTab] = useState<"overview" | "promos" | "economy">("overview");
  const [filter, setFilter] = useState<string>("all");

  const groups = useMemo(() => {
    const map = new Map<string, EconomySetting[]>();
    for (const s of data || []) {
      const g = s.group || "custom";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return map;
  }, [data]);

  const groupKeys = useMemo(() => ["all", ...Array.from(groups.keys())], [groups]);

  if (meLoading) return <LoadingPanel label="Проверка доступа…" />;
  if (!me?.is_owner) {
    return (
      <div className="space-y-4">
        <ScreenHeader eyebrow="Кабинет" title="Owner" />
        <ErrorPanel message="Доступ только у владельца (TELEGRAM_OWNER_IDS)." />
        <Link to="/" className="btn-ghost inline-flex text-[13px] no-underline">
          ← Контур
        </Link>
      </div>
    );
  }

  const visible =
    filter === "all" ? data : data?.filter((s) => (s.group || "custom") === filter);

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Owner"
        title="Кабинет"
        action={
          <div className="flex items-center gap-2">
            <DeployButton />
            <StatusPill tone={isFetching ? "live" : "ok"}>
              {isFetching ? "sync" : "online"}
            </StatusPill>
          </div>
        }
      />

      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {(["overview", "promos", "economy"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-full border py-1.5 text-[11px] font-medium transition ${
              tab === t
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--line)] text-[var(--text-dim)]"
            }`}
          >
            {t === "overview" ? "Обзор" : t === "promos" ? "Промокоды" : "Экономика"}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "promos" && <PromosTab />}
      {tab === "economy" && (
        <>
          {isLoading && <LoadingPanel label="Загрузка настроек…" />}
          {error && <ErrorPanel message="Не удалось загрузить economy settings" />}
          {!isLoading && !error && data && (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                {groupKeys.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setFilter(g)}
                    className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
                      filter === g
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "border-[var(--line)] text-[var(--text-dim)]"
                    }`}
                  >
                    {g === "all" ? "Все" : GROUP_RU[g] || g}
                  </button>
                ))}
              </div>
              <ul className="space-y-3">
                {visible?.map((item) => (
                  <li key={item.key}>
                    <SettingRow item={item} onSaved={() => refetch()} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <Link to="/" className="btn-ghost inline-flex text-[13px] no-underline">
        ← Контур
      </Link>
    </div>
  );
}
