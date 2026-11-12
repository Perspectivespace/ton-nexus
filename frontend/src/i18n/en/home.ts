import type { home as ru } from "../ru/home";

export const home: Record<keyof typeof ru, string> = {
  "home.minerIdle": "stopped — start a cycle",
  "home.minerRunning": "cycle running",
  "home.minerReady": "storage full — collect",
  "home.levelProgress": "Level progress",
  "home.wheelBonusHint": "Wheel bonus: adds to the odds of your next boost attempt and is spent on it",
  "home.wheelBonusTail": "% to success · next boost",
  "home.reactor": "Reactor",
  "home.syncing": "sync",
  "home.online": "online",
  "home.syncingHub": "Syncing the hub…",
  "home.noServer": "No connection to the server. Open the app from Telegram.",
  "home.collapseBalance": "Collapse balance panel",
  "home.expandBalance": "Expand balance panel",
  "home.balance": "Balance",
  "home.lvl": "Lvl",
};
