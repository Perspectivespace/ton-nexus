import type { friend as ru } from "../ru/friend";

export const friend: Record<keyof typeof ru, string> = {
  "friend.tasks": "{n} task|{n} tasks",
  "friend.reachedLevel": "reached level {n}",
  "friend.reachLevel": "reach level {n}",
  "friend.completed": "completed {tasks}",
  "friend.complete": "complete {tasks}",
  "friend.and": " and ",
  "friend.or": " or ",
  "friend.who": "Friends who {cond}",
  "friend.all": "All invited friends",
  "friend.soon": "We'll count friends who {cond}",
  "friend.soonAll": "We'll count all invited friends",
  "friend.joinHint": "A friend counts once they {cond}",
  "friend.joinNow": "A friend counts as soon as they join",
  "friend.lvlShort": "lvl {n}",
  "friend.noCondition": "Right away, no conditions",
};
