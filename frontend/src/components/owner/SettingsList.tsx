import { useMemo, useState } from "react";
import { useEconomyUpdate, type EconomySetting } from "@/api/hooks";
import { SettingEditor } from "@/components/SettingEditor";
import { SETTINGS, summarize } from "@/lib/settingsMeta";
import { Button, List, ListRow, SectionLabel, Sheet, useToast } from "@/components/ui";

const GROUP_RU: Record<string, string> = {
  miner: "Майнер",
  miner_upgrade: "Усиление",
  tasks: "Задания",
  withdraw: "Вывод",
  growth: "Рост",
  daily: "Ежедневная награда",
  progression: "Уровни",
  roulette: "Колесо удачи",
  tower: "Башня",
  ratings: "Рейтинги",
  custom: "Прочее",
};
const GROUP_ORDER = ["miner", "miner_upgrade", "roulette", "tower", "ratings", "daily", "tasks", "withdraw", "growth", "progression", "custom"];

const titleOf = (s: EconomySetting) => SETTINGS[s.key]?.title || s.label || "Настройка";

/**
 * Настройки экономики: группы подписями на подложке, в группе — строки «название · текущее значение».
 * Тап открывает шторку: что настройка меняет в игре, поля значений и закреплённая кнопка «Сохранить».
 */
export function SettingsList({ items, onSaved }: { items: EconomySetting[]; onSaved: () => void }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const groups = useMemo(() => {
    const map = new Map<string, EconomySetting[]>();
    for (const s of items) {
      const g = GROUP_RU[s.group || ""] ? s.group! : "custom";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => [g, map.get(g)!] as const);
  }, [items]);
  const open = items.find((s) => s.key === openKey) || null;

  return (
    <div className="space-y-5">
      {groups.map(([g, list]) => (
        <section key={g} className="space-y-2">
          <SectionLabel>{GROUP_RU[g]}</SectionLabel>
          <List>
            {list.map((s) => (
              <ListRow
                key={s.key}
                title={titleOf(s)}
                sub={<span className="ui-num s-s text-[var(--text-2)]">{summarize(s.key, s.value)}</span>}
                onClick={() => setOpenKey(s.key)}
              />
            ))}
          </List>
        </section>
      ))}
      <SettingSheet item={open} onClose={() => setOpenKey(null)} onSaved={onSaved} />
    </div>
  );
}

function SettingSheet({ item, onClose, onSaved }: { item: EconomySetting | null; onClose: () => void; onSaved: () => void }) {
  // держим последнюю настройку, пока шторка уезжает
  const [last, setLast] = useState<EconomySetting | null>(item);
  if (item && item !== last) setLast(item);
  const shown = item || last;
  const update = useEconomyUpdate();
  const toast = useToast();
  const formId = "setting-form";

  async function save(value: unknown) {
    if (!shown) return;
    try {
      await update.mutateAsync({ key: shown.key, value });
    } catch (e) {
      // ошибку сервера показывает тост; шторка остаётся открытой с введёнными значениями
      toast({ kind: "danger", title: "Настройка не сохранена", sub: e instanceof Error ? e.message : "Ошибка" });
      return;
    }
    onSaved();
    onClose();
    toast({ kind: "ok", title: "Настройка сохранена", sub: titleOf(shown) });
  }

  const meta = shown ? SETTINGS[shown.key] : undefined;
  const about = meta?.about || shown?.description;
  return (
    <Sheet
      open={!!item}
      onClose={onClose}
      title={shown ? titleOf(shown) : undefined}
      footer={
        <div className="flex gap-2">
          <Button kind="primary" type="submit" form={formId} className="flex-1" disabled={update.isPending}>
            {update.isPending ? "Сохранение…" : "Сохранить"}
          </Button>
          <Button kind="secondary" onClick={onClose}>
            Отмена
          </Button>
        </div>
      }
    >
      {shown && (
        <div className="space-y-5">
          {about && (
            <div className="ow-about">
              <p className="ui-label">Что меняет в игре</p>
              <p className="ui-sec">{about}</p>
            </div>
          )}
          {/* key — чтобы черновик сбрасывался при открытии другой настройки */}
          <SettingEditor key={shown.key} settingKey={shown.key} value={shown.value} formId={formId} onSave={save} />
        </div>
      )}
    </Sheet>
  );
}
