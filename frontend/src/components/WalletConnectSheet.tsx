import { lazy, Suspense } from "react";
import { t } from "@/i18n";

const SheetInner = lazy(() => import("./WalletConnectSheetInner"));

type Props = {
  linked: { address: string; wallet_app: string | null } | null;
  onLinked: () => void;
  onUnlink: () => void;
};

export function WalletConnectSheet(props: Props) {
  return (
    <Suspense fallback={<p className="ui-sec">{t("ui.loadingDots")}</p>}>
      <SheetInner {...props} />
    </Suspense>
  );
}
