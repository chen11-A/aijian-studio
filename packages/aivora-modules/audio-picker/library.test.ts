import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pickAudio, type AudioAsset, type Scene, type Segment } from './index.js';

const libraryRoot = new URL('../../../assets/audio-library/', import.meta.url);
const library = JSON.parse(readFileSync(new URL('manifest.json', libraryRoot), 'utf8')) as AudioAsset[];
const scene = (): Scene => ({
  emotions: ['紧张'], description: '下雨的街上', duration: 10,
  shots: [{ duration: 10, hasDialogue: true, actions: [] }],
});

describe('真实素材库与挑选器联调', () => {
  it('真实素材数量、字段和本地文件合法', () => {
    expect(library.filter(a => a.type === 'music').length).toBeGreaterThanOrEqual(20);
    expect(library.filter(a => a.type === 'sfx').length).toBeGreaterThanOrEqual(60);
    expect(new Set(library.map(a => a.id)).size).toBe(library.length);
    for (const asset of library) {
      expect(['CC0', 'CC0-1.0', 'Public Domain', '公有领域']).toContain(asset.license);
      expect(asset.duration).toBeGreaterThan(0);
      expect(Number.isFinite(asset.loudness) || (asset.loudness === null && asset.duration < 0.4)).toBe(true);
      expect(asset.tags.length).toBeGreaterThan(0);
      expect(asset.source).toMatch(/^https:\/\//);
      expect(asset.name).toMatch(/[\u4e00-\u9fff]/);
      expect(asset.path).toMatch(/\.ogg$/);
      expect(existsSync(new URL(asset.path, libraryRoot))).toBe(true);
    }
  });
  it('两场紧张戏选中真实配乐且相邻不重复', () => {
    const first = pickAudio(scene(), library);
    expect(first.music).not.toBeNull();
    const firstAsset = library.find(a => a.id === first.music!.assetId)!;
    expect(firstAsset.type).toBe('music');
    expect(firstAsset.tags).toContain('紧张');
    const second = pickAudio({ ...scene(), previousMusicId: first.music!.assetId }, library);
    expect(second.music).not.toBeNull();
    expect(second.music!.assetId).not.toBe(first.music!.assetId);
    expect(library.find(a => a.id === second.music!.assetId)?.tags).toContain('紧张');
    expect(second.music!.ducking).toEqual([{ start: 0, end: 10, gainDb: -12 }]);
  });
  it('新真实雨声选中已验证循环，连续铺满超过原素材时长的镜头', () => {
    const input = scene();
    input.duration = 100;
    input.shots[0].duration = 100;
    const result = pickAudio(input, library);
    const rain = result.shots[0].ambience.find(a => library.find(e => e.id === a.assetId)?.tags.includes('真实雨声'))!;
    expect(rain).toBeDefined();
    const asset = library.find(a => a.id === rain.assetId)!;
    expect(asset.path).toMatch(/^fill-gaps\/weather\//);
    expect(asset.tags).toContain('真实雨声');
    expect(asset.loop).toBe(true);
    expect(asset.loopable).toBe(true);
    expect(rain.loop).toBe(true);
    expect(rain.segments.length).toBeGreaterThan(1);
    expectFilled(rain.segments, 100);
    expect(result.warnings.some(w => w.includes('环境音'))).toBe(false);
  });
  it('三条原人群均为可循环实录，存在有来源证据的长循环，并铺满120秒会议厅场景', () => {
    type RecordedAsset = AudioAsset & { recordingVerified: boolean; licensePath: string; loopReport: string; sha256: string };
    const originalIds = ['sfx-crowd-low-1', 'sfx-crowd-low-2', 'sfx-crowd-low-3'];
    for (const id of originalIds) {
      const asset = library.find(a => a.id === id) as RecordedAsset;
      expect(asset).toBeDefined();
      expect(asset).toMatchObject({ loop: true, loopable: true, recordingVerified: true, category: '环境' });
      expect(asset.tags).toContain('人群');
    }
    const long = library.find(a => a.tags.includes('人群') && a.loop && a.loopable && a.duration >= 30 && a.duration <= 60) as RecordedAsset;
    expect(long).toBeDefined();
    expect(long.recordingVerified).toBe(true);
    expect(long.source).toBe('https://freesound.org/people/jentlemen/sounds/432331/');
    expect(long.author).toBe('jentlemen');
    const evidence = readFileSync(new URL(long.licensePath, libraryRoot), 'utf8');
    expect(evidence).toContain(long.source);
    expect(evidence).toContain('Creative Commons 0');
    const report = JSON.parse(readFileSync(new URL(long.loopReport, libraryRoot), 'utf8'));
    expect(report.seam.passed).toBe(true);
    expect(report.outputSha256 ?? report.sha256).toBe(long.sha256);
    expect(createHash('sha256').update(readFileSync(new URL(long.path, libraryRoot))).digest('hex')).toBe(long.sha256);
    const output = pickAudio({ emotions: [], description: '会议厅人群低语', duration: 120, shots: [{ duration: 120, hasDialogue: true, actions: [] }] }, library);
    const bed = output.shots[0].ambience[0];
    expect(bed).toBeDefined();
    expect(library.find(a => a.id === bed.assetId)?.tags).toContain('人群');
    expect(bed.loop).toBe(true);
    expect(bed.gainDb).toBe(-12);
    expectFilled(bed.segments, 120);
    expect(bed.segments.length).toBeGreaterThan(1);
    for (const [index, segment] of bed.segments.entries()) {
      expect(segment.fadeIn).toBe(0);
      expect(segment.fadeOut).toBe(0);
      if (index > 0) expect(segment.time).toBe(bed.segments[index - 1].end);
    }
    expect(output.warnings).toEqual([]);
  });
  it('拳脚打斗的两个节点准确触发真实音效', () => {
    const fight = scene();
    fight.emotions = ['打斗'];
    fight.shots[0].actions = [{ time: 2.25, label: '拳脚' }, { time: 7.5, label: '刀剑打斗' }];
    const effects = pickAudio(fight, library).shots[0].effects;
    expect(effects.map(effect => effect.time)).toEqual([2.25, 7.5]);
    expect(library.find(a => a.id === effects[0].assetId)?.tags).toContain('拳脚');
    expect(library.find(a => a.id === effects[1].assetId)?.tags).toContain('刀挥砍');
    for (const effect of effects) {
      expect(effect.end).toBeGreaterThan(effect.time);
      expect(effect.end).toBeLessThanOrEqual(10);
      expect(existsSync(new URL(effect.path, libraryRoot))).toBe(true);
    }
  });
});

import { runScenarios, runRound3Scenarios } from './scenarios.js';

/** 真实素材片段必须首尾覆盖全场；非循环片段可以交叉淡化，但不能留下空隙。 */
function expectFilled(segments: Segment[], duration: number): void {
  expect(segments.length).toBeGreaterThan(0);
  expect(segments[0].time).toBe(0);
  expect(segments.at(-1)!.end).toBe(duration);
  for (const [index, segment] of segments.entries()) {
    const asset = library.find(a => a.id === segment.assetId);
    expect(asset).toBeDefined();
    expect(segment.end).toBeGreaterThan(segment.time);
    expect(segment.end - segment.time).toBeLessThanOrEqual(asset!.duration + 1e-6);
    expect(segment.end).toBeLessThanOrEqual(duration);
    expect(existsSync(new URL(segment.path, libraryRoot))).toBe(true);
    if (index > 0) expect(segment.time).toBeLessThanOrEqual(segments[index - 1].end);
  }
}

it('四个指定场景用真实清单，雨、动作、医院走廊及长配乐全部覆盖', () => {
  const results = runScenarios(library);
  const [rain, fight, hospital, warm] = results.map(r => r.output);
  const rainBed = rain.shots[0].ambience[0];
  expect(rainBed).toBeDefined();
  expect(library.find(a => a.id === rainBed.assetId)?.tags).toContain('真实雨声');
  expect(library.find(a => a.id === rainBed.assetId)?.loop).toBe(true);
  expectFilled(rainBed.segments, 45);
  expect(rain.shots[0].effects.some(e => library.find(a => a.id === e.assetId)?.tags.includes('手机震动'))).toBe(true);
  expect(rain.warnings.some(w => w.includes('环境音'))).toBe(false);

  expect(fight.shots[0].effects.map(e => e.time)).toEqual([1, 2, 3, 5]);
  const street = fight.shots[0].ambience[0];
  expect(street).toBeDefined();
  const streetAsset = library.find(a => a.id === street.assetId)!;
  expect(streetAsset.tags).toContain('街道');
  expect(streetAsset.id).toMatch(/^round3-night-street-/);
  expect(streetAsset.loop).toBe(true);
  expectFilled(street.segments, 8);
  expect(fight.warnings.some(w => w.includes('环境音'))).toBe(false);
  const pipe = library.find(a => a.id === fight.shots[0].effects[0].assetId)!;
  expect(pipe.id).toMatch(/^round3-pipe-hit-/);
  expect(pipe.tags).toContain('金属管击打');
  expect(fight.warnings.some(w => w.includes('金属管击打素材'))).toBe(false);
  const knife = fight.shots[0].effects.find(e => e.time === 3)!;
  expect(library.find(a => a.id === knife.assetId)?.tags).toContain('刀划伤');
  expect(fight.warnings.some(w => w.includes('倒地'))).toBe(false);

  const footstep = hospital.shots[0].effects.find(e => e.time === 1)!;
  const steps = library.find(a => a.id === footstep.assetId)!;
  expect(steps.tags).not.toContain('草地');
  expect(steps.tags.some(tag => ['硬地面', '水泥地奔跑', '水泥地'].includes(tag))).toBe(true);
  const monitor = hospital.shots[0].effects.find(e => library.find(a => a.id === e.assetId)?.tags.includes('心电监护仪'));
  expect(monitor).toBeDefined();
  expect(library.find(a => a.id === monitor!.assetId)?.name).toBe('监护仪规律提示音');
  expectFilled(monitor!.segments, 45);
  expect(monitor!.gainDb).toBe(-6);
  expect(hospital.warnings.some(w => w.includes('心电监护仪'))).toBe(false);
  // 设备滴声不是走廊空间底噪；不拿人群或监护仪冒充医院环境声。
  expect(hospital.shots[0].ambience).toHaveLength(1);
  expect(library.find(a => a.id === hospital.shots[0].ambience[0].assetId)?.tags).toContain('医院底噪');
  expectFilled(hospital.shots[0].ambience[0].segments, 45);
  expect(hospital.warnings.some(w => w.includes('环境音'))).toBe(false);
  expect(hospital.music?.ducking).toEqual([{ start: 0, end: 45, gainDb: -12 }]);

  expect(warm.music?.segments.length).toBeGreaterThan(1);
  expectFilled(warm.music!.segments, 130);
  if (process.env.AIVORA_SCENARIO_REPORT) {
    writeFileSync(process.env.AIVORA_SCENARIO_REPORT, JSON.stringify(results, null, 2) + '\n');
  } else {
    const saved = JSON.parse(readFileSync(new URL('./SCENARIO_RESULTS.json', import.meta.url), 'utf8'));
    expect(saved).toEqual(results);
  }
});


it('第三轮三个真实场景的环境整场连续，镜头视图保留源位置', () => {
  const results = runRound3Scenarios(library);
  for (const result of results) {
    const plan = result.output;
    for (const bed of plan.ambience) {
      expectFilled(bed.segments.map(s => ({ ...s, time: s.time - bed.time, end: s.end - bed.time })), bed.end - bed.time);
      let offset = 0;
      for (const [index, shot] of result.input.shots.entries()) {
        for (const view of plan.shots[index].ambience.filter(a => a.assetId === bed.assetId)) {
          for (const part of view.segments) {
            const master = bed.segments.find(s => s.time <= offset + part.time + 1e-6 && s.end >= offset + part.end - 1e-6
              && Math.abs(s.sourceStart + offset + part.time - s.time - part.sourceStart) < 1e-6);
            expect(master).toBeDefined();
            expect(part.sourceStart + part.end - part.time).toBeLessThanOrEqual(library.find(a => a.id === part.assetId)!.duration + 1e-6);
          }
        }
        offset += shot.duration;
      }
    }
  }
  const fight = results[0].output;
  expect(fight.ambience).toHaveLength(1);
  expect(fight.ambience[0].end).toBe(55);
  expect(fight.shots[1].ambience[0].segments[0].sourceStart).toBe(18);
  for (const [shot, time] of [[0, 2], [1, 4], [2, 5]]) {
    const effect = fight.shots[shot].effects.find(e => e.time === time)!;
    expect(effect).toBeDefined();
    expect(library.find(a => a.id === effect.assetId)!.tags.some(t => ['钢管击打', '金属管击打'].includes(t))).toBe(true);
  }
  expect(fight.warnings.some(w => w.includes('倒地'))).toBe(false);
  const hospital = results[1].output;
  expect(hospital.ambience).toHaveLength(1);
  expect(hospital.ambience[0].end).toBe(65);
  expect(hospital.shots[1].ambience[0].segments[0].sourceStart).toBe(23);
  expect(hospital.warnings).toEqual([]);
  const street = results[2].output;
  expect(street.ambience).toHaveLength(1);
  expect(street.ambience[0].end).toBe(75);
  expect(street.shots[1].ambience[0].segments[0].sourceStart).toBe(22);
  expect(street.shots[0].effects[0].assetId).toMatch(/^r3-umbrella-open-/);
  expect(street.shots[2].effects[0].assetId).toMatch(/^r3-umbrella-close-/);
  expect(street.warnings).toEqual([]);
  if (process.env.AIVORA_SCENARIO_REPORT) {
    writeFileSync(new URL('./ROUND3_SCENARIO_RESULTS.json', import.meta.url), JSON.stringify(results, null, 2) + '\n');
  } else {
    expect(JSON.parse(readFileSync(new URL('./ROUND3_SCENARIO_RESULTS.json', import.meta.url), 'utf8'))).toEqual(results);
  }
});


it('第三轮导入原件有固定提交证据，六类数量与40秒循环可核验', () => {
  const entries = JSON.parse(readFileSync(new URL('manifest.json', libraryRoot), 'utf8')) as (AudioAsset & { rawCommit?: string; downloadSource?: string; sha256: string })[];
  const raw = entries.filter(a => a.rawCommit === '72b08644f41a0d62fe11f5708b193450341f41c5');
  // 收伞3（r3-umbrella-close-3）按用户要求在合进 aivora/dev 时删除，所以是 20 条、收伞 2 条 [M-02]
  expect(raw).toHaveLength(20);
  for (const tag of ['开伞', '收伞', '钢管击打', '钢管拖地', '人体倒地', '医院底噪', '夜街']) {
    expect(raw.filter(a => a.tags.includes(tag))).toHaveLength(tag === '收伞' ? 2 : 3);
  }
  for (const a of raw) {
    expect(a.downloadSource).toMatch(/^https:\/\/cdn\.freesound\.org\/previews\/.+-hq\.mp3$/);
    expect(a.author).toBeTruthy();
    expect(a.license).toBe('CC0-1.0');
    expect(createHash('sha256').update(readFileSync(new URL(a.path, libraryRoot))).digest('hex')).toBe(a.sha256);
    if (a.category === '环境') expect(a).toMatchObject({ duration: 40, loop: true, loopable: true });
  }
});
