import { Button } from "./Common";
import {
  useOfficialTextProposals,
  sameBase,
  type OfficialTextPanelProps,
} from "./useOfficialTextProposals";
import "./official-text-proposals.css";

export function OfficialTextProposalPanel(props: OfficialTextPanelProps) {
  const { base, disabled } = props;
  const {
    bridge,
    operations,
    readState,
    models,
    model,
    setModel,
    modelSource,
    modelVerified,
    restoreDefaultModel,
    preferenceError,
    text,
    setText,
    instructions,
    setInstructions,
    notice,
    catalogNotice,
    catalogStatusFailed,
    reloadAccount,
    busy,
    unknown,
    reload,
    loadModels,
    generate,
    adopt,
  } = useOfficialTextProposals(props);
  return (
    <details className="official-text-panel">
      <summary>官方 ChatGPT 文本建议</summary>
      <p>
        仅发送你在下方填写的文本和指令。系统会逐次确认套餐使用；结果先保存为建议，采纳后追加一个待编排场次，不会确认剧本。
      </p>
      {!bridge && <p role="status">请在桌面版使用官方 ChatGPT 连接。</p>}
      {disabled && !busy && <p role="status">请先保存或舍弃当前剧本修改，并完成待核对操作。</p>}
      {readState === "loading" && <p role="status">正在读取本集建议…</p>}
      {readState === "error" && bridge && <p role="alert">建议状态无法核实，已暂停生成与采纳。</p>}
      {unknown && <p role="alert">本集有发送结果未知的操作。未自动重试，已阻止新生成。</p>}
      <Button disabled={!bridge || disabled || busy} onClick={() => void reload()}>
        只读核对建议
      </Button>
      <Button disabled={!bridge || disabled || busy} onClick={() => void loadModels()}>
        读取官方可用模型
      </Button>
      <label>
        官方模型
        <select
          value={model}
          disabled={disabled || busy || !models.length}
          onChange={(event) => setModel(event.target.value)}
        >
          <option value="">先读取当前账号模型</option>
          {models.map((item) => (
            <option key={item.slug} value={item.slug}>
              {item.displayName}
            </option>
          ))}
        </select>
      </label>
      {modelSource === "project" && (
        <Button disabled={busy} onClick={() => restoreDefaultModel()}>
          恢复服务默认模型
        </Button>
      )}
      <p role="status">
        {modelSource === "project"
          ? "本项目已覆盖默认模型"
          : modelSource === "default"
            ? "使用 AI 服务页默认模型"
            : "尚未选择官方文本模型"}
        {!modelVerified && modelSource !== "none" ? " · 待核对当前账号目录" : ""}
      </p>
      {preferenceError && <p role="alert">模型偏好未能安全保存，请核对本机存储。</p>}
      <label>
        此次发送的文本
        <textarea
          value={text}
          maxLength={100_000}
          disabled={disabled || busy}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <label>
        补充指令（可选）
        <textarea
          value={instructions}
          maxLength={20_000}
          disabled={disabled || busy}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </label>
      <Button
        primary
        disabled={
          !bridge ||
          disabled ||
          busy ||
          unknown ||
          readState !== "ready" ||
          !modelVerified ||
          !text.trim()
        }
        onClick={() => void generate()}
      >
        审阅并生成一次建议
      </Button>
      {notice && <p role="status">{notice}</p>}
      {catalogNotice && <p role="status">{catalogNotice}</p>}
      {catalogStatusFailed && (
        <Button disabled={busy} onClick={() => void reloadAccount()}>
          重新读取官方账号状态
        </Button>
      )}
      {readState === "ready" && !operations.length && <p>本集还没有官方文本建议。</p>}
      {operations.map((operation) => (
        <article key={operation.request.operation_id}>
          <p>
            {operation.request.model} ·{" "}
            {operation.status === "COMPLETED"
              ? operation.adoption
                ? "已采纳为草稿"
                : "待采纳建议"
              : operation.status === "NOT_SENT"
                ? "未发送"
                : "远端结果未知"}
          </p>
          <p className="official-text-identity">
            操作：{operation.request.operation_id}
            <br />
            基准：{operation.request.base?.version_id ?? "无已保存剧本"}
          </p>
          <details>
            <summary>查看此次输入与指令</summary>
            <p className="official-text-result">{operation.request.input_text}</p>
            <p className="official-text-result">{operation.request.instructions ?? "无补充指令"}</p>
          </details>
          {operation.proposal && (
            <>
              <p className="official-text-identity">
                建议版本：{operation.proposal.version_id}
                <br />
                {operation.proposal.content_hash}
              </p>
              <p className="official-text-result">{operation.proposal.result.text}</p>
              {operation.adoption ? (
                <p className="official-text-identity">
                  已创建剧本草稿：{operation.adoption.script_version_id}
                </p>
              ) : (
                <>
                  {!sameBase(base, operation.request.base) && (
                    <p>此建议的剧本基准已过期；不能覆盖当前剧本。</p>
                  )}
                  <Button
                    disabled={
                      disabled ||
                      busy ||
                      readState !== "ready" ||
                      !sameBase(base, operation.request.base)
                    }
                    onClick={() => void adopt(operation)}
                  >
                    确认将此建议追加为新剧本草稿
                  </Button>
                </>
              )}
            </>
          )}
        </article>
      ))}
      {operations.length === 10 && <p>这里只显示最近十条本集记录，旧产物仍保留。</p>}
    </details>
  );
}
