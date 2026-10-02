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
    <div className="nav-dock">
      <div className="nav-dock-inner">
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
    </div>
  );
}
