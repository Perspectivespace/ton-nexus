/** Общие типы поля боя: состояние матча в форме движка (shared/arena/engine.js) + то, что рисует рендер */
import type { Cell, MatchState, Player, Plan } from "@shared/arena/engine.js";

export interface BoardPlayer extends Player {
  isMe: boolean;
}
/** матч из API, приведённый к форме движка: id игрока = место (seat) */
export interface Board extends MatchState {
  players: BoardPlayer[];
  meId: number | null;
}
export interface ReachCell extends Cell {
  near: boolean;
}
/** кадр: m — текущее состояние, prev — до розыгрыша, t — мс от начала розыгрыша (null — статичный кадр) */
export interface DrawView {
  m: Board;
  prev: Board | null;
  meId: number | null;
  t: number | null;
  plan?: Plan;
  reach?: ReachCell[];
  targets?: BoardPlayer[];
  attack?: BoardPlayer | null;
  from?: Cell;
  medkit?: boolean;
}

/** таймлайн розыгрыша хода, мс (как в прототипе) */
export const T = { move: 380, shot0: 360, shotGap: 80, travel: 130, flash: 260, num: 800, shatter: 560, zone0: 560, zoneDur: 700, end: 1250 } as const;
