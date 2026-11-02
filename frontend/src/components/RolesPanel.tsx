import { useEffect, useState, type ReactNode } from "react";
import { useRolesStaff, useSetRole, useUserSearch } from "@/api/hooks";
import type { StaffOut, StaffRow, UserSearchRow } from "@/api/types";
import { Button, Field, HoldButton, Panel, SectionLabel, Sheet, StatusPill, Tag, useToast } from "@/components/ui";

/**
 * «Роли» (Управление → Роли): владелец назначает и снимает админов, деплойер — владельцев.
 * Устроено как «Деплойеры» на экране «Деплой»: список, плашка «из настроек сервера», снятие через шторку с удержанием.
 * Что можно — решает сервер (can_manage_*); здесь только видимость кнопок.
 */

export type Role = "admin" | "owner";
export type RoleChange = { role: Role; grant: boolean; telegram_id: number; name: string };

export const ROLE_ERR_RU: Record<string, string> = {
  "user not found": "Пользователь ещё не открывал Mini App",
  "only owner can assign admins": "Назначать админов может только владелец",
  "only a deployer can manage owners": "Назначать владельцев может только деплойер",
  "owner is set in server settings": "Этот владелец задан в настройках сервера",
  "cannot revoke the last owner": "Последнего владельца снять нельзя",
  "owner or deployer required": "Роли доступны владельцам и деплойерам",
};

export function personName(u: { username: string | null; first_name: string | null; telegram_id: number }): string {
  return u.username ? `@${u.username}` : u.first_name || String(u.telegram_id);
}

