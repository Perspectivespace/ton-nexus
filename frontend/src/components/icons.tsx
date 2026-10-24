/**
 * Набор из 24 иконок «Ночного контура» (docs/DESIGN.md, п. 8; рисунки — docs/design/styleboard.html).
 * Сетка 24 px, обводка 1.6 currentColor, квадратные концы, острые стыки — те же срезы, что у панелей.
 * Цвет задаётся через color у родителя; размер — проп size.
 */
import type { SVGProps } from "react";

export type IconProps = { size?: number; className?: string; title?: string } & Omit<SVGProps<SVGSVGElement>, "children">;

function make(name: string, body: React.ReactNode) {
  function Icon({ size = 24, className, title, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className ? `ui-icon ${className}` : "ui-icon"}
        aria-hidden={title ? undefined : true}
        role={title ? "img" : undefined}
        {...rest}
      >
        {title ? <title>{title}</title> : null}
        {body}
      </svg>
    );
  }
  Icon.displayName = `Icon${name}`;
  return Icon;
}

const p = (d: string) => <path d={d} />;

export const IconHome = make("Home", <>{p("M4 11l8-6 8 6v9H4z")}{p("M10 20v-5h4v5")}</>);
export const IconReactor = make("Reactor", <>{p("M12 3l8 4.5v9L12 21l-8-4.5v-9z")}{p("M12 8.5l3 1.75v3.5L12 15.5l-3-1.75v-3.5z")}</>);
export const IconTasks = make("Tasks", <>{p("M5 3h11l3 3v15H5z")}{p("M8.5 9h7M8.5 12.5h7M8.5 16h4")}</>);
export const IconWallet = make("Wallet", <>{p("M3 7h15l3 3v10H6l-3-3z")}{p("M15 13.5h3")}{p("M6 7l8-3 2 3")}</>);
export const IconGift = make("Gift", <>{p("M3 7h18v3H3z")}{p("M4 10h16v8l-2 2H4z")}{p("M12 7v13M12 7L9 4M12 7l3-3")}</>);
export const IconWheel = make("Wheel", <>{p("M8.5 3.5h7l5 5v7l-5 5h-7l-5-5v-7z")}{p("M12 3.5v6M12 14.5v6M3.5 12h6M14.5 12h6")}{p("M10.5 10.5h3v3h-3z")}</>);
export const IconUp = make("Up", <>{p("M12 18V6M7 11l5-5 5 5")}{p("M5 20h14")}</>);
export const IconOut = make("Out", <>{p("M12 15V4M7.5 8.5L12 4l4.5 4.5")}{p("M4 13v7h14l2-2v-5")}</>);
export const IconIn = make("In", <>{p("M12 4v11M7.5 10.5L12 15l4.5-4.5")}{p("M4 13v7h14l2-2v-5")}</>);
export const IconHistory = make("History", <>{p("M4 12a8 8 0 1 0 2.4-5.7")}{p("M4 4v4h4")}{p("M12 8v4.5l3 2")}</>);
export const IconRules = make("Rules", <>{p("M6 3h12v15l-3 3H6z")}{p("M9 8h6M9 11.5h6M9 15h3")}</>);
export const IconKey = make("Key", <>{p("M14.5 3.5h6v6l-3 3h-3l-3-3v-3z")}{p("M11.5 12.5L4 20v1h3v-2h2v-2h2l2-2")}</>);
export const IconUser = make("User", <>{p("M9 3h6l2 2v5l-2 2H9l-2-2V5z")}{p("M4 21v-3l3-3h10l3 3v3")}</>);
export const IconBell = make("Bell", <>{p("M6 17v-7l3-5h6l3 5v7l2 2H4z")}{p("M10 21h4")}</>);
export const IconCopy = make("Copy", <>{p("M8 8h10l2 2v10H8z")}{p("M4 16V4h10v2")}</>);
export const IconRefresh = make("Refresh", <>{p("M20 12a8 8 0 1 1-2.4-5.7")}{p("M20 4v4h-4")}</>);
export const IconClose = make("Close", p("M6 6l12 12M18 6L6 18"));
export const IconGear = make("Gear", <>{p("M9 3h6l1 3 3 1.5L21 10v4l-2 2.5-3 1.5-1 3H9l-1-3-3-1.5L3 14v-4l2-2.5L8 6z")}{p("M10 10h4v4h-4z")}</>);
export const IconOffline = make("Offline", <>{p("M4 20h2v-3H4zM9 20h2v-6H9zM14 20h2v-9h-2zM19 20h2V8h-2z")}{p("M3 3l18 18")}</>);
export const IconBolt = make("Bolt", p("M13 3L5 13h6l-1 8 8-10h-6z"));
export const IconCheck = make("Check", p("M5 12.5l4.5 4.5L19 7.5"));
export const IconAlert = make("Alert", <>{p("M12 3.5l9 16H3z")}{p("M12 10v4.5M12 16.5v1.5")}</>);
export const IconEmpty = make("Empty", <><path d="M4 7h13l3 3v10H4z" strokeDasharray="3 2" />{p("M9 14h6")}</>);
export const IconChevron = make("Chevron", p("M9 6l6 6-6 6"));
/** Назад — зеркало шеврона; в счёт 24 не входит */
export const IconBack = make("Back", p("M15 6l-6 6 6 6"));

/** Полный список — для витрины /kit и проверки «ровно 24» */
export const ICONS = {
  home: IconHome, reactor: IconReactor, tasks: IconTasks, wallet: IconWallet, gift: IconGift, wheel: IconWheel,
  up: IconUp, out: IconOut, in: IconIn, history: IconHistory, rules: IconRules, key: IconKey,
  user: IconUser, bell: IconBell, copy: IconCopy, refresh: IconRefresh, close: IconClose, gear: IconGear,
  offline: IconOffline, bolt: IconBolt, check: IconCheck, alert: IconAlert, empty: IconEmpty, chevron: IconChevron,
} as const;
export type IconName = keyof typeof ICONS;

/* Старые имена — чтобы экраны, которые ещё не переведены, продолжали работать */
export const IconSpark = IconBolt;
export const IconArrow = IconChevron;
export const IconLevel = IconUp;
