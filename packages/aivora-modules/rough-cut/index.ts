export interface WordTimestamp { text: string; start: number; end: number }
export interface RoughCutShot { id: string; duration: number; words: WordTimestamp[]; actionNodes: number[] }
export interface RoughCutOptions { beforeDialogue?: number; afterDialogue?: number }
export interface ShotCut { id: string; inPoint: number; outPoint: number; duration: number; inReason: string; outReason: string }

/** 输入、输出时间均为镜头素材内的秒数；不会重排镜头。 */
export function roughCut(shots: RoughCutShot[], options: RoughCutOptions = {}): ShotCut[] {
  const before = options.beforeDialogue ?? 0.3;
  const after = options.afterDialogue ?? 0.45;
  if (!Number.isFinite(before) || before < 0.2 || before > 0.4 || !Number.isFinite(after) || after < 0.3 || after > 0.6)
    throw new Error('台词前留白须为 0.2 到 0.4 秒，台词后留白须为 0.3 到 0.6 秒');
  const seen = new Set<string>();
  return shots.map(shot => {
    if (!shot.id || seen.has(shot.id)) throw new Error('镜头编号不能为空或重复');
    seen.add(shot.id);
    if (!Number.isFinite(shot.duration) || shot.duration <= 0) throw new Error(`镜头 ${shot.id} 的时长无效`);
    for (const word of shot.words) {
      if (!word.text.trim() || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < 0 || word.end <= word.start || word.end > shot.duration)
        throw new Error(`镜头 ${shot.id} 的逐字时间无效`);
    }
    for (const time of shot.actionNodes) {
      if (!Number.isFinite(time) || time < 0 || time > shot.duration) throw new Error(`镜头 ${shot.id} 的动作时间无效`);
    }
    if (!shot.words.length && !shot.actionNodes.length) return { id: shot.id, inPoint: 0, outPoint: shot.duration, duration: shot.duration, inReason: '没有台词或动作节点，保留镜头开头', outReason: '没有台词或动作节点，保留完整镜头' };
    // 同时保留所有台词和动作节点，防止粗剪漏掉有台词镜头中的关键动作。
    const starts = [...shot.words.map(word => word.start), ...shot.actionNodes];
    const ends = [...shot.words.map(word => word.end), ...shot.actionNodes];
    const first = Math.min(...starts);
    const last = Math.max(...ends);
    const inPoint = Math.max(0, first - before);
    const outPoint = Math.min(shot.duration, last + after);
    const subject = shot.words.length ? '台词与关键动作' : '关键动作';
    return { id: shot.id, inPoint, outPoint, duration: outPoint - inPoint,
      inReason: first < before ? `${subject}紧邻素材开头，保留开头；前留白不足 ${before} 秒，请补充素材` : `${subject}前保留 ${before} 秒准备时间`,
      outReason: last + after > shot.duration ? `${subject}紧邻素材结尾，保留结尾；后留白不足 ${after} 秒，请补充素材` : `${subject}后保留 ${after} 秒反应时间`,
    };
  });
}
