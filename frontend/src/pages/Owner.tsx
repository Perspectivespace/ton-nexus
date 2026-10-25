import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useMe,
  useEconomySettings,
  usePromoCreate,
  useOwnerStats,
  usePromoList,
} from "@/api/hooks";
import { DeployPanel } from "@/components/DeployPanel";
import { OwnerShell } from "@/components/owner/OwnerShell";
import { SettingsList } from "@/components/owner/SettingsList";
import {
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
} from "@/components/ui";

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
            className="ui-input"
            value={ton}
            onChange={(e) => setTon(e.target.value)}
          />
        </Field>
        <Field label="XP" unit="XP">
          <input
            className="ui-input"
            value={xp}
            onChange={(e) => setXp(e.target.value)}
          />
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
      <Button
        kind="primary"
        block
        disabled={create.isPending || code.length < 3}
        onClick={submit}
      >
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
      <StatTile
        label="Пользователи"
        value={data?.total_users ?? 0}
        className="!h-[88px]"
      />
      <StatTile
        label="Сегодня"
        value={data?.registrations_today ?? 0}
        className="!h-[88px]"
      />
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
                <StatusPill tone={p.is_active ? "ok" : "neutral"}>
                  {p.is_active ? "активен" : "выкл."}
                </StatusPill>
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
  promos: "Промо",
  economy: "Экономика",
  deploy: "Деплой",
};

export function Owner() {
  const { data: me, isLoading: meLoading } = useMe();
  const isOwner = !!me?.is_owner;
  const { data, isLoading, error, refetch, isFetching } =
    useEconomySettings(isOwner);
  const [params] = useSearchParams();
  const asked = params.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(
    asked && TABS.includes(asked) ? asked : "overview",
  );

  if (meLoading) return <LoadingPanel label="Проверка доступа…" />;
  if (!isOwner && me?.can_deploy) {
    return (
      <OwnerShell
        eyebrow="Кабинет деплойера"
        title="Деплой"
        status={<StatusPill tone="ok">в сети</StatusPill>}
      >
        <DeployPanel />
      </OwnerShell>
    );
  }
  if (!isOwner) {
    return (
      <OwnerShell title="Нет доступа">
        <ErrorPanel message="Кабинет открыт только владельцу." />
      </OwnerShell>
    );
  }

  return (
    <OwnerShell
      title="Кабинет"
      status={
        <StatusPill tone={isFetching ? "live" : "ok"}>
          {isFetching ? "синхр." : "в сети"}
        </StatusPill>
      }
    >
      <div className="ow-tabs">
        <Tabs
          kind="blocks"
          label="Разделы кабинета"
          items={TABS.map((t) => ({ value: t, label: TAB_RU[t] }))}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === "overview" && <OverviewTab />}
      {tab === "promos" && <PromosTab />}
      {tab === "deploy" && <DeployPanel />}
      {tab === "economy" && (
        <>
          {isLoading && <LoadingPanel label="Загрузка настроек…" />}
          {error && (
            <ErrorPanel message="Не удалось загрузить настройки экономики" />
          )}
          {!isLoading && !error && data && (
            <SettingsList items={data} onSaved={() => refetch()} />
          )}
        </>
      )}
    </OwnerShell>
  );
}
