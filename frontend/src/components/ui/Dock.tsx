import type { ComponentType } from "react";
import { NavLink } from "react-router-dom";
import { haptic } from "@/lib/haptics";
import type { IconProps } from "../icons";

export type DockItem = { to: string; label: string; Icon: ComponentType<IconProps> };

/**
 * Плавающий нижний док: слой e2, поля 10 px, 14 px от низа, высота 66, срез 12.
 * Активный пункт — голубой, риска сверху и перелив. Без backdrop-filter (п. 7, 12).
 */
export function Dock({ items }: { items: ReadonlyArray<DockItem> }) {
  return (
    <nav className="ui-dock" aria-label="Разделы">
      <div className="ui-lift l2">
        <div className="ui-cut e2">
          {items.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={() => haptic.select()}
              className={({ isActive }) => (isActive ? "active" : undefined)}
            >
              <Icon size={22} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}
