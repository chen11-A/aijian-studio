import type { ProviderSettingsState } from "../domain/use-provider-settings";
import { pages } from "./data";
import { useDemo } from "./model";
import { Button } from "./Common";
import { selectProductionSourceStage } from "./adapters/productionSourceStage";

export function assistantServiceLabel(state: ProviderSettingsState): string {
  if (state.kind === "loading") return "正在读取服务配置";
  if (state.kind === "error") return "服务配置读取失败";
  return state.response.data.length
    ? `已配置 ${state.response.data.length} 个 · 能力未验证`
    : "尚未配置 AI 服务";
}

export function AssistantServiceStatus() {
  const d = useDemo();
  const state = d.providerSettings.state;
  const connections = state.kind === "ready" ? state.response.data : [];
  const candidates = connections.filter(
    (item) =>
      ["SUB2API", "CPA_LOOPBACK"].includes(item.provider_kind) &&
      item.enabled &&
      item.credential_status === "CONFIGURED" &&
      item.models.some((model) => model.capabilities.includes("TEXT")),
  );
  return (
    <section className="v2-ai-detail" aria-label="真实服务配置">
      <h3>服务配置</h3>
      {state.kind === "loading" && <p role="status">正在读取本地连接目录…</p>}
      {state.kind === "error" && <p role="alert">无法读取连接目录，请重新读取或检查 AI 服务页。</p>}
      {state.kind === "ready" && (
        <>
          <p>
            已配置 {connections.length} 个连接，{connections.filter((item) => item.enabled).length}{" "}
            个已启用。
          </p>
          <p>
            已登记的来源提取文本候选：{candidates.length}{" "}
            个。配置记录不证明供应商可连接、模型可用或有授权额度。
          </p>
          <p>调用准备：请在 AI 服务页核对本地配置；供应商连通性与模型能力尚未在此验证。</p>
          {!!connections.length && (
            <details>
              <summary>查看连接与文本配置</summary>
              {connections.map((connection) => (
                <p key={connection.id}>
                  <strong>{connection.display_name}</strong> ·{" "}
                  {connection.enabled ? "已启用" : "已停用"}
                  <br />
                  {connection.credential_status === "CONFIGURED"
                    ? "凭据已配置"
                    : connection.credential_status === "UNAVAILABLE"
                      ? "凭据库不可用"
                      : "无已配置凭据"}
                  {` · ${connection.models.filter((model) => model.capabilities.includes("TEXT")).length} 个 TEXT 模型`}
                </p>
              ))}
            </details>
          )}
        </>
      )}
      <Button onClick={() => d.go("services")}>打开 AI 服务设置</Button>
      <Button disabled={state.kind === "loading"} onClick={() => void d.providerSettings.load()}>
        重新读取服务配置
      </Button>
    </section>
  );
}

export function AssistantContext() {
  const d = useDemo();
  const project = d.projects.find((item) => item.backendId === d.backendProjectId);
  const episode = d.episodes.find(
    (item) => item.id === d.selectedEpisodeId && item.project_id === d.backendProjectId,
  );
  const source =
    d.sourceDocument?.data.project_id === d.backendProjectId ? d.sourceDocument.data : null;
  const manifest =
    d.sourceManifest?.data.project_id === d.backendProjectId ? d.sourceManifest.data : null;
  const sourceStatus = selectProductionSourceStage(d.sourceStage);
  return (
    <section className="v2-ai-detail">
      <h3>当前创作上下文</h3>
      <dl>
        <dt>作品</dt>
        <dd>{project?.name ?? "尚未选择真实作品"}</dd>
        <dt>作品标识</dt>
        <dd>{d.backendProjectId ?? "未选择"}</dd>
        <dt>剧集</dt>
        <dd>{episode?.title ?? "尚未选择真实剧集"}</dd>
        {episode && (
          <>
            <dt>剧集标识</dt>
            <dd>{episode.id}</dd>
          </>
        )}
        <dt>页面</dt>
        <dd>{pages[d.page][0]}</dd>
        <dt>来源文档</dt>
        <dd>{source?.filename ?? "尚未读取来源"}</dd>
        <dt>来源状态</dt>
        <dd>{d.backendProjectId ? sourceStatus.status : "未选择作品"}</dd>
        {manifest && (
          <>
            <dt>最新来源版本</dt>
            <dd>{manifest.latest_version.id}</dd>
            <dt>已接受来源版本</dt>
            <dd>{manifest.accepted_version?.id ?? "尚未接受"}</dd>
          </>
        )}
      </dl>
      {sourceStatus.baselineNote && d.backendProjectId && <p>{sourceStatus.baselineNote}</p>}
      <p>以上仅用于查看。调用输入需在来源提取页明确选择，不会自动附带整部作品或附件。</p>
      <Button disabled={!d.backendProjectId} onClick={() => d.go("project")}>
        返回当前作品
      </Button>
    </section>
  );
}
