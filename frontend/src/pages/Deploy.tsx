import { useMe } from "@/api/hooks";
import { ErrorPanel, LoadingPanel, StatusPill } from "@/components/ui";
import { OwnerShell } from "@/components/owner/OwnerShell";
import { DeployPanel } from "@/components/DeployPanel";

/** Деплой — отдельный экран рабочей зоны, только для деплойеров (права проверяет сервер). */
export function Deploy() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return <LoadingPanel label="Проверка доступа…" />;
  if (!me?.can_deploy) {
    return (
      <OwnerShell eyebrow="Работа" title="Нет доступа">
        <ErrorPanel message="Деплой доступен только деплойерам." />
      </OwnerShell>
    );
  }
  return (
    <OwnerShell eyebrow="Работа" title="Деплой" status={<StatusPill tone="ok">в сети</StatusPill>}>
      <DeployPanel />
    </OwnerShell>
  );
}

