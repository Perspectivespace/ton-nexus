import type { ReactNode } from "react";
import { useMe, usePendingSubmissions, usePendingTaskApprovals, usePendingWithdrawals } from "@/api/hooks";
import { IconCheck, IconGear, IconOut, IconRefresh, IconSpark } from "@/components/icons";
import { List, ListRow, SectionLabel, StatusPill } from "@/components/ui";

/** Счётчик «ждёт решения» справа в строке — только когда есть что разбирать. */
function Count({ n }: { n: number }) {
  return n > 0 ? <StatusPill tone="warn">{n}</StatusPill> : null;
}

/**
 * «Работа» — единственный вход в инструменты команды на «Контуре» (DESIGN.md §14.1).
 * Строки показываются по роли; доступ всё равно проверяет сервер, здесь только видимость.
 * Сначала очереди со счётчиками, потом создание, потом кабинет и деплой.
 */
export function WorkArea() {
  const { data: me } = useMe();
  const moderator = !!(me?.is_owner || me?.is_admin || me?.is_ambassador);
  const staff = !!(me?.is_owner || me?.is_admin);
  const subs = usePendingSubmissions(moderator);
  const approvals = usePendingTaskApprovals(staff);
  const withdraws = usePendingWithdrawals(staff);

  if (!me || !(moderator || me.is_owner || me.can_deploy)) return null;

  const nMod = (subs.data?.length ?? 0) + (staff ? approvals.data?.length ?? 0 : 0);
  const nCash = staff ? withdraws.data?.length ?? 0 : 0;
  const total = nMod + nCash;

  const rows: ReactNode[] = [];
  if (moderator) {
    rows.push(
      <ListRow
        key="inbox"
        to="/inbox"
        icon={<IconCheck size={20} />}
        title="Модерация"
        sub={staff ? "Сдачи и публикации заданий" : "Сдачи по вашим заданиям"}
        trailing={<Count n={nMod} />}
      />,
    );
  }
  if (staff) {
    rows.push(
      <ListRow
        key="cash"
        to="/withdraws"
        icon={<IconOut size={20} />}
        title="Касса"
        sub="Заявки на вывод TON"
        trailing={<Count n={nCash} />}
      />,
    );
  }
  if (moderator) {
    rows.push(
      <ListRow
        key="new"
        to="/tasks/new"
        icon={<IconSpark size={20} />}
        title="Новое задание"
        sub={staff ? "Сразу в ленту или черновиком" : "Уйдёт на одобрение админу"}
      />,
    );
  }
  if (me.is_owner) {
    rows.push(
      <ListRow
        key="owner"
        to="/owner"
        icon={<IconGear size={20} />}
        title="Кабинет владельца"
        sub="Обзор · промо · экономика"
      />,
    );
  }
  if (me.can_deploy) {
    rows.push(
      <ListRow key="deploy" to="/deploy" icon={<IconRefresh size={20} />} title="Деплой" sub="Тест и прод" />,
    );
  }

  return (
    <div className="space-y-2.5 pt-3">
      <SectionLabel action={total > 0 ? <StatusPill tone="warn">{total} ждут</StatusPill> : undefined}>
        Работа
      </SectionLabel>
      <List>{rows}</List>
    </div>
  );
}
