import type { TonConnectUI } from "@tonconnect/ui-react";

/** Подключить кошелёк и дождаться подключения: openModal() возвращается сразу, ждём onStatusChange */
export type ConnectUI = Pick<TonConnectUI, "connected" | "connectionRestored" | "onStatusChange" | "onModalStateChange" | "openModal">;

export async function ensureConnected(ui: ConnectUI): Promise<void> {
  if (ui.connected) return;
  await ui.connectionRestored;
  if (ui.connected) return;
  await new Promise<void>((resolve, reject) => {
    let offStatus = () => {};
    let offModal = () => {};
    const done = () => {
      offStatus();
      offModal();
    };
    offStatus = ui.onStatusChange(
      (w) => {
        if (w) {
          done();
          resolve();
        }
      },
      (e) => {
        done();
        reject(e);
      },
    );
    offModal = ui.onModalStateChange((s) => {
      if (s.status === "closed" && s.closeReason === "action-cancelled" && !ui.connected) {
        done();
        reject(new Error("Кошелёк не подключён"));
      }
    });
    ui.openModal().catch((e) => {
      done();
      reject(e);
    });
  });
}
