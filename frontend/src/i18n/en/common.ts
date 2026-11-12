import type { common as ru } from "../ru/common";

export const common: Record<keyof typeof ru, string> = {
  "nav.home": "Hub",
  "nav.miner": "Miner",
  "nav.games": "Games",
  "nav.earn": "Earn",
  "nav.profile": "Profile",

  "lang.title": "Язык / Language",
  "lang.sub": "Saved for all your devices",

  "settings.title": "Settings",
  "settings.rowSub": "Language, theme, motion",
  "settings.sub": "Language is set here, the rest comes from Telegram and your system",
  "settings.theme": "Theme",
  "settings.themeSub": "Follows Telegram",
  "settings.themeDay": "Day HUD",
  "settings.themeNight": "Night",
  "settings.motion": "Motion",
  "settings.motionSub": "Based on system and device power",
  "settings.motionReduced": "Reduced (system)",
  "settings.motionLite": "Lite",
  "settings.motionFull": "Full",
  "settings.note": "The theme follows your Telegram theme, motion follows the system “Reduce motion” setting.",

  "time.days": "{n} day|{n} days",
  "time.hours": "{n} hour|{n} hours",
  "time.minutes": "{n} minute|{n} minutes",
};
