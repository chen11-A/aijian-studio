export const versionRoleLabels = {
  latest: "最新稿",
  review: "审阅中",
  accepted: "已通过",
} as const;

export type VersionRole = keyof typeof versionRoleLabels;

export function versionRoleLabel(role: VersionRole): string {
  return versionRoleLabels[role];
}

export const factKindShortLabels: Record<string, string> = {
  character: "人物",
  location: "场景",
  organization: "组织",
  relationship: "关系",
  event: "事件",
  world_rule: "世界规则",
  prop: "道具",
  costume: "服装",
};

export const factImportanceLabels: Record<string, string> = {
  core: "核心",
  supporting: "辅助",
  detail: "细节",
};

export const factOriginLabels: Record<string, string> = {
  source_explicit_assertion: "原文明确写出",
  source_interpretation: "根据原文理解",
  user_decision: "人工决定",
  ai_inference: "AI 推断",
};

export const certaintyLabels: Record<string, string> = {
  certain: "确定",
  likely: "较可能",
  ambiguous: "不明确",
  intentionally_unreliable: "故意不可靠",
};

export const reliabilityLabels: Record<string, string> = {
  reliable: "可靠",
  uncertain: "不确定",
  unreliable: "不可靠",
  not_applicable: "不适用",
};

export const severityLabels: Record<string, string> = {
  low: "低",
  minor: "次要",
  medium: "中",
  major: "重要",
  high: "高",
  critical: "严重",
};

export const conflictStatusLabels: Record<string, string> = {
  open: "未解决",
  unresolved: "未解决",
  resolved: "已解决",
  resolved_by_user_decision: "已由人工决定",
  deferred: "暂缓",
  waived: "已豁免",
};

export const scopeTypeLabels: Record<string, string> = {
  fact: "设定",
  entity: "人物/场景",
  source_document: "原文",
  artifact: "整份设定",
};

export function displayLabel(map: Record<string, string>, value: string): string {
  return map[value] ?? value;
}

export function factKindLabel(kind: string): string {
  return factKindShortLabels[kind.replace(/_fact$/, "")] ?? kind;
}
