import type { FilmProject } from "../../film/project";
import type { AgentReply } from "../workflow";
import { editorAgentContext, type EditorSelection } from "./editor-context";

/** Wrap only global writer/art actions. The original context remains the full task input;
 * selected text is supplemental and is captured now, never read again during a retry. */
export function globalEditorRequest<Role extends "writer" | "art">(
  film: FilmProject,
  selection: EditorSelection,
  request: (agent: Role, context: string, instruction: string) => Promise<AgentReply>,
) {
  const projected = editorAgentContext(film, selection);
  if (!projected.ok) return projected;
  // Serialize the explicit provider whitelist, not the media-bearing editor snapshot.
  const artContext = {
    taskScope: "project",
    selectionScope: "supplemental",
    ...projected.context,
  };
  const scene = projected.context.scene;
  const writerContext = {
    ...artContext,
    // The full manuscript is already present in the original writer input.
    scene: scene ? { id: scene.id, title: scene.title, where: scene.where } : null,
    shots: projected.context.selectedShotId ? projected.context.shots : [],
  };
  const supplements = { writer: JSON.stringify(writerContext), art: JSON.stringify(artContext) };
  return {
    ok: true as const,
    request: (agent: Role, context: string, instruction: string): Promise<AgentReply> =>
      request(
        agent,
        `${context}\n\n编辑器选中内容（仅补充参考）：\n${supplements[agent]}\n本次任务和输出、写入范围仍为全项目；不得因选中场景或镜头而省略其他原文、人物、场景。选中内容不替代上方完整任务输入。`,
        instruction,
      ),
  };
}
