import { useEffect, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { hasBackButton, pushBack } from "@/lib/backButton";
import { ScreenHeader } from "@/components/ui";
import { IconBack } from "@/components/icons";

/**
 * Общая оболочка экранов кабинета владельца (фаза 3): шапка на верхнем скриме,
 * системная «Назад» Telegram ведёт на «Контур». Вне Telegram — своя ссылка внизу (с заливкой, п. 3.8).
 */
export function OwnerShell({
  eyebrow = "Кабинет владельца",
  title,
  status,
  back = "/",
  children,
}: {
  eyebrow?: string;
  title: string;
  status?: ReactNode;
  back?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  useEffect(() => pushBack(() => navigate(back)), [navigate, back]);
  return (
    <div className="space-y-5">
      <ScreenHeader eyebrow={eyebrow} title={title} action={status} />
      {children}
      {!hasBackButton() && (
        <Link to={back} className="ui-btn secondary sm self-start no-underline">
          <IconBack size={16} /> Контур
        </Link>
      )}
    </div>
  );
}
