import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDailyClaim, useDailyStatus, type DailyClaim, type DailyStatus } from "@/api/hooks";
import { useToast } from "@/components/ui";
import { nextMskMidnight, useCountdown, formatLeft } from "@/lib/countdown";

/**
 * Состояние ежедневной отметки для всех кнопок «Ежедневная отметка».
 * Правило сервера — игровой день по Москве: после отметки следующая доступна с 00:00 МСК (`next_claim_at`).
 * Кнопка активна только когда можно забрать; иначе — отсчёт «Следующая награда через 23:41:05».
 * По окончании отсчёта статус перечитывается, кнопка оживает без перезагрузки.
 */
export function useDaily() {
  const qc = useQueryClient();
  const st = useDailyStatus();
  const claim = useDailyClaim();
  const d = st.data;

  const offset = useMemo(() => {
    const srv = d?.server_time ? Date.parse(d.server_time) : NaN;
    return Number.isFinite(srv) ? srv - Date.now() : 0;
  }, [d?.server_time]);

  const target = useMemo(() => {
    if (!d?.claimed_today) return null;
    const t = d.next_claim_at ? Date.parse(d.next_claim_at) : NaN;
    return Number.isFinite(t) ? t : nextMskMidnight(Date.now() + offset);
  }, [d?.claimed_today, d?.next_claim_at, offset]);

  const toast = useToast();
  const left = useCountdown(target, offset, () => qc.invalidateQueries({ queryKey: ["daily"] }));
  const waiting = target != null && (left ?? 0) > 0;
  const ready = !!d && !waiting && !claim.isPending;

  /** Сразу после отметки кладём ответ в кэш — кнопка гаснет без лишнего запроса. */
  function remember(r: DailyClaim) {
    qc.setQueryData<DailyStatus>(["daily"], {
      claimed_today: true,
      streak: r.streak,
      check_date: r.check_date,
      next_claim_at: r.next_claim_at ?? null,
      server_time: new Date(Date.now() + offset).toISOString(),
    });
  }

  /** Нажатие: забрать отметку, показать награду. Повтор (например, уже отмечено с другого устройства) — спокойный тост. */
  function claimNow() {
    if (!ready) return;
    claim.mutate(undefined, {
      onSuccess: (r) => {
        remember(r);
        if (r.already_claimed) {
          toast({ kind: "info", title: "Сегодня уже отмечено", sub: `серия ${r.streak} дн` });
          return;
        }
        toast({
          kind: "ok",
          title: "Отметка засчитана",
          sub: [
            `+${Number(r.reward_ton).toFixed(4)} TON`,
            r.reward_xp > 0 && `+${r.reward_xp} XP`,
            r.reward_focus > 0 && `Фокус +${r.reward_focus}`,
            `серия ${r.streak} дн`,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      },
      onError: (e) => toast({ kind: "danger", title: "Отметка не прошла", sub: e.message }),
    });
  }

  return {
    status: d,
    loading: st.isLoading,
    claimNow,
    pending: claim.isPending,
    /** можно нажать прямо сейчас */
    ready,
    waiting,
    countdown: waiting ? formatLeft(left ?? 0) : null,
  };
}
