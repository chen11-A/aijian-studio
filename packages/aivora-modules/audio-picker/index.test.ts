import { describe, it, expect } from 'vitest';
import { pickAudio, type AudioAsset, type Scene } from './index.js';
const asset = (id: string, type: 'sfx'|'music', tags: string[], category = ''): AudioAsset => ({ id, path: `中文 路径/${id}.ogg`, type, category, name: id, tags, scene: '测试场景', duration: 30, loop: true, loudness: -20, source: '测试', license: 'CC0' });
const music = asset('music', 'music', ['紧张', '打斗']);
const scene = (): Scene => ({ emotions: ['紧张'], description: '室内打斗', duration: 10, shots: [{ duration: 5, hasDialogue: true, actions: [{ time: 2, label: '拳脚' }] }, { duration: 5, hasDialogue: false, actions: [{ time: 4 }] }] });
describe('配乐和音效挑选器', () => {
 it('按情绪配乐、台词压低、动作节点对齐', () => {
  const out = pickAudio(scene(), [music, asset('room','sfx',['室内'],'环境'), asset('punch','sfx',['拳脚','打斗'],'动作')]);
  expect(out.music).toMatchObject({ assetId:'music', start:0, end:10, fadeIn:1, fadeOut:1.5, sourceStart:0, loop:false, ducking:[{start:0,end:5,gainDb:-12}] });
  expect(out.shots[0].effects[0]).toMatchObject({time:2,end:5,gainDb:-6});
  expect(out.shots[1].effects[0]).toMatchObject({time:4,gainDb:0});
  expect(out.shots[0].ambience[0].gainDb).toBe(-12);
  expect(out.shots[1].ambience[0].gainDb).toBe(-6);
 });
 it('安静情绪戏不配乐', () => { const s=scene(); s.emotions=['安静']; expect(pickAudio(s,[music]).music).toBeNull(); });
 it('相邻场不重复并稳定选择同分资源', () => { const s=scene(); s.previousMusicId='music'; const out=pickAudio(s,[music,{...music,id:'z'},{...music,id:'a'}]); expect(out.music?.assetId).toBe('a'); });
 it('无匹配、无素材均保持留白', () => { expect(pickAudio(scene(),[]).music).toBeNull(); expect(pickAudio(scene(),[asset('sad','music',['悲伤'])]).music).toBeNull(); });
 it('拒绝无授权、非法长度和太短不可循环配乐', () => { expect(pickAudio(scene(),[{...music,license:'CC-BY'},{...music,duration:NaN},{...music,duration:2,loop:false}]).music).toBeNull(); });
 it('短循环素材、短镜头与边界动作', () => { const s:Scene={emotions:['紧张'],description:'雨',duration:2,shots:[{duration:2,hasDialogue:false,description:'打斗',actions:[{time:2,label:'打斗'},{time:0,label:'不存在'}]}]}; const out=pickAudio(s,[{...music,duration:1},asset('hit','sfx',['打斗'],'动作')]); expect(out.music).toMatchObject({loop:true,fadeIn:.5,fadeOut:.5}); expect(out.shots[0].effects).toEqual([]); });
 it.each([0,-1,NaN,Infinity])('拒绝场景时长 %s', duration=>expect(()=>pickAudio({...scene(),duration},[])).toThrow('场景时长'));
 it('拒绝空镜头',()=>expect(()=>pickAudio({...scene(),shots:[]},[])).toThrow('不能为空'));
 it.each([-1,NaN,6])('拒绝动作时间 %s',time=>{const s=scene();s.shots[0].actions=[{time}];expect(()=>pickAudio(s,[])).toThrow('动作时间');});
 it('拒绝镜头长度和总时长不一致',()=>{const s=scene();s.shots[0].duration=0;expect(()=>pickAudio(s,[])).toThrow('镜头时长');s.shots[0].duration=4;expect(()=>pickAudio(s,[])).toThrow('总时长');});
});
