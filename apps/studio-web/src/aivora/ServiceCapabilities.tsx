import { useState } from "react";
import type { ProviderSettingsState } from "../domain/use-provider-settings";
import {
  assessCapabilities,
  assessChatGPTConnection,
  assessConfiguredConnection,
  capabilityTitles,
  readinessLabels,
} from "../domain/ai-capability-readiness";
import type { useChatGPTConnection } from "./chatgpt-auth/useChatGPTConnection";
import { Button } from "./Common";
import "./service-capabilities.css";

export function ServiceCapabilities({
  chatGPT,
  providers,
  onReloadProviders,
  onOpenProjects,
}: {
  chatGPT: ReturnType<typeof useChatGPTConnection>;
  providers: ProviderSettingsState;
  onReloadProviders: () => Promise<void>;
  onOpenProjects: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const official = assessChatGPTConnection(chatGPT);
  const rows = assessCapabilities(official, providers);
  const reading = chatGPT.loading || chatGPT.busy || providers.kind === "loading";
  return (
    <section className="v2-utility-card service-capabilities" aria-label="账号与能力检查">
      <header>
        <div>
          <h2>账号与能力检查</h2>
          <p>本地准备检查 · 不发送作品，不试生成，不消耗生成额度。</p>
        </div>
        <Button
          disabled={reading}
          onClick={() => {
            setChecked(false);
            void chatGPT.load();
            void onReloadProviders();
          }}
        >
          重新读取连接状态
        </Button>
      </header>
      <p>
        <strong>ChatGPT：</strong>
        <span>{readinessLabels[official]}</span>
      </p>
      <p>剩余额度：未知。登录和模型目录尚未验证真实推理。</p>
      {providers.kind !== "ready" && (
        <p>
          {providers.kind === "loading"
            ? "API 连接目录读取中，尚不能确认全部配置。"
            : "API 连接目录读取失败，不能按没有账号处理。请重新读取。"}
        </p>
      )}
      <p>文本：{rows[0].label}。图片、视频和配音自动生成尚未接入。</p>
      <details>
        <summary>查看能力详情与接入边界</summary>
        <dl className="service-capability-grid">
          {rows.map((row) => (
            <div key={row.capability}>
              <dt>{capabilityTitles[row.capability]}</dt>
              <dd>
                <strong>{row.label}</strong>
                <p>{row.detail}</p>
                {row.configuredSources.length > 0 && (
                  <p>
                    已登记候选：{row.configuredSources.map((source) => source.label).join("、")}
                    （仅配置记录）
                  </p>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </details>
      <details>
        <summary>查看账号、费用与兼容说明</summary>
        {providers.kind === "ready" && providers.response.data.length > 0 && (
          <ul aria-label="各连接本地状态">
            {providers.response.data.map((connection) => (
              <li key={connection.id}>
                {connection.display_name}：{readinessLabels[assessConfiguredConnection(connection)]}
                {connection.provider_kind === "XAI"
                  ? "。这是 xAI API 配置，不是 SuperGrok 订阅登录。"
                  : ""}
              </li>
            ))}
          </ul>
        )}
        <p>
          Grok 订阅登录尚未接入：需先确认 AIVORA 的 OAuth
          接入资格及账号权限。不会借用其他应用身份，也不会把 xAI API Key 当作会员登录。
        </p>
        <ul>
          <li>
            只有 GPT：准备剧本和分镜，导入外部素材后合成；不能由当前套餐通道自动生成视频镜头。
          </li>
          <li>只有 Grok：接入并验证后可由它承担文本与媒体；现阶段不能据此承诺本机已支持。</li>
          <li>两个都有：目标分工为 GPT 策划、Grok 生成媒体；当前不自动分配或切换账号。</li>
          <li>
            其他会员：按官方授权通道分别适配。API
            兼容不等于订阅兼容；不支持的服务可先在外部生成并导入。
          </li>
        </ul>
        <p>
          费用边界：不自动购买额度或切换付费 API。OAuth
          仍可能使用服务端额外余额或自动充值；无法确认只用套餐额度时，不应开始生成。
        </p>
        <p>
          这里只读取本地授权和配置，不验证服务端权限、余额或作品素材；实际调用仍需在对应入口确认。本页没有生成或费用设置写入操作。
        </p>
      </details>
      <div className="service-capability-actions">
        <Button disabled={reading} onClick={() => setChecked(true)}>
          检查自动出片准备
        </Button>
        <Button onClick={onOpenProjects}>进入项目准备剧本或导入素材</Button>
      </div>
      {checked && (
        <div className="service-capability-result" role="status">
          <strong>自动出片尚未就绪</strong>
          <p>
            {rows[0].label}
            。当前图片、视频自动生成链路尚未接入；配音按作品需要另行准备。已配置模型不能解除此限制。
          </p>
          <p>
            可以先准备剧本并导入自有或外部生成的素材。本次仅检查连接层，不代表项目素材、预算或导出检查已通过。
          </p>
        </div>
      )}
    </section>
  );
}
