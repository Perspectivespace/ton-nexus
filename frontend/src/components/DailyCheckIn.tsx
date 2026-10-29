import { useDaily } from "@/lib/useDaily";
import { IconBolt, IconCheck, IconChevron } from "@/components/icons";
import { Button } from "@/components/ui";

/**
 * Ежедневная отметка — большая неоновая кнопка с подсветкой снизу.
 * Временно живёт вверху «Заработка» (до PR «б», где у раздела появится своя сводка), раньше стояла на «Контуре».
 */
export function DailyCheckIn({ className = "" }: { className?: string }) {
  const daily = useDaily();
  return (
    <div className={`ui-spill ${className}`.trim()}>
      <Button
        kind="primary"
        size="lg"
        block
        className="!h-[60px] !justify-between !px-4 text-left"
        disabled={!daily.ready}
        aria-label={daily.countdown ? `Отметка получена. Следующая награда через ${daily.countdown}` : undefined}
        onClick={daily.claimNow}
      >
        <span className="flex items-center gap-3">
          {daily.waiting ? <IconCheck size={22} /> : <IconBolt size={22} />}
          <span>
            <span className="block text-[15px] leading-[20px]">
              {daily.pending ? "Начисление…" : daily.waiting ? "Отметка получена" : "Ежедневная отметка"}
            </span>
            <span className="block text-[11px] leading-[16px] tracking-[0.14em] opacity-80">
              {daily.countdown ? (
                <>
                  Следующая награда через <span className="ui-num">{daily.countdown}</span>
                </>
              ) : (
                "Серия · награда · XP"
              )}
            </span>
          </span>
        </span>
        {!daily.waiting && <IconChevron size={20} />}
      </Button>
    </div>
  );
}
