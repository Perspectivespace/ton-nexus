import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import {
  useMe,
  useEconomySettings,
  useEconomyUpdate,
  type EconomySetting,
} from "@/api/hooks";
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

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function SettingRow({
  item,
  onSaved,
}: {
  item: EconomySetting;
  onSaved: () => void;
}) {
  const update = useEconomyUpdate();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(pretty(item.value));
  const [localError, setLocalError] = useState<string | null>(null);

  async function save() {
    setLocalError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setLocalError("Невалидный JSON");
      return;
    }
    try {
      await update.mutateAsync({ key: item.key, value: parsed });
      onSaved();
      setOpen(false);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Ошибка сохранения");
    }
  }

  return (
    <div className="panel overflow-hidden">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 p-4 text-left"
        onClick={() => {
          setOpen((v) => !v);
          setDraft(pretty(item.value));
          setLocalError(null);
        }}
      >
        <div className="min-w-0">
          <p className="text-[13px] font-medium leading-snug">{item.label || item.key}</p>
          <p className="mt-0.5 font-mono text-[10px] text-[var(--text-dim)]">{item.key}</p>
          {item.description && (
            <p className="mt-1 line-clamp-2 text-[11px] text-[var(--text-dim)]">{item.description}</p>
          )}
        </div>
        <StatusPill tone={open ? "live" : "neutral"}>{open ? "edit" : "view"}</StatusPill>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-[var(--line)]"
          >
            <div className="space-y-3 p-4">
              <textarea
                className="input-field mono min-h-[140px] resize-y text-[12px] leading-relaxed"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
              />
              {localError && <p className="text-[12px] text-[var(--danger)]">{localError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary flex-1"
                  disabled={update.isPending}
                  onClick={save}
                >
                  {update.isPending ? "Запись…" : "Применить"}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setDraft(pretty(item.value));
                    setLocalError(null);
                  }}
                >
                  Сброс
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-[var(--text-dim)]">
                Меняется сразу в БД. Новые сессии и броски читают актуальные значения.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Owner() {
  const { data: me, isLoading: meLoading } = useMe();
  const { data, isLoading, error, refetch, isFetching } = useEconomySettings();
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

  if (meLoading || isLoading) {
    return <LoadingPanel label="Открытие рубильника экономики…" />;
  }

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

  if (error) return <ErrorPanel message="Не удалось загрузить economy settings" />;

  if (!data?.length) {
    return (
      <EmptyPanel
        title="Пустой рубильник"
        body="Нет ключей economy_settings. Запусти seed на backend."
      />
    );
  }

  const visible =
    filter === "all" ? data : data.filter((s) => (s.group || "custom") === filter);

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Owner"
        title="Экономика"
        action={
          <StatusPill tone={isFetching ? "live" : "ok"}>
            {isFetching ? "sync" : `${data.length} keys`}
          </StatusPill>
        }
      />

      <div className="panel panel-glow p-4">
        <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
          Рубильник: ставки майнера, шансы усиления, веса рулетки, daily, комиссия заданий,
          мин. вывод. Без деплоя.
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
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
        {visible.map((item) => (
          <li key={item.key}>
            <SettingRow item={item} onSaved={() => refetch()} />
          </li>
        ))}
      </ul>

      <Link to="/" className="btn-ghost inline-flex text-[13px] no-underline">
        ← Контур
      </Link>
    </div>
  );
}
