import { IconHome, IconReactor, IconTasks, IconWallet } from "./icons";
import { Dock } from "./ui/index";

const items = [
  { to: "/", label: "Контур", Icon: IconHome },
  { to: "/miner", label: "Майнер", Icon: IconReactor },
  { to: "/tasks", label: "Задания", Icon: IconTasks },
  { to: "/wallet", label: "Баланс", Icon: IconWallet },
] as const;

/** Нижний док — те же четыре раздела, что и раньше */
export function Nav() {
  return <Dock items={items} />;
}
