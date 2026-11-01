import { lazy, Suspense } from "react";

const SheetInner = lazy(() => import("./WalletConnectSheetInner"));

type Props = {
  linked: { address: string; wallet_app: string | null } | null;
  onLinked: () => void;
  onUnlink: () => void;
};

export function WalletConnectSheet(props: Props) {
  return (
    <Suspense fallback={<p className="ui-sec">Загрузка…</p>}>
      <SheetInner {...props} />
    </Suspense>
  );
}
