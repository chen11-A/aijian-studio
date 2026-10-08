import { useState } from "react";
import { Button } from "../Common";
import type { ChatGPTStatus, ChatGPTUseScope } from "./transport";

/** Local eligibility declaration only. Actual account and permissions are verified by OpenAI. */
export function ChatGPTLoginPreparation({
  status,
  busy,
  onBegin,
  onCancel,
  onUseApi,
}: {
  status: ChatGPTStatus;
  busy: boolean;
  onBegin(scope: ChatGPTUseScope): void;
  onCancel(): void;
  onUseApi?: () => void;
}) {
  const [scope, setScope] = useState<ChatGPTUseScope | "">("");
  const [consent, setConsent] = useState(false);
  return (
    <div className="chatgpt-consent" aria-label="官方登录授权说明">
      <label>
        软件使用方式（接入资格）
        <select
          aria-label="软件使用方式（接入资格）"
          aria-describedby="chatgpt-eligibility-help"
          value={scope}
          disabled={busy}
          onChange={(event) => setScope(event.target.value as ChatGPTUseScope | "")}
        >
          <option value="">请确认这款软件的使用方式</option>
          <option value="LOCAL_PERSONAL">我自己使用的个人本地项目</option>
          <option value="OPEN_SOURCE">符合官方开源接入条件的项目</option>
          <option value="APPROVED_PRIVATE">已获 OpenAI 接入批准的私有应用</option>
        </select>
      </label>
      <p id="chatgpt-eligibility-help">
        这里说明你如何使用 AIVORA，用于核对官方接入资格。ChatGPT
        套餐和账号权限会在官方授权页另行确认。
      </p>
      <p>
        将打开这台电脑的系统浏览器，由你向 OpenAI 登录并审阅权限。AIVORA
        会获取账号标识和邮箱，申请套餐使用及刷新权限，并在本机加密保存凭据。此次不发送剧本，也不调用模型。
      </p>
      <label className="chatgpt-checkbox">
        <input
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(event) => setConsent(event.target.checked)}
        />
        我确认上述使用方式符合接入条件，并同意本机加密保存登录凭据。
      </label>
      <p className="chatgpt-browser-help">
        如果官方网页打不开，请先排查这台电脑的浏览器连接。恢复访问后，再回来手动开始一次登录；更换这里的选项不能解决网页连接问题。
      </p>
      <div className="chatgpt-actions">
        <Button
          primary
          disabled={
            busy ||
            !scope ||
            !consent ||
            status.runtime !== "DESKTOP" ||
            status.secureStorage !== "AVAILABLE"
          }
          onClick={() => {
            if (scope) onBegin(scope);
          }}
        >
          {busy ? "等待官方网页返回…" : "在系统浏览器中授权"}
        </Button>
        <Button onClick={onCancel}>{busy ? "取消登录" : "返回"}</Button>
        {onUseApi && !busy && <Button onClick={onUseApi}>跳过，使用 API</Button>}
      </div>
    </div>
  );
}
