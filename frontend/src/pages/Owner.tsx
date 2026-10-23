import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  useMe,
  useEconomySettings,
  useEconomyUpdate,
  usePromoCreate,
  useOwnerStats,
  usePromoList,
  type EconomySetting,
} from "@/api/hooks";
import { DeployPanel } from "@/components/DeployPanel";
import { SettingEditor } from "@/components/SettingEditor";
import { SETTINGS, summarize } from "@/lib/settingsMeta";
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
  daily: "Ежедневно",
  progression: "Уровни",
  roulette: "Рулетка",
  custom: "Прочее",
};

function SettingRow({
  item,
  onSaved,
}: {
  item: EconomySetting;
  onSaved: () => void;
}) {
  const update = useEconomyUpdate();
  const [editing, setEditing] = useState(false);
  const meta = SETTINGS[item.key];
  const title = meta?.title || item.label || item.key;
  const subtitle = meta?.short || item.description;

  async function save(value: unknown) {
    await update.mutateAsync({ key: item.key, value });
    onSaved();
    setEditing(false);
  }

  return (
    <div className="panel overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium leading-snug">{title}</p>
            {subtitle && (
              <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-dim)]">{subtitle}</p>
            )}
          </div>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="shrink-0 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 py-1.5 font-mono text-[12px] text-[var(--accent)] transition hover:border-[var(--accent)]"
            >
              Изменить
            </button>
          )}
        </div>
        {!editing && (
          <p className="mt-3 font-mono text-[15px] leading-relaxed text-[var(--text)]">
            {summarize(item.key, item.value)}
          </p>
        )}
      </div>
      {editing && (
        <div className="space-y-4 border-t border-[var(--line)] bg-[var(--bg-elev)]/40 p-4">
          {meta?.about && (
            <p className="rounded-xl border border-[var(--line)] bg-black/15 p-3 text-[12px] leading-relaxed text-[var(--text-dim)]">
              {meta.about}
            </p>
          )}
          <SettingEditor
            settingKey={item.key}
            value={item.value}
            saving={update.isPending}
            onSave={save}
            onCancel={() => setEditing(false)}
          />
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

const TABS = ["overview", "promos", "economy", "deploy"] as const;
type Tab = (typeof TABS)[number];
const TAB_RU: Record<Tab, string> = {
  overview: "Обзор",
  promos: "Промокоды",
  economy: "Экономика",
  deploy: "Деплой",
};

export function Owner() {
  const { data: me, isLoading: meLoading } = useMe();
  const isOwner = !!me?.is_owner;
  const { data, isLoading, error, refetch, isFetching } = useEconomySettings(isOwner);
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get("tab") === "deploy" ? "deploy" : "overview");
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
  if (!isOwner && me?.can_deploy) {
    return (
      <div className="space-y-5">
        <ScreenHeader eyebrow="Deployer" title="Деплой" action={<StatusPill tone="ok">online</StatusPill>} />
        <DeployPanel />
      </div>
    );
  }
  if (!isOwner) {
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
          <StatusPill tone={isFetching ? "live" : "ok"}>
            {isFetching ? "sync" : "online"}
          </StatusPill>
        }
      />

      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-medium transition ${
              tab === t
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--line)] text-[var(--text-dim)]"
            }`}
          >
            {TAB_RU[t]}
          </button>
        ))}
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "promos" && <PromosTab />}
      {tab === "deploy" && <DeployPanel />}
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
