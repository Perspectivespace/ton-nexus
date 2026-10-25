import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  useDeployCheck,
  useDeployJob,
  useDeployJobs,
  useDeployOverview,
  useDeployRequest,
  useDeployers,
  useSetDeployer,
} from "@/api/hooks";
import type { DeployJob, DeployStatus } from "@/api/types";
import {
  Button,
  EmptyPanel,
  ErrorPanel,
  Field,
  HoldButton,
  List,
  ListRow,
  LoadingPanel,
  Panel,
  SectionLabel,
  Sheet,
  StatusPill,
  useToast,
} from "@/components/ui";
import { cx } from "@/components/ui/press";

const STEPS: { key: string; label: string }[] = [
  { key: "fetch", label: "GitHub" },
  { key: "checkout", label: "Код" },
  { key: "pip", label: "pip" },
  { key: "migrate", label: "БД" },
  { key: "npm_ci", label: "npm" },
  { key: "build", label: "Сборка" },
  { key: "restart", label: "API" },
  { key: "health", label: "Проверка" },
  { key: "nginx", label: "nginx" },
];

const STATUS_RU: Record<DeployStatus, string> = {
  queued: "в очереди",
  running: "идёт",
  success: "готово",
  failed: "ошибка",
};

function tone(s?: DeployStatus | null): "neutral" | "live" | "warn" | "danger" | "ok" {
  if (s === "success") return "ok";
  if (s === "failed") return "danger";
  if (s === "running" || s === "queued") return "live";
  return "neutral";
}

const short = (sha?: string | null) => (sha ? sha.slice(0, 7) : "—");

