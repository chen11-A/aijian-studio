import { useEffect, useState } from "react";
import { Dropdown } from "./Dropdown";
import { Icon } from "./Icon";
import { useDemo } from "./model";
import { useOfficialConnection } from "./chatgpt-auth/ChatGPTConnectionContext";
import { readGrokStatus } from "./grok-auth/transport";
import { grokBridge } from "./grok-auth/transport";
import { accountMonogram, shortAccountLabel, signedInLabel } from "./user-chip";

/** Round monogram. A photo is never required, so a missing file cannot leave a blank square. */
export function UserChip() {
  const d = useDemo();
  const official = useOfficialConnection();
  const [grok, setGrok] = useState({ signedIn: false, label: null as string | null });
  useEffect(() => {
    let live = true;
    const pull = () => {
      void readGrokStatus()
        .then((status) => {
          if (!live) return;
          const signedIn =
            status.runtime === "DESKTOP" &&
            (status.state === "CONNECTED" || status.state === "ENTITLEMENT_DENIED");
          setGrok({ signedIn, label: signedIn ? status.accountLabel : null });
        })
        .catch(() => undefined);
    };
    pull();
    window.addEventListener("aivora-grok-changed", pull);
    return () => {
      live = false;
      window.removeEventListener("aivora-grok-changed", pull);
    };
  }, []);
  const profile = official?.connection.status.profiles.find(
    (item) => item.id === official.connection.status.activeProfileId,
  );
  const chatgptSignedIn =
    official?.connection.status.state === "CONNECTED" ||
    official?.connection.status.state === "IDENTITY_ONLY";
  const name = signedInLabel({
    grokSignedIn: grok.signedIn,
    grokLabel: grok.label,
    chatgptSignedIn: Boolean(chatgptSignedIn),
    chatgptLabel: profile?.email || profile?.label || null,
    localName: d.value("userName", "本地用户"),
  });
  const signedIn = grok.signedIn || Boolean(chatgptSignedIn);
  return (
    <Dropdown
      className="user-menu"
      label="用户菜单"
      summary={
        <>
          <span className="user-avatar" aria-hidden="true">
            {accountMonogram(name)}
          </span>
          <span className="user-chip-name">{shortAccountLabel(name)}</span>
          <Icon name="chevron" size={14} />
        </>
      }
    >
      <div>
        <p className="user-menu-identity">{name}</p>
        <button onClick={() => d.go("settings")}>用户中心</button>
        <button onClick={() => d.go("projectSettings")}>项目设置</button>
        <button
          disabled={!signedIn}
          title={signedIn ? undefined : "当前没有登录"}
          onClick={() => {
            void (async () => {
              if (grok.signedIn) await grokBridge()?.signOut();
              if (chatgptSignedIn) await official?.connection.signOut();
              window.dispatchEvent(new CustomEvent("aivora-grok-changed"));
              d.go("launch");
            })();
          }}
        >
          退出登录
        </button>
        <button onClick={() => d.go("launch")}>回到欢迎页</button>
      </div>
    </Dropdown>
  );
}
