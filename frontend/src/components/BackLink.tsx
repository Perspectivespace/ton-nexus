import { Link } from "react-router-dom";
import { hasBackButton } from "@/lib/backButton";
import { IconBack } from "@/components/icons";

/**
 * Запасная ссылка «назад» — только вне Telegram (в Telegram её роль играет системная BackButton, DESIGN.md §14.1).
 * Кнопка с заливкой, поэтому текст не висит на фоне города.
 */
export function BackLink({ to = "/", label = "Контур" }: { to?: string; label?: string }) {
  if (hasBackButton()) return null;
  return (
    <Link to={to} className="ui-btn secondary sm self-start no-underline">
      <IconBack size={16} /> {label}
    </Link>
  );
}
