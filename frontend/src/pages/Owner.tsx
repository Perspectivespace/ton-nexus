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
  Panel,
  Button,
  StatTile,
  List,
  ListRow,
  Tabs,
  Field,
  useToast,
} from "@/components/ui";
import { IconBack } from "@/components/icons";

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

  const toast = useToast();

  async function save(value: unknown) {
    try {
      await update.mutateAsync({ key: item.key, value });
    } catch (e) {
      // текст ошибки по-прежнему показывает и сам редактор
      toast({ kind: "danger", title: "Настройка не сохранена", sub: e instanceof Error ? e.message : "Ошибка" });
      throw e;
    }
    onSaved();
    setEditing(false);
    toast({ kind: "ok", title: "Настройка сохранена", sub: title });
  }

  return (
    <Panel className="overflow-hidden">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="ui-h !text-[14px] !leading-[20px]">{title}</p>
            {subtitle && <p className="ui-sec mt-0.5">{subtitle}</p>}
          </div>
          {!editing && (
            <Button kind="secondary" size="sm" className="shrink-0" onClick={() => setEditing(true)}>
              Изменить
            </Button>
          )}
        </div>
        {!editing && (
          <p className="ui-num s-m mt-3 block">
            {summarize(item.key, item.value)}
          </p>
        )}
      </div>
      {editing && (
        <div className="space-y-4 border-t border-[var(--line)] p-4">
          {meta?.about && <p className="ui-sec border-l-2 border-[var(--line-strong)] pl-3">{meta.about}</p>}
          <SettingEditor
            settingKey={item.key}
            value={item.value}
            saving={update.isPending}
            onSave={save}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
    </Panel>
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
    <Panel className="space-y-3 p-4">
      <p className="ui-label">Новый промокод</p>
      <Field label="Код">
        <input
          className="ui-input uppercase"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="WELCOME"
        />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="TON" unit="TON">
          <input
 className="ui-input" value={ton} onChange={(e) => setTon(e.target.value)} />
        </Field>
        <Field label="XP" unit="XP">
          <input
 className="ui-input" value={xp} onChange={(e) => setXp(e.target.value)} />
        </Field>
        <Field label="Фокус">
          <input
            className="ui-input"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
          />
        </Field>
      </div>
      <Field label="Лимит активаций (пусто = ∞)">
        <input
          className="ui-input"
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
          placeholder="100"
        />
      </Field>
      <Button kind="primary" block disabled={create.isPending || code.length < 3} onClick={submit}>
        {create.isPending ? "…" : "Создать промокод"}
      </Button>
      {msg && <p className="ui-sec">{msg}</p>}
    </Panel>
  );
}

function OverviewTab() {
  const { data, isLoading, error } = useOwnerStats();
  if (isLoading) return <LoadingPanel label="Загрузка статистики…" />;
  if (error) return <ErrorPanel message="Не удалось загрузить статистику" />;
  return (
    <div className="grid grid-cols-2 gap-3">
      <StatTile label="Пользователи" value={data?.total_users ?? 0} className="!h-[88px]" />
      <StatTile label="Сегодня" value={data?.registrations_today ?? 0} className="!h-[88px]" />
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
        <List>
          {data.map((p) => (
            <ListRow
              key={p.id}
              title={<span className="ui-num s-m">{p.code}</span>}
              sub={`${p.reward_ton} TON · ${p.reward_xp} XP · ${p.used_count}${p.max_uses != null ? ` / ${p.max_uses}` : ""}`}
              trailing={
                <StatusPill tone={p.is_active ? "ok" : "neutral"}>{p.is_active ? "активен" : "выкл."}</StatusPill>
              }
            />
          ))}
        </List>
      )}
      <Button kind="ghost" size="sm" onClick={() => refetch()}>
        Обновить список
      </Button>
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
        <ScreenHeader eyebrow="Деплой" title="Сервер" action={<StatusPill tone="ok">в сети</StatusPill>} />
        <DeployPanel />
      </div>
    );
  }
  if (!isOwner) {
    return (
      <div className="space-y-4">
        <ScreenHeader eyebrow="Кабинет" title="Владелец" />
        <ErrorPanel message="Доступ только у владельца (TELEGRAM_OWNER_IDS)." />
        <Link to="/" className="ui-btn ghost sm self-start">
          <IconBack size={16} /> Контур
        </Link>
      </div>
    );
  }

  const visible =
    filter === "all" ? data : data?.filter((s) => (s.group || "custom") === filter);

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Владелец"
        title="Кабинет"
        action={
          <StatusPill tone={isFetching ? "live" : "ok"}>
            {isFetching ? "синхр." : "в сети"}
          </StatusPill>
        }
      />

      <Tabs
        label="Разделы кабинета"
        items={TABS.map((t) => ({ value: t, label: TAB_RU[t] }))}
        value={tab}
        onChange={setTab}
      />

      {tab === "overview" && <OverviewTab />}
      {tab === "promos" && <PromosTab />}
      {tab === "deploy" && <DeployPanel />}
      {tab === "economy" && (
        <>
          {isLoading && <LoadingPanel label="Загрузка настроек…" />}
          {error && <ErrorPanel message="Не удалось загрузить настройки экономики" />}
          {!isLoading && !error && data && (
            <>
              <Tabs
                kind="line"
                label="Группы настроек"
                items={groupKeys.map((g) => ({ value: g, label: g === "all" ? "Все" : GROUP_RU[g] || g }))}
                value={filter}
                onChange={setFilter}
              />
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

      <Link to="/" className="ui-btn ghost sm self-start">
        <IconBack size={16} /> Контур
      </Link>
    </div>
  );
}
