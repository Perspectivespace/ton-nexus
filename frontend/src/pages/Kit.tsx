import { useState } from "react";
import { ICONS, IconBolt, IconCopy, IconGift, IconOut, IconReactor, IconWallet, type IconName } from "@/components/icons";
import {
  Bar,
  Button,
  Chip,
  EmptyState,
  ErrorState,
  HoldButton,
  List,
  ListRow,
  Num,
  Panel,
  Scrim,
  ScreenHeader,
  SectionLabel,
  Sheet,
  SkeletonCard,
  StatTile,
  Tabs,
  Tag,
  ToastView,
  useToast,
} from "@/components/ui";

/** Витрина набора (только dev-сборка, маршрут /kit) — docs/DESIGN.md, п. 17, фаза 1 */
export default function Kit() {
  const toast = useToast();
  const [tab3, setTab3] = useState<"a" | "b" | "c">("a");
  const [tab5, setTab5] = useState<"1" | "2" | "3" | "4" | "5">("1");
  const [sheet, setSheet] = useState(false);
  const [held, setHeld] = useState(0);

  return (
    <div className="space-y-6">
      <ScreenHeader eyebrow="Фаза 1 · набор" title="Компоненты" />

      <section className="space-y-2.5">
        <SectionLabel>Панели</SectionLabel>
        <Panel level="hero" see cut="l" lift="l2" className="p-5">
          <p className="ui-label ui-shade">Окно в город · hero</p>
          <Num value="1.2847" unit="TON" size="xl" glow decode className="ui-shade mt-2 block" />
          <Scrim className="mt-4">
            <p className="ui-sec">Скрим под текстом: город виден по краям, цифры читаются.</p>
            <Bar value={0.62} className="mt-3" label="Пример" />
          </Scrim>
        </Panel>
        <div className="grid grid-cols-3 gap-2">
          <Panel level="e0" className="p-3"><span className="ui-label">e0</span></Panel>
          <Panel level="e1" className="p-3"><span className="ui-label">e1</span></Panel>
          <Panel level="e2" className="p-3"><span className="ui-label">e2</span></Panel>
        </div>
      </section>

      <section className="space-y-2.5">
        <SectionLabel>Кнопки</SectionLabel>
        <div className="ui-spill">
          <Button kind="primary" size="lg" block icon={<IconBolt size={20} />}>Запуск цикла</Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button kind="secondary" icon={<IconCopy size={18} />}>Копировать</Button>
          <Button kind="ghost">Отмена</Button>
          <Button kind="danger">Отклонить</Button>
          <Button kind="primary" disabled>Недоступно</Button>
        </div>
        <HoldButton kind="danger" block onConfirm={() => setHeld((n) => n + 1)}>
          Удерживать для вывода · {held}
        </HoldButton>
      </section>

      <section className="space-y-2.5">
        <SectionLabel>Метки, чипы, плитки</SectionLabel>
        <div className="flex flex-wrap gap-2">
          <Tag tone="ok">в сети</Tag>
          <Tag tone="neon">синхр.</Tag>
          <Tag tone="warn">ожидает</Tag>
          <Tag tone="danger">отклонено</Tag>
          <Tag tone="amber">готово</Tag>
          <Tag tone="neutral" dot={false}>ур. 3+</Tag>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip label="Фокус" value={2} />
          <Chip label="Запрет" value={1} icon={<IconGift size={14} />} />
        </div>
        <div className="grid grid-cols-5 gap-2">
          <StatTile label="Мощн." value={3} />
          <StatTile label="Ёмк." value={2} state="focus" />
          <StatTile label="Длит." value={2} />
          <StatTile label="Удача" value={1} state="blocked" />
          <StatTile label="Стаб." value={2} />
        </div>
      </section>

      <section className="space-y-2.5">
        <SectionLabel>Вкладки</SectionLabel>
        <Tabs items={[{ value: "a", label: "Колесо" }, { value: "b", label: "Отметка" }, { value: "c", label: "Промо" }]} value={tab3} onChange={setTab3} />
        <Tabs
          items={[
            { value: "1", label: "Обзор" },
            { value: "2", label: "Промокоды" },
            { value: "3", label: "Экономика" },
            { value: "4", label: "Деплой" },
            { value: "5", label: "Журнал" },
          ]}
          value={tab5}
          onChange={setTab5}
        />
      </section>

      <section className="space-y-2.5">
        <SectionLabel>Строки списка</SectionLabel>
        <List>
          <ListRow icon={<IconReactor size={20} />} title="Майнер" sub="Реактор" value={<span className="ui-sys">01</span>} to="/miner" />
          <ListRow icon={<IconWallet size={20} />} iconTone="amber" title="Баланс" sub="Касса" value="1.2847" onClick={() => {}} />
          <ListRow title={<span className="ui-num s-m">0.5000 TON</span>} trailing={<Tag tone="warn">ожидает</Tag>} />
        </List>
      </section>

      <section className="space-y-2.5">
        <SectionLabel>Тосты и лист</SectionLabel>
        <ToastView toast={{ kind: "ok", title: "Собрано 0.0042 TON", sub: "Цикл завершён" }} />
        <ToastView toast={{ kind: "danger", title: "Нет связи", sub: "Повторите позже" }} />
        <div className="grid grid-cols-2 gap-2">
          <Button kind="secondary" onClick={() => toast({ kind: "amber", title: "Награда начислена", sub: "+10 XP" })}>Тост</Button>
          <Button kind="secondary" icon={<IconOut size={18} />} onClick={() => setSheet(true)}>Нижний лист</Button>
        </div>
        <Sheet open={sheet} onClose={() => setSheet(false)} title="Вывод средств">
          <p className="ui-sec">Лист закрывается свайпом вниз, тапом по фону, Esc и кнопкой «Назад» Telegram.</p>
          <div className="mt-4"><Button kind="primary" block onClick={() => setSheet(false)}>Понятно</Button></div>
        </Sheet>
      </section>

      <section className="space-y-2.5">
        <SectionLabel>Состояния</SectionLabel>
        <SkeletonCard label="Синхронизация" />
        <EmptyState title="Пустой рынок" body="Активных заданий пока нет." />
        <ErrorState message="Сервер не ответил за 10 с." code="504" onRetry={() => {}} />
      </section>

      <section className="space-y-2.5">
        <SectionLabel>Иконки · 24</SectionLabel>
        <Panel className="grid grid-cols-6 gap-y-4 p-4">
          {(Object.keys(ICONS) as IconName[]).map((n) => {
            const I = ICONS[n];
            return (
              <div key={n} className="grid justify-items-center gap-1.5 text-[var(--text)]">
                <I size={24} />
                <span className="ui-sys !text-[9px]">{n}</span>
              </div>
            );
          })}
        </Panel>
      </section>
    </div>
  );
}
