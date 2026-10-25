import type { ReactNode } from "react";
import { useScreenBack } from "@/lib/backButton";
import { ScreenHeader } from "@/components/ui";
import { BackLink } from "@/components/BackLink";

/**
 * Общая оболочка экранов рабочей зоны (кабинет, деплой): шапка на верхнем скриме,
 * системная «Назад» Telegram — назад по истории или на «Контур». Вне Telegram — своя ссылка внизу (с заливкой, п. 3.8).
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
  useScreenBack(back);
  return (
    <div className="space-y-5">
      <ScreenHeader eyebrow={eyebrow} title={title} action={status} />
      {children}
      <BackLink to={back} />
    </div>
  );
}
