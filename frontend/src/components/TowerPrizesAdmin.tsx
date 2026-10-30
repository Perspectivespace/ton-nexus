import { useState } from "react";
import { useTowerPrizeAction, useTowerPrizesAdmin, type TowerPrizeAction } from "@/api/hooks";
import type { TowerPrizeMonth, TowerPrizeResult } from "@/api/types";
import { Button, EmptyState, ErrorState, HoldButton, Panel, SectionLabel, Sheet, SkeletonCard, Tag, useToast, type Tone } from "@/components/ui";
import { parseTowerError } from "@/lib/tower/api";
import { monthTitle } from "@/lib/tower/month";
import "@/styles/tower-prizes.css";

/** «5.4545» → «5,4545 TON» */
const ton = (s: string) => `${s.replace(".", ",")} TON`;

const MONTH_TAG: Record<TowerPrizeMonth["status"], [Tone, string]> = {
  payout: ["amber", "Выплата"],
  settled: ["ok", "Выплачено"],
  no_prizes: ["neutral", "Без призов"],
};

const ROW_TAG: Record<TowerPrizeResult["status"], [Tone, string]> = {
  pending: ["amber", "ждёт"],
  paid: ["ok", "выплачено"],
  flagged: ["danger", "проверка"],
  voided: ["neutral", "аннулирован"],
};

/** почему месяц закрылся без призов */
export function reasonText(m: Pick<TowerPrizeMonth, "reason" | "participants" | "min_participants">): string {
  switch (m.reason) {
    case "few_participants":
      return `Участников ${m.participants} из ${m.min_participants ?? 10} нужных — призов нет`;
    case "disabled":
      return "Призы в этом месяце были выключены";
    case "no_budget":
      return "Фонда не хватило на минимальный приз";
    case "no_players":
      return "В месяце никто не набрал очков";
    default:
      return "Призов нет";
  }
}

/** пояснение к строке: почему на проверке, почему аннулирован */
export function noteText(r: Pick<TowerPrizeResult, "status" | "note">): string | null {
  const n = r.note ?? "";
  if (r.status === "paid") return null;
  if (n === "banned") return "Игрок забанен до выплаты — приз сгорает";
  if (n === "owner") return "Аннулировал владелец";
  if (n.startsWith("approved")) return "Проверено владельцем вручную";
  if (r.status !== "flagged") return null;
  const why: Record<string, string> = {
    replay_mismatch: "Повтор забега не дал записанный счёт",
    no_game: "Лучший забег не найден",
    bad_game: "Забег не завершён",
    wrong_month: "Забег из другого месяца",
    no_taps: "Нет журнала нажатий",
  };
  return `${why[n] ?? `Проверка забега не прошла (${n || "?"})`} — выплата после вашей проверки`;
}

const ERR: Record<string, string> = {
  flagged: "Сначала проверьте забег: «Одобрить» или «Аннулировать»",
  over_budget: "Выплата вышла бы за фонд месяца",
  not_payable: "Этот приз уже не к выплате",
  not_voidable: "Выплаченный приз не аннулируется",
  month_open: "Месяц ещё идёт",
  owner_only: "Только для владельца",
};

type Ask = { title: string; text: string; sub?: string; label: string; kind: "primary" | "danger"; action: TowerPrizeAction; ok: string };

/**
 * «Призы Башни» в Кассе (только владелец): закрыть прошедший месяц, выплатить по строке или всем,
 * одобрить строку после проверки, аннулировать. Каждое действие — удержанием в шторке.
 */
