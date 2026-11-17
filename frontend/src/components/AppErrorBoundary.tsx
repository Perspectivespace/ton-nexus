import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "@/lib/errorReport";
import { t } from "@/i18n";
import { Button } from "@/components/ui/Button";
import markDark from "@/assets/brand/mark.svg";
import markLight from "@/assets/brand/mark-light.svg";

/**
 * Последний рубеж: если упал рендер всего приложения, показываем «Что-то пошло не так» с перезагрузкой
 * вместо белого экрана и отправляем отчёт (P6). Экран не зависит от данных, роутера и запросов —
 * только словарь и статичные стили «Ночного контура».
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    reportError("render", error, info.componentStack?.split("\n").slice(0, 6).join("\n") ?? "");
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <CrashScreen />;
  }
}

export function CrashScreen({ onReload = () => location.reload() }: { onReload?: () => void }) {
  return (
    <div className="crash" role="alert">
      <span className="crash-mark brand-pair" aria-hidden>
        <img className="b-dark" src={markDark} alt="" width={88} height={88} draggable={false} />
        <img className="b-light" src={markLight} alt="" width={88} height={88} draggable={false} />
      </span>
      <p className="crash-code">ERR · {t("ui.crashCode")}</p>
      <h1 className="crash-title">{t("ui.crashTitle")}</h1>
      <p className="crash-text">{t("ui.crashText")}</p>
      <Button kind="primary" size="lg" block className="crash-btn" onClick={onReload}>
        {t("ui.crashReload")}
      </Button>
    </div>
  );
}
