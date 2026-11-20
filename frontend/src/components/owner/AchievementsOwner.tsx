import { useEffect, useMemo, useState } from "react";
import {
  ACH_BRANCHES,
  useAchDecide,
  useAchOwner,
  useAchSettings,
  useAchSettingsSave,
  type AchBranch,
  type AchSettings,
} from "@/api/achievements";
import { INTEGRITY_TIER_RU } from "@/lib/settingsMeta";
import { Button, EmptyPanel, ErrorPanel, Field, List, ListRow, LoadingPanel, Panel, SectionLabel, StatTile, StatusPill, useToast } from "@/components/ui";

/**
 * Кабинет → «Достижения»: сколько выплачено, награды на подтверждение, все ступени веток (порог, TON, XP, вкл.)
 * и общие переключатели. Сохраняется одной настройкой economy_settings «achievements». Кабинет — на русском.
 */
export const BRANCH_RU: Record<AchBranch, string> = {
  tasks: "Задания",
  miner: "Уровень майнера",
  games: "Сыграно игр",
  level: "Уровень аккаунта",
  ambassador: "Амбассадор (только значки)",
};
const UNIT_RU: Record<AchBranch, string> = {
  tasks: "принятых заданий",
  miner: "сумма параметров майнера, максимум 120",
  games: "боёв арены, забегов башни со счётом и вращений колеса",
  level: "уровень аккаунта",
  ambassador: "размещённых заданий",
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

function Pending() {
  const { data, isLoading, error, refetch, isFetching } = useAchOwner();
  const decide = useAchDecide();
  const toast = useToast();
  async function act(id: number, approve: boolean, label: string) {
    if (!approve && !window.confirm(`Отклонить награду «${label}»? Ступень останется пройденной, TON не начислится.`)) return;
    try {
      await decide.mutateAsync({ id, approve });
      toast({ kind: "ok", title: approve ? "Награда зачислена" : "Награда отклонена", sub: label });
    } catch (e) {
      toast({ kind: "danger", title: "Не получилось", sub: e instanceof Error ? e.message : "Ошибка" });
    }
  }
  return (
    <div className="space-y-2">
      <SectionLabel
        action={
          <Button kind="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "обновляю…" : "обновить"}
          </Button>
        }
      >
        Выплаты за достижения
      </SectionLabel>
      {isLoading && <LoadingPanel label="Загрузка…" />}
      {error && <ErrorPanel message="Не удалось загрузить достижения" />}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="выплачено" value={data.paid_ton} sub="TON всего" />
            <StatTile label="ждут" value={data.counts.pending} sub={`${data.pending_ton} TON`} />
            <StatTile label="получено" value={data.counts.paid} sub="ступеней" />
          </div>
          {data.pending.length === 0 ? (
            <EmptyPanel title="Подтверждать нечего" body="Сюда попадают крупные награды (от порога ниже) — TON начислится после вашего решения." />
          ) : (
            <List>
              {data.pending.map((a) => {
                const label = `${BRANCH_RU[a.branch]} · ${a.tier}`;
                return (
                  <div key={a.id} className="ach-ow-pending">
                    <ListRow
                      title={`${a.user} — ${label}`}
                      sub={`${when(a.created_at)} · Честность: ${INTEGRITY_TIER_RU[a.integrity_tier ?? ""] ?? "—"}`}
                      trailing={<StatusPill tone="warn">{a.ton} TON</StatusPill>}
                      chevron={false}
                    />
                    <div className="flex gap-2 px-4 pb-3">
                      <Button kind="primary" size="sm" disabled={decide.isPending} onClick={() => act(a.id, true, label)}>
                        Зачислить
                      </Button>
                      <Button kind="ghost" size="sm" disabled={decide.isPending} onClick={() => act(a.id, false, label)}>
                        Отклонить
                      </Button>
                    </div>
                  </div>
                );
              })}
            </List>
          )}
        </>
      )}
    </div>
  );
}

type Draft = AchSettings;

function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <select className="ui-input" value={value ? "1" : "0"} onChange={(e) => onChange(e.target.value === "1")}>
        <option value="1">Вкл</option>
        <option value="0">Выкл</option>
      </select>
    </Field>
  );
}

function BranchEditor({
  branch,
  draft,
  setDraft,
  holders,
}: {
  branch: AchBranch;
  draft: Draft;
  setDraft: (d: Draft) => void;
  holders: Map<string, number>;
}) {
  const b = draft.branches[branch];
  const badgeOnly = branch === "ambassador";
  const put = (patch: Partial<typeof b>) => setDraft({ ...draft, branches: { ...draft.branches, [branch]: { ...b, ...patch } } });
  const putTier = (i: number, patch: Partial<(typeof b.tiers)[number]>) => put({ tiers: b.tiers.map((t, k) => (k === i ? { ...t, ...patch } : t)) });
  return (
    <Panel level="e1" cut="m" className="space-y-3 p-4" lift={false}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="ach-ow-title">{BRANCH_RU[branch]}</p>
          <p className="ui-sys">порог — {UNIT_RU[branch]}</p>
        </div>
        <select
          className="ui-input ach-ow-sw"
          aria-label={`Ветка «${BRANCH_RU[branch]}»`}
          value={b.enabled ? "1" : "0"}
          onChange={(e) => put({ enabled: e.target.value === "1" })}
        >
          <option value="1">Вкл</option>
          <option value="0">Выкл</option>
        </select>
      </div>
      <div className={`ach-ow-grid${badgeOnly ? " no-ton" : ""}`} role="table" aria-label={`Ступени: ${BRANCH_RU[branch]}`}>
        <span className="ach-ow-h">Порог</span>
        {!badgeOnly && <span className="ach-ow-h">TON</span>}
        <span className="ach-ow-h">XP</span>
        <span className="ach-ow-h">Вкл</span>
        <span className="ach-ow-h" />
        {b.tiers.map((t, i) => (
          <TierRow
            key={i}
            badgeOnly={badgeOnly}
            t={t}
            got={holders.get(`${branch}:${t.at}`) ?? 0}
            onChange={(p) => putTier(i, p)}
            onRemove={b.tiers.length > 1 ? () => put({ tiers: b.tiers.filter((_, k) => k !== i) }) : undefined}
          />
        ))}
      </div>
      <Button
        kind="ghost"
        size="sm"
        disabled={b.tiers.length >= 20}
        onClick={() => {
          const last = b.tiers[b.tiers.length - 1];
          put({ tiers: [...b.tiers, { at: (last?.at ?? 0) * 2 || 1, ton: "0", xp: last?.xp ?? 0, enabled: true }] });
        }}
      >
        + ступень
      </Button>
    </Panel>
  );
}

