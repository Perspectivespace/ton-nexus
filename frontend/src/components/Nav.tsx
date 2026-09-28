import { NavLink } from "react-router-dom";

const items = [
  { to: "/", label: "Контур" },
  { to: "/miner", label: "Майнер" },
  { to: "/tasks", label: "Задания" },
  { to: "/wallet", label: "Баланс" },
];

export function Nav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-[var(--line)] bg-[var(--bg-panel)]/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-lg justify-around px-2 py-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex-1 rounded-xl px-2 py-2 text-center text-xs font-medium transition ${
                isActive
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--text-dim)]"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