function when(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function duration(j: DeployJob) {
  if (!j.started_at) return null;
  const end = j.finished_at ? new Date(j.finished_at) : new Date();
  const s = Math.max(0, Math.round((end.getTime() - new Date(j.started_at).getTime()) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}м ${s % 60}с` : `${s}с`;
}

/** Рельс шагов без подписей под каждым (на 360 px они обрезались) — подпись текущего шага строкой ниже. */
function StepRail({ job }: { job: DeployJob }) {
  const done = new Set(job.steps_done ?? []);
  const idx = STEPS.findIndex((s) => s.key === job.step);
  const cur = idx >= 0 ? STEPS[idx] : null;
  const caption =
    job.status === "success"
      ? `Все ${STEPS.length} шагов пройдены`
      : cur
        ? `Шаг ${idx + 1} из ${STEPS.length} · ${cur.label}${job.status === "failed" ? " — ошибка" : ""}`
        : STATUS_RU[job.status] ?? job.status;
  return (
    <div>
      <div className="dp-rail" aria-hidden>
        {STEPS.map((s) => {
          const current = job.step === s.key && job.status !== "success";
          const failed = current && job.status === "failed";
          const ok = done.has(s.key) || (job.status === "success" && job.step === s.key);
          return <i key={s.key} className={cx(failed ? "err" : current ? "cur" : ok ? "ok" : "")} />;
        })}
      </div>
      <p className="ui-sys mt-2">{caption}</p>
    </div>
  );
}

function LogTail({ text }: { text?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  return (
    <pre ref={ref} className="dp-log">
      {text?.trim() || "Лог пока пуст…"}
    </pre>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="ui-label">{label}</p>
      <p className="ui-num s-s mt-1 block truncate">{children}</p>
    </div>
  );
}

function JobCard({ id, onClose }: { id: string; onClose?: () => void }) {
  const { data: job, error } = useDeployJob(id);
  const [showLog, setShowLog] = useState(true);
  if (error) return <ErrorPanel message="Не удалось загрузить деплой" />;
  if (!job) return <LoadingPanel label="Деплой поставлен в очередь…" />;
  const live = job.status === "queued" || job.status === "running";
  return (
    <Panel className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="ui-label">Деплой · {job.target}</p>
          <p className="ui-num s-m mt-1 block truncate">
            {short(job.from_commit)} → {short(job.to_commit)}
          </p>
          {job.to_subject && <p className="ui-sec mt-0.5 truncate">{job.to_subject}</p>}
        </div>
        <StatusPill tone={tone(job.status)}>{STATUS_RU[job.status] ?? job.status}</StatusPill>
      </div>
      <StepRail job={job} />
      <p className="ui-sys">
        {job.requested_by_name ?? job.requested_by ?? "—"} · {when(job.requested_at)}
        {duration(job) ? ` · ${duration(job)}` : ""}
        {job.force ? " · полный" : ""}
      </p>
      {job.error && (
        <p className="dp-note err">
          {job.error}
          {job.status === "failed" ? " — сервер откатан на прежнюю версию." : ""}
        </p>
      )}
      {job.warning && <p className="dp-note warn">{job.warning}</p>}
      <div className="flex gap-2">
        <Button kind="ghost" size="sm" onClick={() => setShowLog((v) => !v)}>
          {showLog ? "Скрыть лог" : "Показать лог"}
        </Button>
        {onClose && !live && (
          <Button kind="ghost" size="sm" onClick={onClose}>
            Закрыть
          </Button>
        )}
      </div>
      {showLog && <LogTail text={job.log_tail} />}
    </Panel>
  );
}

function DeployersCard() {
  const { data, isLoading, error } = useDeployers();
  const setRole = useSetDeployer();
  const [tgId, setTgId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  // Кого снимаем — пока открыта шторка подтверждения (раньше был системный confirm()).
  const [revoke, setRevoke] = useState<{ telegram_id: number; name: string } | null>(null);
  const toast = useToast();

  async function change(telegram_id: number, is_deployer: boolean) {
    setMsg(null);
    try {
      await setRole.mutateAsync({ telegram_id, is_deployer });
      if (is_deployer) setTgId("");
      const done = is_deployer ? "Деплойер добавлен" : "Доступ снят";
      setMsg(done);
      toast({ kind: "ok", title: done, sub: String(telegram_id) });
    } catch (e) {
      const m = e instanceof Error ? e.message : "Ошибка";
      const text = m === "user not found" ? "Пользователь ещё не открывал Mini App" : m;
      setMsg(text);
      toast({ kind: "danger", title: is_deployer ? "Не удалось добавить" : "Не удалось снять доступ", sub: text });
    }
  }

  return (
    <section className="space-y-2">
      <SectionLabel action={<StatusPill tone="neutral">только владелец</StatusPill>}>Деплойеры</SectionLabel>
      <Panel className="space-y-4 p-4">
        <p className="ui-sec">Могут обновлять сервер. Доступа к экономике, кассе и модерации не получают.</p>
        {isLoading && <p className="ui-sys">Загрузка…</p>}
        {error && <p className="ui-fhint err">Не удалось загрузить список</p>}
        {data && data.length === 0 && <p className="ui-sec">Пока никого — деплоит только владелец.</p>}
        {data && data.length > 0 && (
          <ul className="dp-people">
            {data.map((d) => (
              <li key={d.telegram_id}>
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium">{d.username ? `@${d.username}` : d.first_name || "—"}</p>
                  <p className="ui-num s-s block text-[var(--text-3)]">{d.telegram_id}</p>
                </div>
                <Button
                  kind="danger"
                  size="sm"
                  disabled={setRole.isPending}
                  onClick={() =>
                    setRevoke({
                      telegram_id: d.telegram_id,
                      name: d.username ? `@${d.username}` : d.first_name || String(d.telegram_id),
                    })
                  }
                >
                  Снять
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <Field className="flex-1" label="Добавить по Telegram ID">
            <input
              className="ui-input"
              inputMode="numeric"
              placeholder="528193047"
              aria-label="Telegram ID"
              value={tgId}
              onChange={(e) => setTgId(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Button disabled={setRole.isPending || tgId.length < 5} onClick={() => change(Number(tgId), true)}>
            Добавить
          </Button>
        </div>
        {msg && <p className="ui-sys">{msg}</p>}
      </Panel>
      <Sheet open={!!revoke} onClose={() => setRevoke(null)} title="Снять право деплоя?">
        <p className="ui-sec text-[15px]">
          {revoke?.name} больше не сможет обновлять сервер. Вернуть доступ можно в любой момент — добавить по Telegram ID.
        </p>
        <div className="mt-5 grid gap-2">
          <HoldButton
            kind="danger"
            block
            disabled={setRole.isPending}
            onConfirm={() => {
              const r = revoke;
              setRevoke(null);
              if (r) change(r.telegram_id, false);
            }}
          >
            Удерживайте — снять доступ
          </HoldButton>
          <Button kind="ghost" block onClick={() => setRevoke(null)}>
            Отмена
          </Button>
        </div>
      </Sheet>
    </section>
  );
}

export function DeployPanel() {
  const { data, isLoading, error } = useDeployOverview();
  const jobs = useDeployJobs();
  const check = useDeployCheck();
  const request = useDeployRequest();
  const [openId, setOpenId] = useState<string | null>(null);
  const [force, setForce] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Шторка подтверждения деплоя (раньше был системный confirm()).
  const [ask, setAsk] = useState(false);
  const toast = useToast();

  const activeId = data?.active?.id ?? null;
  const shownId = activeId ?? openId;
  const prevActive = useRef<string | null>(null);

  // When a running deploy finishes, keep its card open and refresh history.
  useEffect(() => {
    if (prevActive.current && !activeId) {
      setOpenId(prevActive.current);
      jobs.refetch();
    }
    prevActive.current = activeId;
  }, [activeId, jobs]);

  if (isLoading) return <LoadingPanel label="Проверка сервера…" />;
  if (error || !data) return <ErrorPanel message="Не удалось получить статус деплоя" />;

  const askText = force
    ? "Полный деплой теста: переустановить зависимости, миграции и пересобрать всё?"
    : "Обновить тестовый сервер до последней версии из GitHub?";

  // Тот же запрос, что и раньше; подтверждение теперь — удержание в шторке.
  async function run() {
    setAsk(false);
    setMsg(null);
    try {
      const job = await request.mutateAsync({ target: "test", force });
      setOpenId(job.id);
      setForce(false);
      toast({ kind: "ok", title: "Деплой запущен", sub: force ? "полный · тест" : "тест" });
    } catch (e) {
      const m = e instanceof Error ? e.message : "Ошибка";
      setMsg(m);
      toast({ kind: "danger", title: "Деплой не запустился", sub: m });
    }
  }

  const upToDate = data.update_available === false;
  const busy = !!data.active || request.isPending;

  return (
    <div className="space-y-5">
      {!data.runner_installed && (
        <p className="dp-note warn">
          <b className="ui-label block text-[var(--amber)]">Runner не установлен</b>
          Один раз выполните на сервере команду установки из docs/DEPLOY_TELEGRAM.md — после этого обновление работает отсюда.
        </p>
      )}

      <section className="space-y-2">
        <SectionLabel>Тестовый сервер</SectionLabel>
        <Panel className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="ui-label">Версия на сервере</p>
              <p className="ui-num s-l mt-1 block">{short(data.deployed.commit)}</p>
              {data.deployed.subject && <p className="ui-sec mt-1">{data.deployed.subject}</p>}
            </div>
            <StatusPill tone={data.active ? "live" : upToDate ? "ok" : data.update_available ? "warn" : "neutral"}>
              {data.active ? "деплой" : upToDate ? "актуально" : data.update_available ? "есть обновление" : "нет данных"}
            </StatusPill>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-3">
            <Meta label="Обновлено">{when(data.deployed.deployed_at)}</Meta>
            <Meta label="GitHub main">
              {short(data.latest?.commit)}
              {data.ahead_by ? <span className="text-[var(--amber)]"> · +{data.ahead_by}</span> : null}
            </Meta>
          </div>

          {data.pending.length > 0 && (
            <div className="space-y-2 border-t border-[var(--line)] pt-3">
              <p className="ui-label">Что приедет</p>
              <ul className="space-y-1.5">
                {data.pending.map((c) => (
                  <li key={c.sha} className="flex gap-2.5 text-[13px] leading-snug">
                    <span className="ui-num s-s shrink-0 text-[var(--neon)]">{c.sha}</span>
                    <span className="min-w-0 text-[var(--text)]">{c.subject}</span>
                  </li>
                ))}
              </ul>
              {data.ahead_by != null && data.ahead_by > data.pending.length && (
                <p className="ui-sys">…и ещё {data.ahead_by - data.pending.length}</p>
              )}
            </div>
          )}

          {data.github_error && (
            <p className="dp-note warn">{data.github_error}. Показана версия последней проверки сервера.</p>
          )}

          <div className="space-y-3 pt-1">
            <Button block disabled={busy || !data.runner_installed} onClick={() => setAsk(true)}>
              {data.active
                ? "Деплой идёт…"
                : request.isPending
                  ? "Ставлю в очередь…"
                  : force
                    ? "Полный деплой теста"
                    : "Обновить тест"}
            </Button>
            <div className="flex items-center justify-between gap-2">
              <label className="dp-check">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} disabled={busy} />
                Полный (всё заново)
              </label>
              <Button kind="ghost" size="sm" disabled={check.isPending} onClick={() => check.mutate()}>
                {check.isPending ? "Проверяю…" : "Проверить GitHub"}
              </Button>
            </div>
          </div>
          {msg && <p className="ui-fhint err">{msg}</p>}
          <p className="ui-sys border-t border-[var(--line)] pt-3">Боевой сервер — скоро, отдельной кнопкой.</p>
        </Panel>
      </section>

      {shownId && <JobCard id={shownId} onClose={activeId ? undefined : () => setOpenId(null)} />}

      <Sheet open={ask} onClose={() => setAsk(false)} title={force ? "Полный деплой теста" : "Обновить тестовый сервер"}>
        <p className="ui-sec text-[15px]">{askText}</p>
        {data.latest && (
          <p className="ui-num s-s mt-3 block whitespace-normal text-[var(--text-3)]">
            → {short(data.latest.commit)} {data.latest.subject ?? ""}
          </p>
        )}
        <div className="mt-5 grid gap-2">
          <HoldButton block disabled={busy || !data.runner_installed} onConfirm={run}>
            {force ? "Удерживайте — полный деплой" : "Удерживайте — обновить"}
          </HoldButton>
          <Button kind="ghost" block onClick={() => setAsk(false)}>
            Отмена
          </Button>
        </div>
      </Sheet>

      <section className="space-y-2">
        <SectionLabel>История</SectionLabel>
        {jobs.isLoading && <LoadingPanel label="Загрузка истории…" />}
        {jobs.data && jobs.data.length === 0 && (
          <EmptyPanel title="Деплоев ещё не было" body="Первый запуск появится здесь." />
        )}
        {jobs.data && jobs.data.length > 0 && (
          <List>
            {jobs.data.map((j) => (
              <ListRow
                key={j.id}
                className={cx(shownId === j.id && "dp-row-on")}
                title={
                  <span className="flex min-w-0 gap-2">
                    <span className="ui-num s-s shrink-0">{short(j.to_commit)}</span>
                    <span className="truncate">{j.to_subject ?? ""}</span>
                  </span>
                }
                sub={`${when(j.requested_at)} · ${j.requested_by_name ?? j.requested_by ?? "—"}${duration(j) ? ` · ${duration(j)}` : ""}`}
                trailing={<StatusPill tone={tone(j.status)}>{STATUS_RU[j.status] ?? j.status}</StatusPill>}
                chevron={false}
                onClick={() => setOpenId(j.id)}
              />
            ))}
          </List>
        )}
      </section>

      {data.can_manage_deployers && <DeployersCard />}
    </div>
  );
}
