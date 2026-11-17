import { IconClose, IconCoins, IconHome, IconReactor, IconUser } from "./icons";
import { Button, Panel } from "./ui/index";
import { t, type Key } from "@/i18n";
import type { HintKey } from "@/lib/onboarding";

const ICON = { home: IconHome, miner: IconReactor, earn: IconCoins, profile: IconUser } as const;
const TEXT: Record<HintKey, [Key, Key]> = {
  home: ["hint.homeTitle", "hint.homeText"],
  miner: ["hint.minerTitle", "hint.minerText"],
  earn: ["hint.earnTitle", "hint.earnText"],
  profile: ["hint.profileTitle", "hint.profileText"],
};

/**
 * Разовая подсказка раздела (знакомство): металлическая плашка над доком с неоновой кромкой.
 * Без затемнения экрана и без backdrop-filter — раздел виден и работает; одно появление (opacity/transform).
 */
export function SectionHint({ hint, onClose }: { hint: HintKey; onClose: () => void }) {
  const Icon = ICON[hint];
  const [title, text] = TEXT[hint];
  return (
    <div className="hint-layer" key={hint}>
      <Panel level="e2" cut="m" lift="l2" wrapClassName="hint-wrap" className="hint" role="status" aria-live="polite">
        <span className="hint-ic" aria-hidden>
          <Icon size={22} />
        </span>
        <div className="hint-body">
          <p className="hint-eye">{t("hint.eyebrow")}</p>
          <p className="hint-title">{t(title)}</p>
          <p className="hint-text">{t(text)}</p>
          <Button kind="secondary" size="sm" className="hint-ok" onClick={onClose}>
            {t("hint.ok")}
          </Button>
        </div>
        <button type="button" className="hint-x" aria-label={t("hint.close")} onClick={onClose}>
          <IconClose size={16} />
        </button>
      </Panel>
    </div>
  );
}
