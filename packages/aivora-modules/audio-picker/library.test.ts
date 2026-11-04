import { readFileSync, existsSync, writeFileSync } from 'node:fs';
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
    const rain = result.shots[0].ambience[0];
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

import { runScenarios } from './scenarios.js';

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

it('四个指定场景用新真实清单，雨与监护仪补齐，医院走廊和倒地仍如实缺项', () => {
  const results = runScenarios(library);
  const [rain, fight, hospital, warm] = results.map(r => r.output);
  const rainBed = rain.shots[0].ambience[0];
  expect(rainBed).toBeDefined();
  expect(library.find(a => a.id === rainBed.assetId)?.tags).toContain('真实雨声');
  expect(library.find(a => a.id === rainBed.assetId)?.loop).toBe(true);
  expectFilled(rainBed.segments, 45);
  expect(rain.shots[0].effects.some(e => library.find(a => a.id === e.assetId)?.tags.includes('手机震动'))).toBe(true);
  expect(rain.warnings.some(w => w.includes('环境音'))).toBe(false);

  expect(fight.shots[0].effects.map(e => e.time)).toEqual([1, 2, 3]);
  const knife = fight.shots[0].effects.find(e => e.time === 3)!;
  expect(library.find(a => a.id === knife.assetId)?.tags).toContain('刀划伤');
  expect(fight.warnings.some(w => w.includes('倒地'))).toBe(true);

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
  expect(hospital.shots[0].ambience).toEqual([]);
  expect(hospital.warnings.some(w => w.includes('环境音'))).toBe(true);
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
