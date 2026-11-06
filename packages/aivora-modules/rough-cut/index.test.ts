import { describe, expect, it } from 'vitest';
import { roughCut, type RoughCutShot } from './index.js';
const shot: RoughCutShot = { id: '镜头一', duration: 10, words: [{ text: '你', start: 2, end: 2.4 }, { text: '好', start: 2.5, end: 3 }], actionNodes: [] };
describe('自动粗剪', () => {
  it('保留台词前后呼吸空间', () => {
    expect(roughCut([shot])[0]).toMatchObject({ inPoint: 1.7, outPoint: 3.45, inReason: '台词与关键动作前保留 0.3 秒准备时间' });
  });
  it('允许配置合法留白及空时间线', () => {
    expect(roughCut([shot], { beforeDialogue: 0.4, afterDialogue: 0.6 })[0]).toMatchObject({ inPoint: 1.6, outPoint: 3.6 });
    expect(roughCut([])).toEqual([]);
  });
  it('无台词围绕所有动作剪辑', () => {
    const result = roughCut([{ ...shot, words: [], actionNodes: [6, 2, 4] }])[0];
    expect(result.inPoint).toBe(1.7);
    expect(result.outPoint).toBe(6.45);
    expect(result.inReason).toContain('关键动作');
  });
  it('有台词时也不丢弃关键动作', () => {
    expect(roughCut([{ ...shot, actionNodes: [8] }])[0].outPoint).toBe(8.45);
  });
  it('素材边界不足时明确说明', () => {
    const result = roughCut([{ ...shot, words: [], actionNodes: [0, 10] }])[0];
    expect(result.inPoint).toBe(0);
    expect(result.outPoint).toBe(10);
    expect(result.inReason).toContain('前留白不足');
    expect(result.outReason).toContain('后留白不足');
  });
  it('没有标记就保留整段，不修改输入', () => {
    const input = { ...shot, words: [], actionNodes: [] };
    expect(roughCut([input])[0]).toMatchObject({ inPoint: 0, outPoint: 10, duration: 10 });
    expect(input.duration).toBe(10);
  });
  it.each([0, -1, NaN, Infinity])('拒绝无效时长 %s', duration => {
    expect(() => roughCut([{ ...shot, duration }])).toThrow('时长无效');
  });
  it('拒绝重复或空编号', () => {
    expect(() => roughCut([shot, shot])).toThrow('编号');
    expect(() => roughCut([{ ...shot, id: '' }])).toThrow('编号');
  });
  it.each([0.1, 0.5, NaN])('拒绝错误前留白 %s', beforeDialogue => {
    expect(() => roughCut([shot], { beforeDialogue })).toThrow('台词前留白');
  });
  it.each([0.2, 0.7, NaN])('拒绝错误后留白 %s', afterDialogue => {
    expect(() => roughCut([shot], { afterDialogue })).toThrow('台词后留白');
  });
  it.each([{ text: ' ', start: 1, end: 2 }, { text: '字', start: NaN, end: 2 }, { text: '字', start: -1, end: 2 }, { text: '字', start: 1, end: Infinity }, { text: '字', start: 3, end: 2 }, { text: '字', start: 1, end: 11 }])('拒绝无效逐字时间 %#', word => {
    expect(() => roughCut([{ ...shot, words: [word] }])).toThrow('逐字时间无效');
  });
  it.each([-1, 11, NaN])('拒绝无效动作时间 %s', time => {
    expect(() => roughCut([{ ...shot, actionNodes: [time] }])).toThrow('动作时间无效');
  });
});
