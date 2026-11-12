import { adVars } from "@/lib/cityAdPalette";
import { linkHost } from "@/lib/cityAdLink";
import { FORMAT_RU } from "@/lib/cityAdBuy";
import { t } from "@/i18n";

/**
 * Карточка объявления, как её увидят в «Прогулке» (те же стили .cad-card), но на месте, без кнопок перехода.
 */
export function AdCardPreview({
  format,
  title,
  subtitle,
  body,
  link,
  linkKind,
  color,
  days,
}: {
  format: string;
  title: string;
  subtitle?: string | null;
  body?: string | null;
  link?: string | null;
  linkKind?: "telegram" | "web" | null;
  color: string;
  days?: number;
}) {
  return (
    <div className="cad-card cab-static" style={adVars(color)} aria-label={t("ad.previewAria")}>
      <div className="cc-top">
        <span className="cc-kicker">{t("ad.kicker")}{" "}{(FORMAT_RU[format] ?? t("ad.kickerAny2")).toUpperCase()}</span>
        {days ? <span className="cc-days">{t("ad.daysLeft", { n: days })}</span> : null}
      </div>
      <h3 className="cc-title">{title || t("ad.yourTitle")}</h3>
      {subtitle && <p className="cc-sub">{subtitle}</p>}
      {body && <p className="cc-body">{body}</p>}
      {link && (
        <div className="cc-link">
          <i className="cc-ico" aria-hidden="true" />
          <span>{linkHost(link)}</span>
          <em>{linkKind === "telegram" ? "Telegram" : t("ad.site")}</em>
        </div>
      )}
      <div className={`cc-act${link ? "" : " solo"}`} aria-hidden="true">
        {link && <span className="cc-go">{t("ad.go")}</span>}
        <span className="cc-close">{t("ui.close")}</span>
      </div>
    </div>
  );
}
