import { NavLink } from "react-router-dom";
import { IconHome, IconReactor, IconTasks, IconWallet } from "./icons";

const items = [
  { to: "/", label: "Контур", Icon: IconHome },
  { to: "/miner", label: "Майнер", Icon: IconReactor },
  { to: "/tasks", label: "Задания", Icon: IconTasks },
  { to: "/wallet", label: "Баланс", Icon: IconWallet },
];

export function Nav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-20 border-t border-[var(--line)] bg-[#0a0e16]/90 backdrop-blur-xl"
      style={{ paddingBottom: "var(--safe-b)" }}
    >
      <div className="mx-auto flex max-w-lg px-2 py-1.5">
        {items.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
          >
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
