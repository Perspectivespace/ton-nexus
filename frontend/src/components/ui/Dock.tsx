import type { ComponentType, ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { haptic } from "@/lib/haptics";
import type { IconProps } from "../icons";

export type DockItem = { to: string; label: string; Icon: ComponentType<IconProps> };

function Item({ to, label, Icon }: DockItem) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={() => haptic.select()}
      className={({ isActive }) => (isActive ? "active" : undefined)}
    >
      <Icon size={22} />
      <span>{label}</span>
    </NavLink>
  );
}

/**
 * Плавающий нижний док: слой e2, поля 8 px, 14 px от низа, высота 66, срез 12.
 * Активный пункт — голубой, риска сверху и перелив. Без backdrop-filter (п. 7, 12).
 * С `center` пункты делятся пополам: две равные группы по бокам и средний слот 48 px
 * (подпись приподнятой кнопки — сама кнопка рисуется над доком, см. Nav / GamesButton).
 */
export function Dock({ items, center, className }: { items: ReadonlyArray<DockItem>; center?: ReactNode; className?: string }) {
  const half = Math.ceil(items.length / 2);
  return (
    <nav className={className ? `ui-dock ${className}` : "ui-dock"} aria-label="Разделы">
      <div className="ui-lift l2">
        <div className="ui-cut e2">
          {center ? (
            <>
              <span className="dg">
                {items.slice(0, half).map((it) => (
                  <Item key={it.to} {...it} />
                ))}
              </span>
              {center}
              <span className="dg">
                {items.slice(half).map((it) => (
                  <Item key={it.to} {...it} />
                ))}
              </span>
            </>
          ) : (
            items.map((it) => <Item key={it.to} {...it} />)
          )}
        </div>
      </div>
    </nav>
  );
}