export function TowerPrizesAdmin() {
  const q = useTowerPrizesAdmin(true);
  const act = useTowerPrizeAction();
  const toast = useToast();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [open, setOpen] = useState<Record<number, boolean>>({});

  async function run(a: Ask) {
    setAsk(null);
    try {
      const r = await act.mutateAsync(a.action);
      const d = r.done ?? {};
      const sub =
        a.action.kind === "pay-all"
          ? [`выплачено ${d.paid ?? 0}`, d.voided ? `аннулировано (бан) ${d.voided}` : ""].filter(Boolean).join(" · ")
          : d.result === "voided"
            ? "игрок забанен — приз аннулирован"
            : d.result === "already"
              ? "уже было выплачено"
              : a.action.kind === "close" && d.closed === 0
                ? "уже был закрыт"
                : undefined;
      toast({ kind: d.result === "voided" ? "info" : "ok", title: a.ok, sub });
    } catch (e) {
      const err = parseTowerError(e);
      toast({ kind: "danger", title: "Не получилось", sub: ERR[err.code] ?? (err.message || err.code) });
    }
  }

  const busy = act.isPending;

  return (
    <section className="tp space-y-3" aria-label="Призы Башни">
      <SectionLabel>Призы Башни</SectionLabel>
      {q.isPending ? (
        <SkeletonCard lines={3} label="Загружаем призы" />
      ) : q.isError ? (
        <ErrorState message="Не удалось загрузить призы" onRetry={() => void q.refetch()} />
      ) : (
        <>
          {q.data.unclosed.map((m) => (
            <Panel key={m} level="e1" className="tp-close">
              <div className="min-w-0">
                <p className="ui-h">{monthTitle(m)} закончился</p>
                <p className="ui-sec">Итоги подведутся сами при первом заходе игрока — или закройте сейчас</p>
              </div>
              <Button
                kind="secondary"
                size="sm"
                disabled={busy}
                onClick={() =>
                  setAsk({
                    title: `Закрыть ${monthTitle(m).toLowerCase()}`,
                    text: "Места и призы зафиксируются по настройкам на эту минуту. Каждый призовой забег проверим повтором.",
                    label: "Закрыть месяц",
                    kind: "primary",
                    action: { kind: "close", month: m },
                    ok: "Месяц закрыт",
                  })
                }
              >
                Закрыть месяц
              </Button>
            </Panel>
          ))}

          {q.data.months.length === 0 && q.data.unclosed.length === 0 ? (
            <EmptyState title="Закрытых месяцев пока нет" body={"Итоги появятся здесь после 00:00\u00a0МСК 1\u2011го\u00a0числа"} />
          ) : null}

          {q.data.months.map((m, i) => {
            const [tone, word] = MONTH_TAG[m.status];
            const expanded = open[m.id] ?? (i === 0 || m.status === "payout");
            return (
              <Panel key={m.id} level={i === 0 ? "hero" : "e1"} cut="m" className="tp-month">
                <div className="tp-head">
                  <div className="min-w-0">
                    <p className="ui-h">{monthTitle(m.month)}</p>
                    <p className="ui-sec">
                      {m.participants} участн. · закрыт {m.closed_auto ? "автоматически" : "вручную"}
                    </p>
                  </div>
                  <Tag tone={tone}>{word}</Tag>
                </div>

                {m.status === "no_prizes" ? (
                  <p className="tp-reason">{reasonText(m)}</p>
                ) : (
                  <>
                    <dl className="tp-sums">
                      <div>
                        <dt>Фонд</dt>
                        <dd>{ton(m.budget_ton)}</dd>
                      </div>
                      <div>
                        <dt>Выплачено</dt>
                        <dd className="ok">{ton(m.paid_ton)}</dd>
                      </div>
                      <div>
                        <dt>Ждёт</dt>
                        <dd className={Number(m.pending_ton) > 0 ? "warn" : ""}>{ton(m.pending_ton)}</dd>
                      </div>
                    </dl>
                    <Bar paid={m.paid_ton} planned={m.planned_ton} budget={m.budget_ton} />

                    {expanded ? (
                      <ol className="tp-rows" aria-label={`Призы, ${monthTitle(m.month)}`}>
                        {m.results.map((r) => (
                          <Row key={r.id} r={r} busy={busy} onAsk={setAsk} />
                        ))}
                      </ol>
                    ) : (
                      <Button kind="ghost" size="sm" onClick={() => setOpen({ ...open, [m.id]: true })}>
                        Показать места ({m.results.length})
                      </Button>
                    )}

                    {m.counts.pending > 0 ? (
                      <Button
                        kind="primary"
                        block
                        disabled={busy}
                        onClick={() =>
                          setAsk({
                            title: "Выплатить всем",
                            text: `${m.counts.pending} ${m.counts.pending === 1 ? "приз" : "призов"} на баланс игроков, по одному начислению на строку. Забаненным приз сгорит.`,
                            sub: m.counts.flagged ? `${m.counts.flagged} на проверке — их не трогаем` : undefined,
                            label: "Выплатить всем",
                            kind: "primary",
                            action: { kind: "pay-all", monthId: m.id },
                            ok: "Призы выплачены",
                          })
                        }
                      >
                        Выплатить всем · {m.counts.pending}
                      </Button>
                    ) : null}
                  </>
                )}
              </Panel>
            );
          })}
        </>
      )}

      <Sheet open={!!ask} onClose={() => setAsk(null)} title={ask?.title}>
        {ask ? (
          <div className="space-y-4">
            <p className="ui-sec text-[15px]">{ask.text}</p>
            {ask.sub ? <p className="ui-sec">{ask.sub}</p> : null}
            <HoldButton block kind={ask.kind} disabled={busy} onConfirm={() => void run(ask)}>
              Удерживайте — {ask.label.toLowerCase()}
            </HoldButton>
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}

/** полоса фонда: выплачено / запланировано / весь фонд (scaleX, без анимаций) */
function Bar({ paid, planned, budget }: { paid: string; planned: string; budget: string }) {
  const b = Number(budget) || 1;
  const k = (v: string) => Math.max(0, Math.min(1, Number(v) / b));
  return (
    <div className="tp-bar" aria-hidden="true">
      <span className="plan" style={{ transform: `scaleX(${k(planned)})` }} />
      <span className="paid" style={{ transform: `scaleX(${k(paid)})` }} />
    </div>
  );
}

function Row({ r, busy, onAsk }: { r: TowerPrizeResult; busy: boolean; onAsk: (a: Ask) => void }) {
  const [tone, word] = ROW_TAG[r.status];
  const note = noteText(r);
  const who = `${r.place}-е место · ${r.name}`;
  const open = r.status === "pending" || r.status === "flagged";
  return (
    <li className={`tp-row ${r.status}`}>
      <div className="tp-line">
        <span className="tp-place">{r.place}</span>
        <span className="tp-name">
          {r.name}
          <span className="tp-meta">
            {r.username ? `@${r.username} · ` : ""}
            {r.score.toLocaleString("ru-RU")} очк.{r.booster ? " · с бустером" : ""}
            {r.status === "paid" && r.paid_at ? ` · ${new Date(r.paid_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}` : ""}
          </span>
        </span>
        <span className="tp-side">
          <span className="tp-amt">{ton(r.amount_ton)}</span>
          <Tag tone={tone}>{word}</Tag>
          {r.banned && r.status !== "voided" ? <Tag tone="danger">бан</Tag> : null}
        </span>
      </div>
      {note ? <p className="tp-note">{note}</p> : null}
      {open ? (
        <div className="tp-actions">
          {r.status === "flagged" ? (
            <Button
              kind="secondary"
              size="sm"
              disabled={busy}
              onClick={() =>
                onAsk({
                  title: "Одобрить приз",
                  text: `${who}: вы проверили забег, приз можно платить. Деньги сейчас не уходят.`,
                  label: "Одобрить",
                  kind: "primary",
                  action: { kind: "approve", id: r.id },
                  ok: "Приз одобрен",
                })
              }
            >
              Одобрить
            </Button>
          ) : null}
          {r.status === "pending" ? (
            <Button
              kind="secondary"
              size="sm"
              disabled={busy}
              onClick={() =>
                onAsk({
                  title: "Выплатить приз",
                  text: `${who}: ${ton(r.amount_ton)} на баланс игрока.`,
                  label: "Выплатить",
                  kind: "primary",
                  action: { kind: "pay", id: r.id },
                  ok: "Приз выплачен",
                })
              }
            >
              Выплатить
            </Button>
          ) : null}
          {r.status === "pending" || r.status === "flagged" ? (
            <Button
              kind="ghost"
              size="sm"
              className="tp-void"
              disabled={busy}
              onClick={() =>
                onAsk({
                  title: "Аннулировать приз",
                  text: `${who}: приз не выплачивается. Места не сдвигаются, ${ton(r.amount_ton)} остаются в фонде.`,
                  label: "Аннулировать",
                  kind: "danger",
                  action: { kind: "void", id: r.id },
                  ok: "Приз аннулирован",
                })
              }
            >
              Аннулировать
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
