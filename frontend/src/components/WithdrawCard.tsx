import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  useCheckPayout,
  useReviewWithdraw,
  useVerifyPayoutHash,
  type PayoutConfig,
  type WithdrawOut,
} from "@/api/hooks";
import { Button, Field, HoldButton, Readout, Sheet, StatusPill, useToast } from "@/components/ui";

const PayoutButton = lazy(() => import("./PayoutButton"));

/** через сколько после подписи перевода Касса сама спрашивает сервер (блок обычно уже в сети) */
export const CHECK_DELAY_MS = 20_000;

function when(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** «1.500000000» → «1.5» */
export function tonAmount(a: string) {
  return a.includes(".") ? a.replace(/0+$/, "").replace(/\.$/, "") : a;
}

export function whoLabel(item: WithdrawOut) {
  const name = item.first_name?.trim();
  const at = item.username ? `@${item.username}` : null;
  const tg = item.user_telegram_id ? `tg ${item.user_telegram_id}` : `#${item.user_id}`;
  return [name, at, tg].filter(Boolean).join(" · ");
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "Ошибка");

/**
 * Заявка на вывод в Кассе: кому, сколько, куда (копировать), «Выплатить» через TON Connect с кошелька выплат,
 * «Проверить» перевод в сети, запасной путь по хешу, отказ с возвратом и — только владельцу — отметка без проверки.
 */
export function WithdrawCard({
  item,
  config,
  isOwner,
  onDone,
}: {
  item: WithdrawOut;
  /** undefined — настройка ещё грузится */
  config: PayoutConfig | undefined;
  isOwner: boolean;
  onDone: () => void;
}) {
  const toast = useToast();
  const review = useReviewWithdraw();
  const check = useCheckPayout();
  const verify = useVerifyPayoutHash();
  const [copied, setCopied] = useState(false);
  const [more, setMore] = useState(false);
  const [hash, setHash] = useState("");
  const [note, setNote] = useState("");
  const [askMark, setAskMark] = useState(false);
  const [markNote, setMarkNote] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const sending = item.status === "sending";
  const ready = !!config?.enabled && !!config.payout_wallet_raw;
  const busy = review.isPending || check.isPending || verify.isPending;

  async function copyWallet() {
    try {
      await navigator.clipboard.writeText(item.wallet_address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* буфер недоступен */
    }
  }

  async function runCheck(silent = false) {
    setMsg(null);
    try {
      const w = await check.mutateAsync(item.id);
      if (w.status === "paid") {
        toast({ kind: "ok", title: "Выплата подтверждена", sub: `#${item.id}` });
        onDone();
      } else if (!silent) {
        setMsg({ tone: "danger", text: "Перевод в сети пока не найден. Если он подписан, подождите минуту и проверьте ещё раз." });
      }
    } catch (e) {
      if (!silent) setMsg({ tone: "danger", text: errText(e) });
    }
  }

  async function submitHash() {
    setMsg(null);
    try {
      await verify.mutateAsync({ id: item.id, txHash: hash.trim() });
      toast({ kind: "ok", title: "Выплата подтверждена по хешу", sub: `#${item.id}` });
      setHash("");
      onDone();
    } catch (e) {
      setMsg({ tone: "danger", text: errText(e) });
    }
  }

  async function reject() {
    setMsg(null);
    try {
      await review.mutateAsync({ id: item.id, approve: false, note: note.trim() || null });
      toast({ kind: "info", title: "Вывод отклонён, TON вернулся пользователю", sub: `#${item.id}` });
      onDone();
    } catch (e) {
      setMsg({ tone: "danger", text: errText(e) });
      onDone(); // проверка сети перед отказом могла закрыть заявку
    }
  }

  async function markUnverified() {
    setAskMark(false);
    setMsg(null);
    try {
      await review.mutateAsync({ id: item.id, approve: true, unverified: true, note: markNote.trim() });
      toast({ kind: "ok", title: "Отмечено выплаченным без проверки", sub: `#${item.id}` });
      setMarkNote("");
      onDone();
    } catch (e) {
      setMsg({ tone: "danger", text: errText(e) });
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="ui-cut space-y-4 p-4"
      data-testid={`withdraw-${item.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-medium text-[var(--text)]">{whoLabel(item)}</p>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--text-dim)]">
            заявка #{item.id} · {when(item.created_at)}
          </p>
        </div>
        <StatusPill tone={sending ? "live" : "warn"}>{sending ? "отправляется" : "в холде"}</StatusPill>
      </div>

      <Readout label="К выплате" value={tonAmount(item.amount)} unit="TON" />

      <div>
        <p className="ui-label">Куда</p>
        <button
          type="button"
          onClick={copyWallet}
          className="mono mt-1 w-full break-all rounded-xl border border-[var(--line)] bg-[var(--surface-3)] px-3 py-2 text-left text-[12px] text-[var(--text)]"
        >
          {item.wallet_address}
          <span className="mt-1 block text-[10px] text-[var(--accent)]">{copied ? "скопировано" : "тап — копировать"}</span>
        </button>
      </div>

      {sending ? (
        <p className="text-[13px] leading-snug text-[var(--text-2)]">
          Перевод выдан {when(item.payout_started_at)}. Сервер сам ищет его в сети; «Проверить» — спросить сразу.
        </p>
      ) : null}

      <div className="grid gap-2">
        {config === undefined ? (
          <Button block size="lg" disabled>
            Загрузка…
          </Button>
        ) : ready ? (
          <Suspense
            fallback={
              <Button block size="lg" disabled>
                Загрузка…
              </Button>
            }
          >
            <PayoutButton
              id={item.id}
              config={config}
              sending={sending}
              disabled={busy}
              onChanged={onDone}
              onSent={() => {
                onDone();
                window.clearTimeout(timer.current);
                timer.current = window.setTimeout(() => runCheck(true), CHECK_DELAY_MS);
              }}
            />
          </Suspense>
        ) : (
          <p role="note" className="border border-[var(--amber)] bg-[var(--amber-soft)] p-3 text-[13px] leading-snug text-[var(--amber)]">
            Выплаты TON выключены. Владелец: Настройки → «Выплаты TON» — укажите кошелёк выплат и включите.
          </p>
        )}
        <Button kind="secondary" block disabled={busy} onClick={() => runCheck()}>
          {check.isPending ? "Проверяем сеть…" : "Проверить"}
        </Button>
        <Button kind="ghost" size="sm" aria-expanded={more} onClick={() => setMore((v) => !v)}>
          {more ? "Скрыть" : "Хеш, отказ и другое"}
        </Button>
      </div>

      {msg ? (
        <p role="alert" className={`text-[13px] leading-snug ${msg.tone === "ok" ? "text-[var(--ok)]" : "text-[var(--magenta)]"}`}>
          {msg.text}
        </p>
      ) : null}

      {more ? (
        <div className="space-y-4 border-t border-[var(--line)] pt-4">
          <div className="grid gap-2">
            <Field label="Хеш перевода" hint="Hex, base64 или ссылка tonviewer — сервер проверит адрес и сумму">
              <input
                className="ui-input"
                value={hash}
                onChange={(e) => setHash(e.target.value)}
                placeholder="хеш или ссылка"
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
            </Field>
            <Button kind="secondary" block disabled={busy || !hash.trim()} onClick={submitHash}>
              {verify.isPending ? "Проверяем…" : "Подтвердить по хешу"}
            </Button>
          </div>

          <div className="grid gap-2">
            <Field label="Причина отказа">
              <input
                className="ui-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="увидит только команда"
                maxLength={500}
                disabled={busy}
              />
            </Field>
            <Button kind="danger" block disabled={busy} onClick={reject}>
              Отклонить · возврат
            </Button>
          </div>

          {isOwner ? (
            <Button kind="ghost" block disabled={busy} onClick={() => setAskMark(true)}>
              Отметить без проверки…
            </Button>
          ) : null}
        </div>
      ) : null}

      <Sheet open={askMark} onClose={() => setAskMark(false)} title="Отметить без проверки?">
        <p className="ui-sec text-[15px]">
          Заявка #{item.id} закроется как выплаченная без доказательства в сети. Только если вы перевели {tonAmount(item.amount)} TON
          другим способом.
        </p>
        <Field label="Заметка" hint="Обязательно: как и когда выплачено" className="mt-4">
          <input
            className="ui-input"
            value={markNote}
            onChange={(e) => setMarkNote(e.target.value)}
            placeholder="например: вручную из Tonkeeper 2 ноября"
            maxLength={480}
          />
        </Field>
        <div className="mt-5 grid gap-2">
          <HoldButton block disabled={busy || !markNote.trim()} onConfirm={markUnverified}>
            Удерживайте — выплачено
          </HoldButton>
          <Button kind="ghost" block onClick={() => setAskMark(false)}>
            Отмена
          </Button>
        </div>
      </Sheet>
    </motion.div>
  );
}
