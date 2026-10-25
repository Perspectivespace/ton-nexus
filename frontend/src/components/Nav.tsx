import { IconHome, IconReactor, IconTasks, IconWallet } from "./icons";
import { Dock } from "./ui/index";

const items = [
  { to: "/", label: "Контур", Icon: IconHome },
  { to: "/miner", label: "Майнер", Icon: IconReactor },
  { to: "/tasks", label: "Задания", Icon: IconTasks },
  { to: "/wallet", label: "Баланс", Icon: IconWallet },
] as const;

/** Док виден только на корневых экранах разделов (DESIGN п. 14.3) */
export function isDockRoute(path: string) {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return items.some((i) => i.to === p);
}

/** Нижний док — четыре раздела */
export function Nav() {
  return <Dock items={items} />;
}
