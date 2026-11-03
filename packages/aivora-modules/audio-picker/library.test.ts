import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pickAudio, type AudioAsset, type Scene } from './index.js';

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
      expect(Number.isFinite(asset.loudness)).toBe(true);
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
  it('下雨场景命中雨声环境音', () => {
    const result = pickAudio(scene(), library);
    expect(result.shots[0].ambience).toHaveLength(1);
    const asset = library.find(a => a.id === result.shots[0].ambience[0].assetId)!;
    expect(asset.category).toBe('环境');
    expect(asset.tags).toContain('下雨');
    expect(result.shots[0].ambience[0].time).toBe(0);
  });
  it('拳脚打斗的两个节点准确触发真实音效', () => {
    const fight = scene();
    fight.emotions = ['打斗'];
    fight.shots[0].actions = [{ time: 2.25, label: '拳脚' }, { time: 7.5, label: '刀剑打斗' }];
    const effects = pickAudio(fight, library).shots[0].effects;
    expect(effects.map(effect => effect.time)).toEqual([2.25, 7.5]);
    expect(library.find(a => a.id === effects[0].assetId)?.tags).toContain('拳脚');
    expect(library.find(a => a.id === effects[1].assetId)?.tags).toContain('刀剑');
    for (const effect of effects) {
      expect(effect.end).toBeGreaterThan(effect.time);
      expect(effect.end).toBeLessThanOrEqual(10);
      expect(existsSync(new URL(effect.path, libraryRoot))).toBe(true);
    }
  });
});