/** «выдал @olga · 2 нояб.» — по журналу role_changes; роли, выданные до журнала, без подписи */
export function grantedLine(r: StaffRow): string | null {
  if (!r.granted_by && !r.granted_at) return null;
  const when = r.granted_at
    ? new Date(r.granted_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
    : null;
  return [r.granted_by ? `выдал ${r.granted_by}` : "выдано", when].filter(Boolean).join(" · ");
}

export function confirmCopy(c: RoleChange): { title: string; body: string; hold: string } {
  if (c.role === "admin") {
    return c.grant
      ? {
          title: "Выдать права админа?",
          body: `${c.name} получит доступ к Кассе, модерации и публикации заданий. Снять права можно здесь же.`,
          hold: "Удерживайте — выдать права",
        }
      : {
          title: "Снять права админа?",
          body: `${c.name} потеряет доступ к Кассе и модерации. Вернуть права можно в любой момент.`,
          hold: "Удерживайте — снять права",
        };
  }
  return c.grant
    ? {
        title: "Сделать владельцем?",
        body: `${c.name} получит кабинет владельца: экономику, выплаты, Кассу и назначение админов. Назначать владельцев могут только деплойеры.`,
        hold: "Удерживайте — выдать права",
      }
    : {
        title: "Снять права владельца?",
        body: `${c.name} потеряет доступ к кабинету владельца. Отдельно выданные права админа сохранятся.`,
        hold: "Удерживайте — снять права",
      };
}

/** Какие роли можно выдать найденному человеку */
export function grantable(u: UserSearchRow, staff: Pick<StaffOut, "can_manage_admins" | "can_manage_owners">): Role[] {
  const out: Role[] = [];
  if (staff.can_manage_admins && !u.is_owner && !u.is_admin) out.push("admin");
  if (staff.can_manage_owners && !u.is_owner) out.push("owner");
  return out;
}

function useDebounced(value: string, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Person({ row, sub, children }: { row: StaffRow | UserSearchRow; sub?: string | null; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[15px] font-medium">{personName(row)}</p>
      <p className="ui-num s-s block text-[var(--text-3)]">{row.telegram_id}</p>
      {sub && <p className="ui-sys truncate">{sub}</p>}
      {children}
    </div>
  );
}

function StaffList({
  title,
  pill,
  note,
  rows,
  empty,
  canRevoke,
  locked,
  busy,
  onRevoke,
}: {
  title: string;
  pill: string;
  note: string;
  rows: StaffRow[];
  empty: string;
  canRevoke: boolean;
  /** последний — кнопка выключена */
  locked: boolean;
  busy: boolean;
  onRevoke: (r: StaffRow) => void;
}) {
  return (
    <section className="space-y-2">
      <SectionLabel action={<StatusPill tone="neutral">{pill}</StatusPill>}>{title}</SectionLabel>
      <Panel className="space-y-3 p-4">
        <p className="ui-sec">{note}</p>
        {rows.length === 0 ? (
          <p className="ui-sys">{empty}</p>
        ) : (
          <ul className="dp-people">
            {rows.map((r) => (
              <li key={r.telegram_id}>
                <Person row={r} sub={grantedLine(r)} />
                {r.from_env ? (
                  <StatusPill tone="neutral">из настроек сервера</StatusPill>
                ) : canRevoke ? (
                  <Button kind="danger" size="sm" disabled={busy || locked} onClick={() => onRevoke(r)}>
                    Снять
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}

function SearchCard({ staff, busy, onGrant }: { staff: StaffOut; busy: boolean; onGrant: (u: UserSearchRow, role: Role) => void }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const { data, isFetching, error } = useUserSearch(dq);
  const typed = dq.trim().replace(/^@/, "").length > 0;

  return (
    <section className="space-y-2">
      <SectionLabel>Выдать роль</SectionLabel>
      <Panel className="space-y-3 p-4">
        <Field label="Найти по @username или Telegram ID" hint="Человек должен хотя бы раз открыть Mini App">
          <input
            className="ui-input"
            placeholder="@username или 528193047"
            aria-label="Поиск пользователя"
            autoComplete="off"
            maxLength={64}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
        {typed && isFetching && !data && <p className="ui-sys">Загрузка…</p>}
        {typed && error && <p className="ui-fhint err">Поиск не удался</p>}
        {typed && data && data.length === 0 && <p className="ui-sys">Никого не нашли</p>}
        {typed && data && data.length > 0 && (
          <ul className="dp-people">
            {data.map((u) => {
              const can = grantable(u, staff);
              return (
                <li key={u.telegram_id} className="!items-start">
                  <Person row={u}>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {u.is_owner && <Tag tone="amber">{u.owner_from_env ? "владелец · сервер" : "владелец"}</Tag>}
                      {u.is_admin && !u.is_owner && <Tag tone="neon">админ</Tag>}
                      {u.is_deployer && <Tag tone="neutral">деплойер</Tag>}
                    </div>
                  </Person>
                  {can.length > 0 && (
                    <div className="flex shrink-0 flex-col gap-1.5">
                      {can.includes("admin") && (
                        <Button kind="secondary" size="sm" disabled={busy} onClick={() => onGrant(u, "admin")}>
                          Админ
                        </Button>
                      )}
                      {can.includes("owner") && (
                        <Button kind="secondary" size="sm" disabled={busy} onClick={() => onGrant(u, "owner")}>
                          Владелец
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </section>
  );
}

export function RolesPanel() {
  const { data, isLoading, error } = useRolesStaff();
  const setRole = useSetRole();
  const toast = useToast();
  // Что подтверждаем — пока открыта шторка с удержанием.
  const [pending, setPending] = useState<RoleChange | null>(null);

  if (isLoading) return <p className="ui-sys">Загрузка…</p>;
  if (error || !data) return <p className="ui-fhint err">Не удалось загрузить роли</p>;

  async function apply(c: RoleChange) {
    const body = c.role === "admin" ? { telegram_id: c.telegram_id, is_admin: c.grant } : { telegram_id: c.telegram_id, is_owner: c.grant };
    try {
      await setRole.mutateAsync(body);
      const what = c.role === "admin" ? "Права админа" : "Права владельца";
      toast({ kind: "ok", title: `${what} ${c.grant ? "выданы" : "сняты"}`, sub: c.name });
    } catch (e) {
      const m = e instanceof Error ? e.message : "Ошибка";
      toast({ kind: "danger", title: c.grant ? "Не удалось выдать права" : "Не удалось снять права", sub: ROLE_ERR_RU[m] ?? m });
    }
  }

  const copy = pending ? confirmCopy(pending) : null;
  const canGrant = data.can_manage_admins || data.can_manage_owners;

  return (
    <div className="space-y-5">
      <Panel className="p-4">
        <p className="ui-sec">
          Админов назначает владелец, владельцев — деплойер. Владелец из настроек сервера здесь не снимается; последнего владельца
          снять нельзя.
        </p>
      </Panel>
      {canGrant && (
        <SearchCard
          staff={data}
          busy={setRole.isPending}
          onGrant={(u, role) => setPending({ role, grant: true, telegram_id: u.telegram_id, name: personName(u) })}
        />
      )}
      <StaffList
        title="Владельцы"
        pill="назначают деплойеры"
        note="Кабинет владельца: экономика, выплаты, Касса, назначение админов."
        rows={data.owners}
        empty="Владельцев нет"
        canRevoke={data.can_manage_owners}
        locked={data.owners.length <= 1}
        busy={setRole.isPending}
        onRevoke={(r) => setPending({ role: "owner", grant: false, telegram_id: r.telegram_id, name: personName(r) })}
      />
      <StaffList
        title="Админы"
        pill="назначает владелец"
        note="Касса, модерация и публикация заданий. Экономика и выплаты без подтверждения — только у владельцев."
        rows={data.admins}
        empty="Админов пока нет"
        canRevoke={data.can_manage_admins}
        locked={false}
        busy={setRole.isPending}
        onRevoke={(r) => setPending({ role: "admin", grant: false, telegram_id: r.telegram_id, name: personName(r) })}
      />
      <Sheet open={!!pending} onClose={() => setPending(null)} title={copy?.title}>
        <p className="ui-sec text-[15px]">{copy?.body}</p>
        <div className="mt-5 grid gap-2">
          <HoldButton
            kind={pending?.grant ? "primary" : "danger"}
            block
            disabled={setRole.isPending}
            onConfirm={() => {
              const c = pending;
              setPending(null);
              if (c) apply(c);
            }}
          >
            {copy?.hold}
          </HoldButton>
          <Button kind="ghost" block onClick={() => setPending(null)}>
            Отмена
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
