import type { reactor as ru } from "../ru/reactor";

export const reactor: Record<keyof typeof ru, string> = {
  "reactor.nextAt": "At lvl {from} · {level} to go",
  "reactor.topLook": "Top look",
  "reactor.toLook": "To “{name}”: {from} of {from2} lvl",
  "reactor.now": "Now:",
  "reactor.lvl": "lvl",
  "reactor.tier0": "Prototype",
  "reactor.tier0Look": "cyan core, base hull",
  "reactor.tier1": "Circuit",
  "reactor.tier1Look": "steel armor, light seams, HUD ring",
  "reactor.tier2": "Mark",
  "reactor.tier2Look": "gold-titanium, coils, white-hot core",
  "reactor.tier3": "Singularity",
  "reactor.tier3Look": "prism core, orbits, magenta",
};
