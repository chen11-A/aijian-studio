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
          setConnected(status.runtime === "DESKTOP" && status.state === "CONNECTED");
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

export function useGrokAccount(): { state: string; label: string } {
  const [account, setAccount] = useState({ state: "NOT_CONNECTED", label: "" });
  useEffect(() => {
    let live = true;
    const pull = () => {
      void readGrokStatus()
        .then((status) => {
          if (!live) return;
          setAccount({
            state: status.runtime === "DESKTOP" ? status.state : "NOT_CONNECTED",
            label: status.accountLabel ?? "",
          });
        })
        .catch(() => {
          if (live) setAccount({ state: "NOT_CONNECTED", label: "" });
        });
    };
    pull();
    window.addEventListener("aivora-grok-changed", pull);
    return () => {
      live = false;
      window.removeEventListener("aivora-grok-changed", pull);
    };
  }, []);
  return account;
}

/** True when the signed-in membership cannot use this app's models. */
export function useGrokDenied(): boolean {
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    let live = true;
    const pull = () => {
      void readGrokStatus()
        .then((status) => {
          if (!live) return;
          setDenied(status.runtime === "DESKTOP" && status.state === "ENTITLEMENT_DENIED");
        })
        .catch(() => {
          if (live) setDenied(false);
        });
    };
    pull();
    window.addEventListener("aivora-grok-changed", pull);
    return () => {
      live = false;
      window.removeEventListener("aivora-grok-changed", pull);
    };
  }, []);
  return denied;
}
