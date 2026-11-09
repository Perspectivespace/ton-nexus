import { adVars } from "@/lib/cityAdPalette";
import { linkHost } from "@/lib/cityAdLink";
import { FORMAT_RU } from "@/lib/cityAdBuy";

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
    <div className="cad-card cab-static" style={adVars(color)} aria-label="Карточка объявления — превью">
      <div className="cc-top">
        <span className="cc-kicker">РЕКЛАМА · {(FORMAT_RU[format] ?? "Объявление").toUpperCase()}</span>
        {days ? <span className="cc-days">ещё {days} дн.</span> : null}
      </div>
      <h3 className="cc-title">{title || "Ваш заголовок"}</h3>
      {subtitle && <p className="cc-sub">{subtitle}</p>}
      {body && <p className="cc-body">{body}</p>}
      {link && (
        <div className="cc-link">
          <i className="cc-ico" aria-hidden="true" />
          <span>{linkHost(link)}</span>
          <em>{linkKind === "telegram" ? "Telegram" : "Сайт"}</em>
        </div>
      )}
      <div className={`cc-act${link ? "" : " solo"}`} aria-hidden="true">
        {link && <span className="cc-go">Перейти</span>}
        <span className="cc-close">Закрыть</span>
      </div>
    </div>
  );
}
