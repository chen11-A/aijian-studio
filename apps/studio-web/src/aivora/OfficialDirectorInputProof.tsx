import { useState } from "react";
import type { OfficialDirectorOperation } from "@aijian/contracts/official-director";
import type { ShotPlanPreparation } from "@aijian/contracts/shot-plan";

/** Historical bytes belong to that operation, never to whatever script is current now. */
export function OfficialDirectorInputProof({
  input,
  historical = false,
}: {
  input: ShotPlanPreparation | OfficialDirectorOperation["request"];
  historical?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const authority = input.authority;
  return (
    <details
      className="official-director-proof"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {historical ? "此次生成的精确输入与确认凭据" : "当前已确认剧本与制作意图凭据"}
      </summary>
      <p>剧本确认：{authority.script.confirmation_id}</p>
      <p>
        剧本：{authority.script.version_id} · {authority.script.content_hash} · 修订{" "}
        {authority.script.head_revision}
      </p>
      <p>
        制作意图：{authority.production_brief.version_id} ·{" "}
        {authority.production_brief.content_hash}
      </p>
      <p>
        分镜基准：
        {input.storyboard_base
          ? `${input.storyboard_base.version_id} · ${input.storyboard_base.content_hash} · 修订 ${input.storyboard_base.head_revision}`
          : "尚无已保存分镜"}
      </p>
      {authority.mode === "ADAPTED" && (
        <p>
          已采纳来源：{authority.source_proposal_acceptance_id} ·{" "}
          {authority.source_extraction.version_id} · {authority.source_extraction.content_hash}
        </p>
      )}
      {open && (
        <>
          <details>
            <summary>只读剧本原始内容</summary>
            <pre>{JSON.stringify(input.script_stored_content, null, 2)}</pre>
          </details>
          <details>
            <summary>只读制作意图原始内容</summary>
            <pre>{JSON.stringify(input.production_brief_stored_content, null, 2)}</pre>
          </details>
        </>
      )}
    </details>
  );
}
