import type { OfficialDirectorOperation } from "@aijian/contracts/official-director";
import { OfficialDirectorInputProof } from "./OfficialDirectorInputProof";
import { OfficialDirectorPlainText } from "./OfficialDirectorPlainText";

export function OfficialDirectorOperationEvidence({
  operation,
}: {
  operation: OfficialDirectorOperation;
}) {
  const issues = operation.proposal
    ? [...operation.proposal.content.issues, ...operation.proposal.capability_losses]
    : [];
  return (
    <>
      <details className="official-director-proof">
        <summary>供应商响应、版本与操作身份</summary>
        <p>操作：{operation.request.operation_id}</p>
        <p>请求摘要：{operation.request.request_hash}</p>
        <p>
          请求模型：{operation.request.model} · 账号身份：{operation.request.profile_id}
        </p>
        <p>供应商响应：{operation.completion?.response_id ?? "尚无已确认响应"}</p>
        {operation.proposal && (
          <p>
            提案：{operation.proposal.version_id} · {operation.proposal.content_hash} · AI 来源
          </p>
        )}
        <p>错误码：{operation.error_code ?? "无"}</p>
        <OfficialDirectorPlainText title="此次实际发送的输入" text={operation.request.input_text} />
        <OfficialDirectorPlainText
          title="此次实际发送的指令"
          text={operation.request.instructions}
        />
        {operation.completion && (
          <OfficialDirectorPlainText
            title="供应商原始响应（只读）"
            text={operation.completion.text}
          />
        )}
        <OfficialDirectorInputProof
          key={operation.request.operation_id}
          input={operation.request}
          historical
        />
      </details>
      {operation.validation_issues.length > 0 && (
        <ul className="official-director-issues" aria-label="供应商输出校验问题">
          {operation.validation_issues.map((issue, index) => (
            <li key={`${issue.code}:${index}`}>
              {issue.code}：{issue.message}
            </li>
          ))}
        </ul>
      )}
      {issues.length > 0 && (
        <ul className="official-director-issues" aria-label="提案问题与能力损失">
          {issues.map((issue, index) => (
            <li key={`${issue.code}:${index}`}>
              {issue.severity === "BLOCKING" ? "阻断" : "提示"} · {issue.code}：{issue.message}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
