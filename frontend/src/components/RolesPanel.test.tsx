import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};
});

import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ROLE_ERR_RU, RolesPanel, confirmCopy, grantable, grantedLine, personName } from "./RolesPanel";
import { WorkArea, rolesSub } from "./WorkArea";
import { routeKey } from "@/lib/routes";
import type { StaffOut, UserSearchRow } from "@/api/types";

function render(node: ReactNode, seed: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  for (const [k, v] of Object.entries(seed)) qc.setQueryData(k.split("/"), v);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const staff = (over: Partial<StaffOut> = {}): StaffOut => ({
  owners: [
    { telegram_id: 1000, username: "sergey", first_name: null, from_env: true },
    { telegram_id: 2001, username: "olga", first_name: null, granted_by: "@sergey", granted_at: "2026-11-02T09:00:00+00:00" },
  ],
  admins: [{ telegram_id: 2003, username: null, first_name: "Вася", granted_by: "@olga", granted_at: "2026-11-01T09:00:00+00:00" }],
  can_manage_admins: true,
  can_manage_owners: true,
  ...over,
});
const found = (over: Partial<UserSearchRow> = {}): UserSearchRow => ({
  telegram_id: 7, username: "u", first_name: null, is_owner: false, owner_from_env: false, is_admin: false, is_deployer: false, ...over,
});

describe("«Роли»: помощники", () => {
  it("имя, подпись «выдал», тексты подтверждения", () => {
    expect(personName({ telegram_id: 5, username: "x", first_name: "X" })).toBe("@x");
    expect(personName({ telegram_id: 5, username: null, first_name: null })).toBe("5");
    expect(grantedLine({ telegram_id: 1, username: null, first_name: null })).toBeNull();
    expect(grantedLine(staff().owners[1])).toMatch(/^выдал @sergey · 2 нояб/);
    expect(confirmCopy({ role: "admin", grant: true, telegram_id: 1, name: "@a" }).hold).toBe("Удерживайте — выдать права");
    expect(confirmCopy({ role: "owner", grant: true, telegram_id: 1, name: "@a" }).title).toBe("Сделать владельцем?");
    expect(confirmCopy({ role: "owner", grant: false, telegram_id: 1, name: "@a" }).body).toContain("@a");
    expect(ROLE_ERR_RU["cannot revoke the last owner"]).toBe("Последнего владельца снять нельзя");
  });
  it("что можно выдать: админ — владельцу, владелец — деплойеру", () => {
    const onlyOwner = { can_manage_admins: true, can_manage_owners: false };
    const onlyDeployer = { can_manage_admins: false, can_manage_owners: true };
    expect(grantable(found(), staff())).toEqual(["admin", "owner"]);
    expect(grantable(found(), onlyOwner)).toEqual(["admin"]);
    expect(grantable(found(), onlyDeployer)).toEqual(["owner"]);
    expect(grantable(found({ is_admin: true }), staff())).toEqual(["owner"]);
    expect(grantable(found({ is_owner: true }), staff())).toEqual([]);
  });
});

describe("«Роли»: экран", () => {
  it("деплойер-владелец: поиск, владельцы с плашкой сервера и «выдал», админы", () => {
    const t = text(render(<RolesPanel />, { "roles/staff": staff() }));
    expect(t).toContain("Выдать роль");
    expect(t).toContain("Найти по @username или Telegram ID");
    expect(t).toContain("из настроек сервера");
    expect(t).toContain("выдал @sergey");
    expect(t).toContain("Вася");
    // снять можно олгу и Васю, сервера — нет
    expect(t.match(/Снять/g)?.length).toBe(2);
    expect(t.indexOf("Владельцы")).toBeLessThan(t.indexOf("Админы"));
  });
  it("владелец без деплоя: владельцев не снимает", () => {
    const t = text(render(<RolesPanel />, { "roles/staff": staff({ can_manage_owners: false }) }));
    expect(t.match(/Снять/g)?.length).toBe(1);
    expect(t).toContain("Выдать роль");
  });
  it("последний владелец — кнопка выключена", () => {
    const html = render(<RolesPanel />, {
      "roles/staff": staff({ owners: [{ telegram_id: 2001, username: "olga", first_name: null }], admins: [] }),
    });
    expect(text(html)).toContain("Админов пока нет");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Снять/);
  });
  it("без прав на выдачу поиск не показан", () => {
    const t = text(render(<RolesPanel />, { "roles/staff": staff({ can_manage_owners: false, can_manage_admins: false }) }));
    expect(t).not.toContain("Выдать роль");
    expect(t).not.toContain("Снять");
  });
  it("загрузка — текстом, без анимации", () => {
    const t = text(render(<RolesPanel />, {}));
    expect(t).toContain("Загрузка…");
  });
});

describe("Управление → «Роли»", () => {
  const me = { id: 1, telegram_id: 1, username: "p", first_name: "Игрок", balance: "0", xp: 0, level: 1, focus_tokens: 0, block_tokens: 0, success_boost_bp: 0, is_ambassador: false, is_admin: false, is_owner: false, is_deployer: false, can_deploy: false, miner: null };
  it("строка видна владельцу и деплойеру, ведёт на /roles", () => {
    const owner = render(<WorkArea />, { me: { ...me, is_owner: true, is_admin: true } });
    expect(owner).toContain('href="/roles"');
    expect(text(owner)).toContain("Роли");
    expect(render(<WorkArea />, { me: { ...me, is_deployer: true, can_deploy: true } })).toContain('href="/roles"');
    expect(render(<WorkArea />, { me: { ...me, is_admin: true } })).not.toContain('href="/roles"');
    expect(routeKey("/roles")).toBe("roles");
  });
  it("подпись строки по правам", () => {
    expect(rolesSub(true, true)).toBe("Админы и владельцы");
    expect(rolesSub(true, false)).toBe("Админы");
    expect(rolesSub(false, true)).toBe("Владельцы");
  });
});
