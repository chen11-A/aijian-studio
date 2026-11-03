export interface AudioAsset {
  id: string; path: string; type: 'sfx' | 'music'; category: string; name: string;
  tags: string[]; scene: string; duration: number; loop: boolean; loudness: number;
  source: string; license: string;
}
export interface Shot { duration: number; hasDialogue: boolean; actions: { time: number; label?: string }[]; description?: string }
export interface Scene { emotions: string[]; description: string; duration: number; shots: Shot[]; previousMusicId?: string }
export interface Cue { assetId: string; path: string; time: number; end: number; gainDb: number; reason: string }
export interface Selection {
  music: null | { assetId: string; path: string; start: number; end: number; sourceStart: number; fadeIn: number; fadeOut: number; loop: boolean; ducking: { start: number; end: number; gainDb: number }[] };
  shots: { index: number; ambience: Cue[]; effects: Cue[] }[];
  reason: string;
}
const ambient = ['雨', '风', '雷', '虫鸣', '街道', '室内', '人群', '海浪', '森林', '环境'];
const quiet = ['安静', '沉默', '克制', '独白'];
function score(asset: AudioAsset, text: string): number {
  return [...new Set([asset.category, asset.name, ...asset.tags])].filter(x => x && text.includes(x)).reduce((n, x) => n + x.length, 0);
}
function choose(assets: AudioAsset[], text: string): AudioAsset | undefined {
  return assets.map(a => ({ a, score: score(a, text) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.a.id.localeCompare(b.a.id))[0]?.a;
}
/** 所有时间均为秒；镜头音效时间相对镜头，配乐与压低区间相对整场。 */
export function pickAudio(scene: Scene, library: AudioAsset[]): Selection {
  if (!Number.isFinite(scene.duration) || scene.duration <= 0 || scene.shots.length === 0) throw new Error('场景时长和镜头不能为空');
  let total = 0;
  for (const shot of scene.shots) {
    if (!Number.isFinite(shot.duration) || shot.duration <= 0 || shot.actions.some(a => !Number.isFinite(a.time) || a.time < 0 || a.time > shot.duration)) throw new Error('镜头时长或动作时间不正确');
    total += shot.duration;
  }
  if (Math.abs(total - scene.duration) > 0.01) throw new Error('镜头总时长与场景时长不一致');
  const assets = library.filter(a => a.duration > 0 && Number.isFinite(a.duration) && ['CC0', 'Public Domain', '公有领域', 'CC0-1.0'].includes(a.license));
  const text = [...scene.emotions, scene.description].join(' ');
  const silent = quiet.some(x => text.includes(x)) && !scene.emotions.some(x => ['打斗', '紧张', '史诗'].includes(x));
  const track = silent ? undefined : choose(assets.filter(a => a.type === 'music' && a.id !== scene.previousMusicId && (a.loop || a.duration >= scene.duration)), text);
  let offset = 0;
  const ducking: { start: number; end: number; gainDb: number }[] = [];
  const shots = scene.shots.map((shot, index) => {
    if (shot.hasDialogue) ducking.push({ start: offset, end: offset + shot.duration, gainDb: -12 });
    offset += shot.duration;
    const context = `${scene.description} ${shot.description ?? ''}`;
    const backgrounds = assets.filter(a => a.type === 'sfx' && ambient.some(x => a.category.includes(x)));
    const bed = choose(backgrounds, context);
    const ambience: Cue[] = bed ? [{ assetId: bed.id, path: bed.path, time: 0, end: Math.min(shot.duration, bed.duration), gainDb: shot.hasDialogue ? -12 : -6, reason: '环境关键词匹配' }] : [];
    const effects: Cue[] = [];
    for (const action of shot.actions) {
      const effect = choose(assets.filter(a => a.type === 'sfx' && !backgrounds.includes(a)), action.label || `${text} ${shot.description ?? ''}`);
      if (effect && action.time < shot.duration) effects.push({ assetId: effect.id, path: effect.path, time: action.time, end: Math.min(shot.duration, action.time + effect.duration), gainDb: shot.hasDialogue ? -6 : 0, reason: '音效对准动作节点' });
    }
    return { index: index + 1, ambience, effects };
  });
  return { music: track ? { assetId: track.id, path: track.path, start: 0, end: scene.duration, sourceStart: 0, fadeIn: Math.min(1, scene.duration / 4), fadeOut: Math.min(1.5, scene.duration / 4), loop: track.loop && track.duration < scene.duration, ducking } : null, shots, reason: track ? '按情绪选择配乐，台词区间压低十二分贝' : silent ? '安静情绪保留留白' : '没有合适且不与上一场重复的配乐' };
}
