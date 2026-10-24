import { useEffect, useRef, useState } from "react";
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
import { Button, EmptyPanel, ErrorPanel, Field, HoldButton, LoadingPanel, Sheet, StatusPill, useToast } from "@/components/ui";

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

function StepRail({ job }: { job: DeployJob }) {
  const done = new Set(job.steps_done ?? []);
  return (
    <div className="grid grid-cols-9 gap-1">
      {STEPS.map((s) => {
        const current = job.step === s.key && job.status !== "success";
        const failed = current && job.status === "failed";
        const ok = done.has(s.key) || (job.status === "success" && job.step === s.key);
        const cls = failed
          ? "bg-[var(--danger)]"
          : current
            ? "bg-[var(--accent-bright)] animate-pulse"
            : ok
              ? "bg-[var(--success)]"
              : "bg-[var(--line)]";
        return (
          <div key={s.key} className="min-w-0 text-center">
            <div className={`h-1 rounded-full ${cls}`} />
            <p
              className={`mt-1 truncate text-[8px] font-semibold uppercase tracking-[0.08em] ${
                current ? "text-[var(--text)]" : "text-[var(--text-dim)]"
              }`}
            >
              {s.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function LogTail({ text }: { text?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  return (
    <pre
      ref={ref}
      className="mono max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--line)] bg-[var(--surface-3)] p-3 text-[10px] leading-relaxed text-[var(--text-dim)]"
    >
      {text?.trim() || "Лог пока пуст…"}
    </pre>
  );
}

function JobCard({ id, onClose }: { id: string; onClose?: () => void }) {
  const { data: job, error } = useDeployJob(id);
  const [showLog, setShowLog] = useState(true);
  if (error) return <ErrorPanel message="Не удалось загрузить деплой" />;
  if (!job) return <LoadingPanel label="Деплой поставлен в очередь…" />;
  const live = job.status === "queued" || job.status === "running";
  return (
    <div className="metal-plate-dim space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Деплой · {job.target}</p>
          <p className="mono mt-1 truncate text-[12px] text-[var(--text)]">
            {short(job.from_commit)} → {short(job.to_commit)}
          </p>
          {job.to_subject && (
            <p className="mt-0.5 truncate text-[11px] text-[var(--text-dim)]">{job.to_subject}</p>
          )}
        </div>
        <StatusPill tone={tone(job.status)}>{STATUS_RU[job.status] ?? job.status}</StatusPill>
      </div>
      <StepRail job={job} />
      <p className="label-meta text-[10px] text-[var(--text-dim)]">
        {job.requested_by_name ?? job.requested_by ?? "—"} · {when(job.requested_at)}
        {duration(job) ? ` · ${duration(job)}` : ""}
        {job.force ? " · полный" : ""}
      </p>
      {job.error && (
        <p className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-2 text-[12px] text-[var(--danger)]">
          {job.error}
          {job.status === "failed" ? " — сервер откатан на прежнюю версию." : ""}
        </p>
      )}
      {job.warning && (
        <p className="rounded-lg border border-[var(--warn)]/30 bg-[var(--warn)]/10 p-2 text-[12px] text-[var(--warn)]">
          {job.warning}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" className="ui-btn ghost sm" onClick={() => setShowLog((v) => !v)}>
          {showLog ? "Скрыть лог" : "Показать лог"}
        </button>
        {onClose && !live && (
          <button type="button" className="ui-btn ghost sm" onClick={onClose}>
            Закрыть
          </button>
        )}
      </div>
      {showLog && <LogTail text={job.log_tail} />}
    </div>
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
    <div className="ui-cut space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Деплойеры</p>
        <StatusPill tone="neutral">только владелец</StatusPill>
      </div>
      <p className="text-[11px] leading-snug text-[var(--text-dim)]">
        Могут обновлять сервер. Доступа к экономике, кассе и модерации не получают.
      </p>
      {isLoading && <p className="text-[12px] text-[var(--text-dim)]">Загрузка…</p>}
      {error && <p className="text-[12px] text-[var(--danger)]">Не удалось загрузить список</p>}
      {data && data.length === 0 && (
        <p className="text-[12px] text-[var(--text-dim)]">Пока никого — деплоит только владелец.</p>
      )}
      {data && data.length > 0 && (
        <ul className="divide-y divide-[var(--line)]">
          {data.map((d) => (
            <li key={d.telegram_id} className="flex items-center justify-between py-2">
              <div className="min-w-0">
                <p className="truncate text-[13px]">{d.username ? `@${d.username}` : d.first_name || "—"}</p>
                <p className="mono text-[10px] text-[var(--text-dim)]">{d.telegram_id}</p>
              </div>
              <button
                type="button"
                className="ui-btn danger sm"
                disabled={setRole.isPending}
                onClick={() => setRevoke({ telegram_id: d.telegram_id, name: d.username ? `@${d.username}` : d.first_name || String(d.telegram_id) })}
              >
                Снять
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Field className="flex-1">
          <input
            className="ui-input"
            inputMode="numeric"
            placeholder="Telegram ID"
            aria-label="Telegram ID"
            value={tgId}
            onChange={(e) => setTgId(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <button
          type="button"
          className="ui-btn primary"
          disabled={setRole.isPending || tgId.length < 5}
          onClick={() => change(Number(tgId), true)}
        >
          Добавить
        </button>
      </div>
      {msg && <p className="text-[12px] text-[var(--text-dim)]">{msg}</p>}
      <Sheet open={!!revoke} onClose={() => setRevoke(null)} title="Снять право деплоя?">
        <p className="text-[14px] leading-snug text-[var(--text-2)]">
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
    </div>
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
    <div className="space-y-4">
      {!data.runner_installed && (
        <div className="ui-cut p-4">
          <p className="eyebrow text-[var(--warn)]">Runner не установлен</p>
          <p className="mt-1 text-[12px] leading-snug text-[var(--text-dim)]">
            Один раз выполните на сервере команду установки из docs/DEPLOY_TELEGRAM.md — после
            этого обновление работает отсюда.
          </p>
        </div>
      )}

      <div className="metal-plate-dim space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Тест · версия на сервере</p>
            <p className="mono mt-1 text-[20px] font-medium text-[var(--text)]">
              {short(data.deployed.commit)}
            </p>
          </div>
          <StatusPill tone={data.active ? "live" : upToDate ? "ok" : data.update_available ? "warn" : "neutral"}>
            {data.active ? "деплой" : upToDate ? "актуально" : data.update_available ? "есть обновление" : "нет данных"}
          </StatusPill>
        </div>
        {data.deployed.subject && (
          <p className="-mt-2 text-[12px] leading-snug text-[var(--text-dim)]">{data.deployed.subject}</p>
        )}
        <div className="grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-3">
          <div>
            <p className="label-meta text-[10px] text-[var(--text-dim)]">Обновлено</p>
            <p className="mono text-[12px]">{when(data.deployed.deployed_at)}</p>
          </div>
          <div>
            <p className="label-meta text-[10px] text-[var(--text-dim)]">GitHub main</p>
            <p className="mono text-[12px]">
              {short(data.latest?.commit)}
              {data.ahead_by ? <span className="text-[var(--warn)]"> · +{data.ahead_by}</span> : null}
            </p>
          </div>
        </div>

        {data.pending.length > 0 && (
          <div className="space-y-1.5">
            <p className="eyebrow">Что приедет</p>
            <ul className="space-y-1">
              {data.pending.map((c) => (
                <li key={c.sha} className="flex gap-2 text-[12px] leading-snug">
                  <span className="mono shrink-0 text-[var(--accent)]">{c.sha}</span>
                  <span className="min-w-0 text-[var(--text)]">{c.subject}</span>
                </li>
              ))}
            </ul>
            {data.ahead_by != null && data.ahead_by > data.pending.length && (
              <p className="text-[11px] text-[var(--text-dim)]">…и ещё {data.ahead_by - data.pending.length}</p>
            )}
          </div>
        )}

        {data.github_error && (
          <p className="text-[11px] leading-snug text-[var(--warn)]">
            {data.github_error}. Показана версия последней проверки сервера.
          </p>
        )}

        <button type="button" className="ui-btn primary block" disabled={busy || !data.runner_installed} onClick={() => setAsk(true)}>
          {data.active
            ? "Деплой идёт…"
            : request.isPending
              ? "Ставлю в очередь…"
              : force
                ? "Полный деплой теста"
                : "Обновить тест"}
        </button>
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-[11px] text-[var(--text-dim)]">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} disabled={busy} />
            Полный (всё заново)
          </label>
          <button
            type="button"
            className="ui-btn ghost sm"
            disabled={check.isPending}
            onClick={() => check.mutate()}
          >
            {check.isPending ? "Проверяю…" : "Проверить GitHub"}
          </button>
        </div>
        <button type="button" disabled className="ui-btn secondary block">
          Прод — скоро
        </button>
        {msg && <p className="text-[12px] text-[var(--danger)]">{msg}</p>}
      </div>

      {shownId && <JobCard id={shownId} onClose={activeId ? undefined : () => setOpenId(null)} />}

      <Sheet open={ask} onClose={() => setAsk(false)} title={force ? "Полный деплой теста" : "Обновить тестовый сервер"}>
        <p className="text-[14px] leading-snug text-[var(--text-2)]">{askText}</p>
        {data.latest && (
          <p className="mono mt-3 text-[12px] text-[var(--text-3)]">
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

      <div className="space-y-2">
        <p className="eyebrow">История</p>
        {jobs.isLoading && <LoadingPanel label="Загрузка истории…" />}
        {jobs.data && jobs.data.length === 0 && (
          <EmptyPanel title="Деплоев ещё не было" body="Первый запуск появится здесь." />
        )}
        {jobs.data && jobs.data.length > 0 && (
          <ul className="ui-cut divide-y divide-[var(--line)] overflow-hidden p-0">
            {jobs.data.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(j.id)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition ${
                    shownId === j.id ? "bg-[var(--accent-soft)]" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <p className="mono truncate text-[12px]">
                      {short(j.to_commit)} <span className="text-[var(--text-dim)]">{j.to_subject ?? ""}</span>
                    </p>
                    <p className="text-[10px] text-[var(--text-dim)]">
                      {when(j.requested_at)} · {j.requested_by_name ?? j.requested_by ?? "—"}
                      {duration(j) ? ` · ${duration(j)}` : ""}
                    </p>
                  </div>
                  <StatusPill tone={tone(j.status)}>{STATUS_RU[j.status] ?? j.status}</StatusPill>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {data.can_manage_deployers && <DeployersCard />}
    </div>
  );
}
