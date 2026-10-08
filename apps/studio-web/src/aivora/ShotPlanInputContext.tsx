import type { ShotPlanContent, ShotPlanPreparation } from "@aijian/contracts/shot-plan";

/** Read-only creative inputs; React text nodes never interpret source text as markup. */
export function ShotPlanInputContext({
  preparation,
  draft,
}: {
  preparation: ShotPlanPreparation;
  draft: ShotPlanContent | null;
}) {
  const brief = preparation.production_brief_content;
  const entry = brief.creative_entry;
  const constraints = draft?.visual_constraints ?? brief.creative.constraints;
  return (
    <section className="shot-plan-block-choices" aria-label="导演提案制作输入">
      <p>当前制作意图：{brief.creative.intent}</p>
      <p>创意前提：{brief.creative.premise}</p>
      <p>
        {entry.kind === "original_idea" ? "原创入口" : "改编入口"}：
        {entry.kind === "original_idea" ? entry.origin_statement : entry.adaptation_statement}
      </p>
      {entry.kind === "source_adaptation" && (
        <p>
          来源文档：{entry.source_document_id} · {entry.source_block_ids.length} 个声明来源块
        </p>
      )}
      <div>
        <p>{draft ? "本提案保留的视觉约束" : "当前制作意图的视觉约束"}：</p>
        {constraints.length ? (
          <ul aria-label="视觉约束">
            {constraints.map((constraint, index) => (
              <li key={index}>{constraint}</li>
            ))}
          </ul>
        ) : (
          <p>未声明视觉约束。</p>
        )}
      </div>
    </section>
  );
}