function TierRow({
  t,
  badgeOnly,
  got,
  onChange,
  onRemove,
}: {
  t: Draft["branches"][AchBranch]["tiers"][number];
  badgeOnly: boolean;
  got: number;
  onChange: (p: Partial<Draft["branches"][AchBranch]["tiers"][number]>) => void;
  onRemove?: () => void;
}) {
  return (
    <>
      <span className="ach-ow-cell">
        <input className="ui-input" inputMode="numeric" aria-label="Порог" value={String(t.at)} onChange={(e) => onChange({ at: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
        <span className="ui-sys">получили: {got}</span>
      </span>
      {!badgeOnly && (
        <span className="ach-ow-cell">
          <input className="ui-input" inputMode="decimal" aria-label="TON" value={t.ton} onChange={(e) => onChange({ ton: e.target.value })} />
        </span>
      )}
      <span className="ach-ow-cell">
        <input className="ui-input" inputMode="numeric" aria-label="XP" value={String(t.xp)} onChange={(e) => onChange({ xp: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
      </span>
      <span className="ach-ow-cell">
        <input type="checkbox" className="ach-ow-check" aria-label="Ступень включена" checked={t.enabled} onChange={(e) => onChange({ enabled: e.target.checked })} />
      </span>
      <span className="ach-ow-cell">
        {onRemove && (
          <button type="button" className="ach-ow-x" aria-label="Убрать ступень" onClick={onRemove}>
            ×
          </button>
        )}
      </span>
    </>
  );
}

function SettingsForm() {
  const { data, isLoading, error } = useAchSettings();
  const owner = useAchOwner();
  const save = useAchSettingsSave();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (data?.value) setDraft(structuredCloneSafe(data.value));
  }, [data]);
  const holders = useMemo(() => new Map((owner.data?.holders ?? []).map((h) => [`${h.branch}:${h.tier}`, h.count])), [owner.data]);
  if (isLoading || !draft) return error ? <ErrorPanel message="Не удалось загрузить настройку достижений" /> : <LoadingPanel label="Загрузка настройки…" />;
  const dirty = JSON.stringify(draft) !== JSON.stringify(data?.value);

  async function submit() {
    if (!draft) return;
    if (data?.value.retroactive && !draft.retroactive) {
      const ok = window.confirm(
        "Выключить «засчитывать прошлый прогресс»? С этого момента задания и игры считаются заново, а уже пройденные уровни майнера и аккаунта отметятся без награды. Обычно это делают перед запуском.",
      );
      if (!ok) return;
    }
    try {
      await save.mutateAsync(draft);
      toast({ kind: "ok", title: "Достижения сохранены" });
    } catch (e) {
      toast({ kind: "danger", title: "Не сохранено", sub: e instanceof Error ? e.message : "Ошибка" });
    }
  }

  return (
    <div className="space-y-3">
      <SectionLabel>Настройка</SectionLabel>
      <Panel level="e1" cut="m" className="grid grid-cols-2 gap-x-2 gap-y-3 p-4" lift={false}>
        <Toggle label="Достижения" value={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} hint="Выкл — новые ступени не выдаются" />
        <Field label="Подтверждать от" unit="TON" hint="Награды от этой суммы ждут вас">
          <input className="ui-input" inputMode="decimal" value={draft.manual_from_ton} onChange={(e) => setDraft({ ...draft, manual_from_ton: e.target.value })} />
        </Field>
        <Toggle
          label="Засчитывать прошлое"
          value={draft.retroactive}
          onChange={(v) => setDraft({ ...draft, retroactive: v })}
          hint={
            draft.retroactive
              ? "Вкл — считается весь прогресс игроков (тест)"
              : `Старт с нуля${data?.value.start_at ? ` с ${when(data.value.start_at)}` : " — с момента сохранения"}`
          }
        />
        <Toggle
          label="Низкая Честность"
          value={draft.manual_low_integrity}
          onChange={(v) => setDraft({ ...draft, manual_low_integrity: v })}
          hint="Вкл — награды игрокам с тиром «Неприязнь» и «Настороженность» тоже ждут вас"
        />
      </Panel>
      {ACH_BRANCHES.map((b) => (
        <BranchEditor key={b} branch={b} draft={draft} setDraft={setDraft} holders={holders} />
      ))}
      <div className="ach-ow-save">
        <Button kind="primary" block disabled={!dirty || save.isPending} onClick={submit}>
          {save.isPending ? "Сохранение…" : dirty ? "Сохранить достижения" : "Изменений нет"}
        </Button>
      </div>
    </div>
  );
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function AchievementsOwner() {
  return (
    <div className="space-y-5">
      <Pending />
      <SettingsForm />
    </div>
  );
}
