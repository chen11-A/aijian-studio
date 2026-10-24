import { useEffect, useState } from "react";
import { readGrokStatus } from "./transport";

/** True when this desktop is signed in to Grok. Tokens stay in the main process. */
export function useGrokConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let live = true;
    const pull = () => {
      void readGrokStatus()
        .then((status) => {
          if (!live) return;
          setConnected(
            status.runtime === "DESKTOP" &&
              (status.state === "CONNECTED" || status.state === "ENTITLEMENT_DENIED"),
          );
        })
        .catch(() => {
          if (live) setConnected(false);
        });
    };
    pull();
    window.addEventListener("aivora-grok-changed", pull);
    return () => {
      live = false;
      window.removeEventListener("aivora-grok-changed", pull);
    };
  }, []);
  return connected;
}
