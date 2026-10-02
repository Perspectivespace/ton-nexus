import { NavLink } from "react-router-dom";
import { IconHome, IconReactor, IconTasks, IconWallet } from "./icons";

const items = [
  { to: "/", label: "Контур", Icon: IconHome, tone: "steel" },
  { to: "/miner", label: "Майнер", Icon: IconReactor, tone: "blue" },
  { to: "/tasks", label: "Задания", Icon: IconTasks, tone: "violet" },
  { to: "/wallet", label: "Баланс", Icon: IconWallet, tone: "mint" },
] as const;

export function Nav() {
  return (
    <div className="nav-dock">
      <div className="nav-dock-inner">
        {items.map(({ to, label, Icon, tone }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            data-tone={tone}
            className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
          >
            <span className="nav-icon">
              <Icon size={20} />
            </span>
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}
