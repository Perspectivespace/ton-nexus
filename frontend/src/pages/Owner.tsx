import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import {
  useMe,
  useEconomySettings,
  usePromoCreate,
  useOwnerStats,
  usePromoList,
} from "@/api/hooks";
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
  SectionLabel,
} from "@/components/ui";
import { isFpsOn, setFpsOn } from "@/lib/fps";

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

/**
 * Счётчик FPS для проверки плавности на телефоне: плашка в левом верхнем углу.
 * Только на этом устройстве (localStorage), включается и выключается сразу, без перезапуска.
 * Ссылки ?fps=1 / startapp=fps1 работают как раньше.
 */
function FpsToggle() {
  const [on, setOn] = useState(isFpsOn);
  return (
    <div className="space-y-2">
      <SectionLabel>Проверка</SectionLabel>
      <List>
        <ListRow
          title="Счётчик FPS"
          sub={
            on
              ? "Плашка слева вверху · этот телефон"
              : "Плавность в углу экрана"
          }
          trailing={
            <StatusPill tone={on ? "ok" : "neutral"}>{on ? "вкл" : "выкл"}</StatusPill>
          }
          chevron={false}
          onClick={() => {
            setFpsOn(!on);
            setOn(!on);
          }}
        />
      </List>
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

const TABS = ["overview", "promos", "economy"] as const;
type Tab = (typeof TABS)[number];
const TAB_RU: Record<Tab, string> = {
  overview: "Обзор",
  promos: "Промо",
  economy: "Экономика",
};

export function Owner() {
  const { data: me, isLoading: meLoading } = useMe();
  const isOwner = !!me?.is_owner;
  const { data, isLoading, error, refetch, isFetching } =
    useEconomySettings(isOwner);
  const [params] = useSearchParams();
  const asked = params.get("tab");
  const [tab, setTab] = useState<Tab>(
    asked && (TABS as readonly string[]).includes(asked) ? (asked as Tab) : "overview",
  );

  // Деплой живёт на своём экране: старые ссылки `/owner?tab=deploy` (и деплойер без кабинета) — туда.
  if (asked === "deploy" || (!meLoading && !isOwner && me?.can_deploy)) {
    return <Navigate to="/deploy" replace />;
  }
  if (meLoading) return <LoadingPanel label="Проверка доступа…" />;
  if (!isOwner) {
    return (
      <OwnerShell title="Нет доступа">
        <ErrorPanel message="Кабинет открыт только владельцу." />
      </OwnerShell>
    );
  }

  return (
    <OwnerShell
      title="Кабинет владельца"
      eyebrow="Управление"
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

      {tab === "overview" && (
        <div className="space-y-4">
          <OverviewTab />
          <FpsToggle />
        </div>
      )}
      {tab === "promos" && <PromosTab />}
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
