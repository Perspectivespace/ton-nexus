import { useMe } from "@/api/hooks";
import { ErrorPanel, LoadingPanel } from "@/components/ui";
import { OwnerShell } from "@/components/owner/OwnerShell";
import { RolesPanel } from "@/components/RolesPanel";

/** «Роли» — экран рабочей зоны: владелец назначает админов, деплойер — владельцев (права проверяет сервер). */
export function Roles() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <LoadingPanel label="Проверка доступа…" />;
  if (!me?.is_owner && !me?.can_deploy) {
    return (
      <OwnerShell eyebrow="Управление" title="Нет доступа">
        <ErrorPanel message="Роли доступны владельцам и деплойерам." />
      </OwnerShell>
    );
  }
  return (
    <OwnerShell eyebrow="Управление" title="Роли">
      <RolesPanel />
    </OwnerShell>
  );
}
