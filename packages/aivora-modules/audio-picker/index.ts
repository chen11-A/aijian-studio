import { concepts } from './synonyms.js';
export interface AudioAsset {
  id: string; path: string; type: 'sfx' | 'music'; category: string; name: string;
  tags: string[]; scene: string; duration: number; loop: boolean; loudness: number | null;
  source: string; license: string; author?: string; loopable?: boolean; loudnessNote?: string;
}
export interface Shot { duration: number; hasDialogue: boolean; actions: { time: number; label?: string }[]; description?: string }
export interface Scene { emotions: string[]; description: string; duration: number; shots: Shot[]; previousMusicId?: string }
export interface Segment { assetId: string; path: string; time: number; end: number; sourceStart: number; fadeIn: number; fadeOut: number }
export interface Cue { assetId: string; path: string; time: number; end: number; gainDb: number; reason: string; loop: boolean; segments: Segment[] }
export interface Selection {
  music: null | { assetId: string; path: string; start: number; end: number; sourceStart: number; fadeIn: number; fadeOut: number; loop: boolean; segments: Segment[]; ducking: { start: number; end: number; gainDb: number }[] };
  shots: { index: number; ambience: Cue[]; effects: Cue[] }[];
  reason: string; warnings: string[];
}
const quiet = ['安静', '沉默', '克制', '独白'];
function score(asset: AudioAsset, text: string): number {
  const words = [...new Set([asset.category, asset.name, ...asset.tags])];
  return words.filter(x => x && text.includes(x)).reduce((n, x) => n + x.length, 0);
}
function choose(assets: AudioAsset[], text: string): AudioAsset[] {
  return assets.map(a => ({ a, score: score(a, text) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.a.id.localeCompare(b.a.id)).map(x => x.a);
}
/** 重复已验证循环时无交叠；其他短素材采用交叉淡化重复/接曲，渲染方按片段执行。 */
export function fillDuration(assets: AudioAsset[], duration: number): Segment[] {
  if (!assets.length || !Number.isFinite(duration) || duration <= 0 || assets.some(a => !Number.isFinite(a.duration) || a.duration <= 0)) throw new Error('铺底素材和时长必须有效');
  const segments: Segment[] = [];
  let time = 0, index = 0;
  while (time < duration - 1e-8) {
    if (segments.length >= 10000) throw new Error('铺底片段过多，请使用更长的素材');
    const a = assets[index % assets.length];
    const end = Math.min(duration, time + a.duration);
    const crossfade = a.loop ? 0 : Math.min(.5, a.duration / 4, assets[(index + 1) % assets.length].duration / 4);
    segments.push({ assetId: a.id, path: a.path, time, end, sourceStart: 0, fadeIn: index === 0 ? 0 : segments[index - 1].fadeOut, fadeOut: end >= duration ? 0 : crossfade });
    if (end >= duration) break;
    time = end - crossfade;
    index++;
  }
  return segments;
}
function monitorState(text: string): 'steady' | 'accelerating' | 'continuous' | undefined {
  if (/停搏|死亡|长鸣|持续鸣|心脏停止|心跳停止/.test(text)) return 'continuous';
  if (/心率.{0,4}加快|心跳.{0,4}加快|加速|心率升高|心率过快/.test(text)) return 'accelerating';
  if (/规律|正常|平稳|稳定/.test(text)) return 'steady';
  return undefined;
}
function effectFor(assets: AudioAsset[], label: string, context: string): AudioAsset | undefined {
  const keys = concepts(label);
  // 具体动作优先：拖地不能选击打，划伤可退到明确刀挥砍，但不选择厨刀刮擦。
  const preferred = keys.includes('钢管拖地') ? ['钢管拖地'] : keys.includes('刀划伤') ? ['刀划伤', '刀挥砍'] : keys;
  if (!preferred.length) return choose(assets, label)[0];
  let matches = assets.filter(a => preferred.some(key => a.tags.includes(key) || a.category === key));
  if (keys.includes('心电监护仪')) {
    const requested = monitorState(label) ?? monitorState(context) ?? 'steady';
    const stateOf = (a: AudioAsset) => monitorState([a.name, ...a.tags].join(' '));
    const stateMatches = matches.filter(a => stateOf(a) === requested);
    // 普通医院场景不能默认长鸣；明确异常状态缺素材时告缺，不拿相反状态替代。
    matches = stateMatches.length ? stateMatches : requested === 'steady' ? matches.filter(a => stateOf(a) === undefined) : [];
  }
  if (keys.includes('脚步')) {
    const wet = /雨|湿/.test(context), hard = /医院|病房|走廊|水泥|小巷|街道/.test(context);
    if (wet && matches.some(a => a.tags.includes('湿地面脚步'))) matches = matches.filter(a => a.tags.includes('湿地面脚步'));
    else if (hard) matches = matches.filter(a => a.tags.some(t => ['硬地面', '水泥地', '水泥地奔跑'].includes(t)));
    const running = (a: AudioAsset) => a.tags.some(t => /奔跑|跑步/.test(t));
    if (/奔跑|跑步/.test(label) && matches.some(running)) matches = matches.filter(running);
    else if (!/奔跑|跑步/.test(label) && matches.some(a => !running(a))) matches = matches.filter(a => !running(a));
  }
  return matches.sort((a, b) => {
    const exactA = preferred.findIndex(k => a.tags.includes(k) || a.category === k);
    const exactB = preferred.findIndex(k => b.tags.includes(k) || b.category === k);
    return exactA - exactB || score(b, context + label) - score(a, context + label) || a.id.localeCompare(b.id);
  })[0];
}
function cue(asset: AudioAsset, time: number, end: number, gainDb: number, continuous: boolean, reason: string): Cue {
  const length = continuous ? end - time : Math.min(end - time, asset.duration);
  const segments = fillDuration([asset], length).map(s => ({ ...s, time: s.time + time, end: s.end + time }));
  return { assetId: asset.id, path: asset.path, time, end: time + length, gainDb, reason, loop: segments.length > 1, segments };
}
/** 场景配乐时间相对整场；镜头内音效时间相对该镜头。缺素材明确返回警告。 */
export function pickAudio(scene: Scene, library: AudioAsset[]): Selection {
  if (!Number.isFinite(scene.duration) || scene.duration <= 0 || scene.shots.length === 0) throw new Error('场景时长和镜头不能为空');
  let total = 0;
  for (const shot of scene.shots) {
    if (!Number.isFinite(shot.duration) || shot.duration <= 0 || shot.actions.some(a => !Number.isFinite(a.time) || a.time < 0 || a.time > shot.duration)) throw new Error('镜头时长或动作时间不正确');
    total += shot.duration;
  }
  if (Math.abs(total - scene.duration) > 0.01) throw new Error('镜头总时长与场景时长不一致');
  const assets = library.filter(a => a.duration > 0 && Number.isFinite(a.duration) && ['CC0', 'Public Domain', '公有领域', 'CC0-1.0'].includes(a.license));
  const text = [...scene.emotions, scene.description].join(' '), warnings: string[] = [];
  const silent = quiet.some(x => text.includes(x)) && !scene.emotions.some(x => ['打斗', '紧张', '史诗'].includes(x));
  const previous = library.find(a => a.id === scene.previousMusicId);
  const tracks = silent ? [] : choose(assets.filter(a => a.type === 'music' && a.id !== scene.previousMusicId && (!previous || a.source !== previous.source)), text);
  const track = tracks.find(a => a.loop) ?? tracks[0];
  const musicSegments = track ? fillDuration(track.loop ? [track] : [track, ...tracks.filter(a => a.id !== track.id && a.tags.some(t => track.tags.includes(t)))], scene.duration) : [];
  let offset = 0;
  const ducking: { start: number; end: number; gainDb: number }[] = [];
  const shots = scene.shots.map((shot, index) => {
    if (shot.hasDialogue) ducking.push({ start: offset, end: offset + shot.duration, gainDb: -12 });
    offset += shot.duration;
    const context = `${scene.description} ${shot.description ?? ''}`;
    const query = `${context} ${concepts(context).join(' ')}`;
    const backgrounds = assets.filter(a => a.type === 'sfx' && a.category === '环境');
    const beds = choose(backgrounds, query);
    const hospital = concepts(context).includes('医院底噪');
    const bed = hospital ? beds.find(a => a.tags.includes('医院底噪')) : beds.find(a => a.loop) ?? beds[0];
    const ambience: Cue[] = bed ? [cue(bed, 0, shot.duration, shot.hasDialogue ? -12 : -6, true, '按环境关键词选取并连续铺满镜头')] : [];
    if (!bed && /雨|医院|病房|街道|小巷/.test(context)) warnings.push(`第${index + 1}镜头缺少匹配的环境音，请补充真实素材`);
    const effects: Cue[] = [];
    const effectsAssets = assets.filter(a => a.type === 'sfx' && a.category !== '环境');
    for (const action of shot.actions) {
      if (action.time >= shot.duration) continue;
      const label = action.label || `${text} ${shot.description ?? ''}`;
      const effect = effectFor(effectsAssets, label, context);
      if (effect) effects.push(cue(effect, action.time, shot.duration, shot.hasDialogue ? -6 : 0, false, '音效对准动作节点'));
      else warnings.push(`第${index + 1}镜头第${action.time}秒缺少“${label}”对应音效`);
    }
    // 描述中的设备声音即使没有动作节点也会安排；已经明确安排的同类动作不重复。
    for (const key of ['手机震动', '心电监护仪']) if (concepts(context).includes(key) && !shot.actions.some(a => concepts(a.label ?? '').includes(key))) {
      const effect = effectFor(effectsAssets, key, context);
      if (effect) effects.push(cue(effect, 0, shot.duration, shot.hasDialogue ? -6 : 0, key === '心电监护仪', '根据场景设备安排声音'));
      else warnings.push(`第${index + 1}镜头缺少“${key}”素材`);
    }
    return { index: index + 1, ambience, effects };
  });
  return { music: track ? { assetId: track.id, path: track.path, start: 0, end: scene.duration, sourceStart: 0, fadeIn: Math.min(1, scene.duration / 4), fadeOut: Math.min(1.5, scene.duration / 4), loop: musicSegments.some((s, i) => musicSegments.slice(0, i).some(p => p.assetId === s.assetId)), segments: musicSegments, ducking } : null, shots, warnings, reason: track ? '按情绪配乐，循环或接曲铺满场景，台词区间压低十二分贝' : silent ? '安静情绪保留留白' : '没有合适且不与上一场重复的配乐' };
}
