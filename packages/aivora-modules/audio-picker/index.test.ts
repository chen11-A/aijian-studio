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
 it('相邻场不重复并稳定选择同分资源', () => { const s=scene(); s.previousMusicId='music'; const out=pickAudio(s,[music,{...music,id:'z',source:'另一首z'},{...music,id:'a',source:'另一首a'}]); expect(out.music?.assetId).toBe('a'); });
 it('无匹配、无素材均保持留白', () => { expect(pickAudio(scene(),[]).music).toBeNull(); expect(pickAudio(scene(),[asset('sad','music',['悲伤'])]).music).toBeNull(); });
 it('拒绝无授权和非法长度配乐', () => { expect(pickAudio(scene(),[{...music,license:'CC-BY'},{...music,duration:NaN}]).music).toBeNull(); });
 it('短循环素材、短镜头与边界动作', () => { const s:Scene={emotions:['紧张'],description:'雨',duration:2,shots:[{duration:2,hasDialogue:false,description:'打斗',actions:[{time:2,label:'打斗'},{time:0,label:'不存在'}]}]}; const out=pickAudio(s,[{...music,duration:1},asset('hit','sfx',['打斗'],'动作')]); expect(out.music).toMatchObject({loop:true,fadeIn:.5,fadeOut:.5}); expect(out.shots[0].effects).toEqual([]); });
 it.each([0,-1,NaN,Infinity])('拒绝场景时长 %s', duration=>expect(()=>pickAudio({...scene(),duration},[])).toThrow('场景时长'));
 it('拒绝空镜头',()=>expect(()=>pickAudio({...scene(),shots:[]},[])).toThrow('不能为空'));
 it.each([-1,NaN,6])('拒绝动作时间 %s',time=>{const s=scene();s.shots[0].actions=[{time}];expect(()=>pickAudio(s,[])).toThrow('动作时间');});
 it('拒绝镜头长度和总时长不一致',()=>{const s=scene();s.shots[0].duration=0;expect(()=>pickAudio(s,[])).toThrow('镜头时长');s.shots[0].duration=4;expect(()=>pickAudio(s,[])).toThrow('总时长');});
});

import { fillDuration } from './index.js';
import { concepts } from './synonyms.js';
it('所有同义词和具体动作可识别',()=>{
 expect(concepts('钢管拖地、铁棍、拳头、刀划过手臂、摔倒、医院病房、监护仪、雨夜、大风、跑步、手机振动')).toEqual(expect.arrayContaining(['钢管拖地','钢管击打','拳脚','刀挥砍','刀划伤','人体倒地','医院底噪','心电监护仪','雨声','风声','脚步','手机震动']));
});
it('短环境音循环铺满且描述设备无需动作节点',()=>{
 const s:Scene={emotions:[],description:'雨夜手机震动',duration:12,shots:[{duration:12,hasDialogue:false,actions:[]}]};
 const out=pickAudio(s,[{...asset('rain','sfx',['雨声'],'环境'),duration:5},asset('phone','sfx',['手机震动'],'道具')]);
 expect(out.shots[0].ambience[0]).toMatchObject({end:12,loop:true});
 expect(out.shots[0].ambience[0].segments.map(x=>[x.time,x.end])).toEqual([[0,5],[5,10],[10,12]]);
 expect(out.shots[0].effects[0].assetId).toBe('phone');
});
it('医院用硬地脚步并安排完整监护音，禁止草地替代',()=>{
 const s:Scene={emotions:[],description:'医院走廊，心电监护仪',duration:15,shots:[{duration:15,hasDialogue:true,actions:[{time:3,label:'脚步'}]}]};
 const lib=[asset('grass','sfx',['脚步','草地'],'动作'),asset('concrete','sfx',['脚步','水泥地'],'动作'),asset('hospital','sfx',['医院底噪'],'环境'),{...asset('monitor','sfx',['心电监护仪'],'道具'),duration:2}];
 const out=pickAudio(s,lib);
 expect(out.shots[0].ambience[0].assetId).toBe('hospital');
 expect(out.shots[0].effects.map(e=>e.assetId)).toEqual(['concrete','monitor']);
 expect(out.shots[0].effects[1].end).toBe(15);
 expect(pickAudio(s,[lib[0]]).shots[0].effects).toEqual([]);
 expect(pickAudio(s,[lib[0]]).warnings.length).toBe(3);
});
it('湿地脚步优先、明确设备动作不重复、拖拽不选击打',()=>{
 const s:Scene={emotions:[],description:'下雨的街道，手机震动',duration:15,shots:[{duration:15,hasDialogue:false,actions:[{time:1,label:'脚步'},{time:2,label:'手机震动'},{time:3,label:'钢管拖地'}]}]};
 const out=pickAudio(s,[asset('wet','sfx',['脚步','湿地面脚步'],'动作'),asset('hard','sfx',['脚步','水泥地'],'动作'),asset('phone','sfx',['手机震动'],'道具'),asset('drag','sfx',['钢管拖地'],'动作'),asset('hit','sfx',['金属击打'],'动作')]);
 expect(out.shots[0].effects.map(e=>e.assetId)).toEqual(['wet','phone','drag']);
});
it('刀划伤优先其后是挥砍，不选厨刀刮擦；倒地按动作命中',()=>{
 const s:Scene={emotions:[],description:'小巷',duration:8,shots:[{duration:8,hasDialogue:false,actions:[{time:1,label:'刀划过手臂'},{time:2,label:'倒地'}]}]};
 const lib=[asset('scrape','sfx',['刀剑'],'动作'),asset('swing','sfx',['刀挥砍'],'动作'),asset('cut','sfx',['刀划伤'],'动作'),asset('fall','sfx',['人体倒地'],'动作')];
 expect(pickAudio(s,lib).shots[0].effects.map(e=>e.assetId)).toEqual(['cut','fall']);
 expect(pickAudio(s,[lib[1]]).shots[0].effects[0].assetId).toBe('swing');
});
it('130秒非循环配乐接同情绪第二首，只有一首则交叉淡化重复',()=>{
 const s:Scene={emotions:['温暖'],description:'温暖场景',duration:130,shots:[{duration:130,hasDialogue:false,actions:[]}]};
 const a={...asset('a','music',['温暖']),duration:80,loop:false}, b={...a,id:'b',duration:60};
 const both=pickAudio(s,[a,b]);
 expect(both.music?.segments.map(x=>x.assetId)).toEqual(['a','b']);
 expect(both.music?.segments.at(-1)?.end).toBe(130);
 const single=pickAudio(s,[a]);expect(single.music?.loop).toBe(true);expect(single.music?.segments.at(-1)?.end).toBe(130);
});
it('选择已验证循环曲优先，保留不同情绪曲不误接',()=>{
 const s:Scene={emotions:['温暖','平静'],description:'',duration:60,shots:[{duration:60,hasDialogue:false,actions:[]}]};
 const a={...asset('a','music',['温暖']),loop:false}; const b=asset('b','music',['平静']);
 expect(pickAudio(s,[a,b]).music?.assetId).toBe('b');
 expect(pickAudio(s,[a,{...b,loop:false}]).music?.segments.map(x=>x.assetId)).toEqual(['a','a','a']);
});
it('环境无可循环时交叉淡化铺满；非已知动作仍按原关键词',()=>{
 const s:Scene={emotions:[],description:'室内',duration:5,shots:[{duration:5,hasDialogue:false,actions:[{time:0,label:'翻书'}]}]};
 const out=pickAudio(s,[{...asset('room','sfx',['室内'],'环境'),loop:false,duration:2},asset('book','sfx',['翻书'],'道具')]);
 expect(out.shots[0].ambience[0].segments.at(-1)?.end).toBe(5);expect(out.shots[0].effects[0].assetId).toBe('book');
});
it('未知动作和医院缺素材明确告警，不借用普通房间噪声',()=>{
 const s:Scene={emotions:[],description:'医院心电',duration:3,shots:[{duration:3,hasDialogue:false,actions:[{time:1,label:'未知动作'}]}]};
 const out=pickAudio(s,[asset('room','sfx',['室内','医院'],'环境')]);
 expect(out.shots[0].ambience).toEqual([]);expect(out.warnings).toHaveLength(3);
});
it('铺底拒绝不合法素材与过多片段',()=>{
 for(const args of [[[],1],[[{...music,duration:0}],1],[[music],NaN],[[music],0]] as [AudioAsset[],number][])expect(()=>fillDuration(...args)).toThrow('有效');
 expect(()=>fillDuration([{...music,duration:.00001}],2)).toThrow('过多');
});

it('同一首的循环派生版也不能在相邻场重复',()=>{
 const s=scene();s.previousMusicId=music.id;
 expect(pickAudio(s,[music,{...music,id:'derived'}]).music).toBeNull();
});

it('硬地行走与奔跑按动作区分',()=>{
 const s:Scene={emotions:[],description:'医院走廊',duration:10,shots:[{duration:10,hasDialogue:false,actions:[{time:1,label:'脚步'},{time:4,label:'奔跑'}]}]};
 const lib=[asset('run','sfx',['脚步','水泥地奔跑'],'动作'),asset('walk','sfx',['脚步','水泥地'],'动作')];
 expect(pickAudio(s,lib).shots[0].effects.map(e=>e.assetId)).toEqual(['walk','run']);
});

const monitorLibrary = [
  { ...asset('a-continuous', 'sfx', ['心电监护仪'], '道具'), name: '监护仪持续长鸣' },
  { ...asset('b-speed-up', 'sfx', ['心电监护仪'], '道具'), name: '监护仪逐渐加速提示音' },
  { ...asset('z-steady', 'sfx', ['心电监护仪'], '道具'), name: '监护仪规律提示音' },
];
const monitorScene = (description: string): Scene => ({ emotions: [], description, duration: 15, shots: [{ duration: 15, hasDialogue: true, actions: [] }] });
it.each([
  ['医院走廊，心电监护仪，脚步', 'z-steady'],
  ['心电监护仪正常滴滴', 'z-steady'],
  ['心电监护仪显示停搏', 'a-continuous'],
  ['病人死亡，心电监护仪', 'a-continuous'],
  ['心电监护仪长鸣', 'a-continuous'],
  ['心率加快，心电监护仪', 'b-speed-up'],
])('监护仪状态遵循场景语义：%s', (description, id) => {
  const out = pickAudio(monitorScene(description), monitorLibrary);
  expect(out.shots[0].effects[0].assetId).toBe(id);
  expect(out.shots[0].effects[0].end).toBe(15);
});
it('动作明确的监护状态优先于场景，设备动作不重复', () => {
  const input = monitorScene('病人心率加快，心电监护仪');
  input.shots[0].actions = [{ time: 2, label: '心电监护仪恢复正常' }];
  expect(pickAudio(input, monitorLibrary).shots[0].effects.map(e => e.assetId)).toEqual(['z-steady']);
});
it('缺少对应监护状态时不使用相反状态冒充', () => {
  const normal = pickAudio(monitorScene('心电监护仪'), monitorLibrary.slice(0, 2));
  expect(normal.shots[0].effects).toEqual([]);
  expect(normal.warnings.some(w => w.includes('心电监护仪'))).toBe(true);
  const abnormal = pickAudio(monitorScene('停搏，心电监护仪'), [monitorLibrary[2]]);
  expect(abnormal.shots[0].effects).toEqual([]);
  expect(abnormal.warnings.some(w => w.includes('心电监护仪'))).toBe(true);
});

it('钢管砸下优先真实管拟音，不能被同场景高分金属罐抢占', () => {
 const s:Scene={emotions:[],description:'小巷打斗',duration:8,shots:[{duration:8,hasDialogue:false,actions:[{time:1,label:'钢管砸下'}]}]};
 const can=asset('a-can','sfx',['金属击打','小巷打斗','钢管砸下'],'动作');
 const pipe=asset('z-pipe','sfx',['金属管击打'],'动作');
 const out=pickAudio(s,[can,pipe]);
 expect(out.shots[0].effects[0].assetId).toBe('z-pipe');
 expect(out.warnings.some(w=>w.includes('金属管击打素材'))).toBe(false);
 const fallback=pickAudio(s,[can]);
 expect(fallback.shots[0].effects).toEqual([]);
 expect(fallback.warnings.some(w=>w.includes('缺少“钢管砸下”对应音效'))).toBe(true);
});
it('小巷环境同义词选街道循环铺满，管拖地仍只匹配拖拽', () => {
 const s:Scene={emotions:[],description:'小巷打斗',duration:8,shots:[{duration:8,hasDialogue:false,actions:[{time:1,label:'钢管拖地'},{time:2,label:'铁管砸下'}]}]};
 const out=pickAudio(s,[{...asset('street','sfx',['街道'],'环境'),duration:3},asset('drag','sfx',['钢管拖地'],'动作'),asset('pipe','sfx',['钢管击打'],'动作')]);
 expect(out.shots[0].ambience[0].assetId).toBe('street');
 expect(out.shots[0].ambience[0].segments.map(s=>[s.time,s.end])).toEqual([[0,3],[3,6],[6,8]]);
 expect(out.shots[0].effects.map(e=>e.assetId)).toEqual(['drag','pipe']);
 expect(out.warnings).toEqual([]);
});

it.each(['钢管', '铁棍', '棍子'])('具体棍管动作%s缺素材时不拿高分金属罐顶替', label => {
 const s:Scene={emotions:[],description:'打斗',duration:5,shots:[{duration:5,hasDialogue:false,actions:[{time:1,label}]}]};
 const can=asset('can','sfx',['金属击打',label],'动作');
 const out=pickAudio(s,[can]);
 expect(out.shots[0].effects).toEqual([]);
 expect(out.warnings).toEqual([`第1镜头第1秒缺少“${label}”对应音效`]);
});
it('同一环境跨三个镜头沿源时间连续，跨循环点准确拆段并保留台词压低', () => {
 const s:Scene={emotions:[],description:'雨声',duration:13,shots:[{duration:3,hasDialogue:false,actions:[]},{duration:4,hasDialogue:true,actions:[]},{duration:6,hasDialogue:false,actions:[]}]};
 const out=pickAudio(s,[{...asset('rain','sfx',['雨声'],'环境'),duration:5}]);
 expect(out.ambience).toHaveLength(1);
 expect(out.ambience[0].segments.map(x=>[x.time,x.end,x.sourceStart])).toEqual([[0,5,0],[5,10,0],[10,13,0]]);
 expect(out.ambience[0].gainAutomation).toEqual([{start:0,end:3,gainDb:-6},{start:3,end:7,gainDb:-12},{start:7,end:13,gainDb:-6}]);
 expect(out.shots.map(shot=>shot.ambience[0].segments.map(x=>[x.time,x.end,x.sourceStart]))).toEqual([[[0,3,0]],[[0,2,3],[2,4,0]],[[0,3,2],[3,6,0]]]);
});
it('非循环环境在跨镜头交叉淡化中保留原始源偏移与包络锚点', () => {
 const s:Scene={emotions:[],description:'室内',duration:10,shots:[{duration:4.75,hasDialogue:false,actions:[]},{duration:5.25,hasDialogue:false,actions:[]}]};
 const out=pickAudio(s,[{...asset('room','sfx',['室内'],'环境'),duration:5,loop:false}]);
 const first=out.ambience[0];
 expect(first.segments.map(x=>[x.time,x.end])).toEqual([[0,5],[4.5,9.5],[9,10]]);
 const continuation=out.shots[1].ambience[0].segments;
 expect(continuation[0]).toMatchObject({time:0,end:.25,sourceStart:4.75,fadeOut:.5,fadeOutStart:-.25});
 expect(continuation[1]).toMatchObject({time:0,end:4.75,sourceStart:.25,fadeIn:.5,fadeInStart:-.25});
 expect(out.shots[0].ambience[0].segments[1]).toMatchObject({time:4.5,end:4.75,sourceStart:0,fadeInStart:4.5});
});
it('环境更换或中断才创建新轨道，其他相邻镜头不会重新开始', () => {
 const s:Scene={emotions:[],description:'',duration:12,shots:['雨声','雨声','风声','无匹配','雨声','雨声'].map(description=>({duration:2,hasDialogue:false,actions:[],description}))};
 const out=pickAudio(s,[asset('rain','sfx',['雨声'],'环境'),asset('wind','sfx',['风声'],'环境')]);
 expect(out.ambience.map(t=>[t.assetId,t.time,t.end])).toEqual([['rain',0,4],['wind',4,6],['rain',8,12]]);
 expect(out.shots[1].ambience[0].segments[0].sourceStart).toBe(2);
 expect(out.shots[3].ambience).toEqual([]);
 expect(out.shots[4].ambience[0].segments[0].sourceStart).toBe(0);
});

it('开伞收伞匹配精确方向，不能用反向动作或笼统开合替代', () => {
 const s: Scene = { emotions: [], description: '夜街撑伞', duration: 10, shots: [{ duration: 10, hasDialogue: false, actions: [{ time: 1, label: '撑伞' }, { time: 7, label: '合上雨伞' }] }] };
 const lib = [asset('open', 'sfx', ['开伞'], '道具'), asset('close', 'sfx', ['收伞'], '道具'), asset('unknown', 'sfx', ['雨伞开合'], '道具')];
 expect(pickAudio(s, lib).shots[0].effects.map(e => e.assetId)).toEqual(['open', 'close']);
 expect(pickAudio(s, lib.slice(2)).shots[0].effects).toEqual([]);
});

it.each([-12, -20, 3, NaN, Infinity, undefined])('环境建议增益 %s 只能降低默认值，非法值忽略', suggestedGainDb => {
 const s: Scene = { emotions: [], description: '医院走廊', duration: 10, shots: [{ duration: 5, hasDialogue: false, actions: [] }, { duration: 5, hasDialogue: true, actions: [] }] };
 const output = pickAudio(s, [{ ...asset('hospital', 'sfx', ['医院底噪'], '环境'), suggestedGainDb }]);
 const expected = Number.isFinite(suggestedGainDb) ? [Math.min(-6, suggestedGainDb!), Math.min(-12, suggestedGainDb!)] : [-6, -12];
 expect(output.shots.map(s => s.ambience[0].gainDb)).toEqual(expected);
 expect(output.ambience[0].gainAutomation.map(g => g.gainDb)).toEqual(expected);
 expect(output.ambience[0].gainDb).toBe(expected[0]);
});

it.each([
 ['撑开雨伞','open'],['打开伞','open'],['撑开伞','open'],['开雨伞','open'],
 ['收起雨伞','close'],['收起伞','close'],['合伞','close'],
 ['铁棍拖','drag'],['棍子拖','drag'],['拖在地上','drag'],['拖着钢管','drag'],
])('第四轮具体动作%s选择正确方向', (label, expected) => {
 const lib=[asset('open','sfx',['开伞'],'道具'),asset('close','sfx',['收伞'],'道具'),asset('generic','sfx',['雨伞',label],'道具'),asset('hit','sfx',['钢管击打'],'动作'),asset('drag','sfx',['钢管拖地'],'动作')];
 const input:Scene={emotions:[],description:'拿着雨伞和钢管',duration:5,shots:[{duration:5,hasDialogue:false,actions:[{time:1,label}]}]};
 expect(pickAudio(input,lib).shots[0].effects[0].assetId).toBe(expected);
 expect(pickAudio(input,lib.filter(a=>a.id!==expected)).shots[0].effects).toEqual([]);
});
it.each(['下雨','雨夜','下着雨'])('街道%s同时保留街道和独立雨声连续轨道', weather => {
 const lib=[{...asset('street','sfx',['街道'],'环境'),duration:40},{...asset('rain','sfx',['雨声'],'环境'),duration:30}];
 const input:Scene={emotions:[],description:`街道${weather}`,duration:55,shots:[{duration:22,hasDialogue:false,actions:[]},{duration:33,hasDialogue:true,actions:[]}]};
 const out=pickAudio(input,lib);
 expect(out.ambience.map(a=>a.assetId)).toEqual(['street','rain']);
 expect(out.shots[1].ambience.map(a=>a.segments[0].sourceStart)).toEqual([22,22]);
 expect(out.ambience[1].gainAutomation.map(g=>g.gainDb)).toEqual([-6,-6]);
 expect(out.ambience.every(a=>a.end===55)).toBe(true);
 expect(out.ambience[1].segments.map(s=>[s.time,s.end])).toEqual([[0,30],[30,55]]);
 expect(out.warnings).toEqual([]);
 expect(pickAudio(input,lib.slice(0,1)).warnings.every(w=>w.includes('缺少可循环雨声'))).toBe(true);
});
it('同场倒地同义动作跨镜头轮换全部文件，用尽后再轮回；新场重置',()=>{
 const lib=['a','b','c'].map(id=>asset(id,'sfx',['人体倒地'],'动作'));
 const input:Scene={emotions:[],description:'',duration:10,shots:[{duration:5,hasDialogue:false,actions:[{time:1,label:'倒地'},{time:3,label:'摔倒'}]},{duration:5,hasDialogue:false,actions:[{time:1,label:'跌倒'},{time:3,label:'倒地'}]}]};
 const ids=()=>pickAudio(input,lib).shots.flatMap(s=>s.effects.map(e=>e.assetId));
 expect(ids()).toEqual(['a','b','c','a']);expect(ids()).toEqual(['a','b','c','a']);
 expect(pickAudio(input,lib.slice(0,1)).shots.flatMap(s=>s.effects.map(e=>e.assetId))).toEqual(['a','a','a','a']);
});

it('直接关键词动作也轮换，未匹配的文件不进入轮换池',()=>{
 const lib=[asset('a','sfx',['敲钟'],'动作'),asset('b','sfx',['敲钟'],'动作'),asset('c','sfx',['纸张'],'动作')];
 const input:Scene={emotions:[],description:'',duration:5,shots:[{duration:5,hasDialogue:false,actions:[{time:1,label:'敲钟'},{time:3,label:'敲钟'}]}]};
 expect(pickAudio(input,lib).shots[0].effects.map(e=>e.assetId)).toEqual(['a','b']);
});

it('同义词分数变化也不能在一轮结束时连续重复同文件',()=>{
 const lib=[{...asset('a','sfx',['人体倒地'],'动作'),name:'摔倒'},{...asset('b','sfx',['人体倒地'],'动作'),name:'倒地'}];
 const input:Scene={emotions:[],description:'',duration:6,shots:[{duration:6,hasDialogue:false,actions:[{time:1,label:'倒地'},{time:2,label:'摔倒'},{time:3,label:'摔倒'},{time:4,label:'倒地'}]}]};
 expect(pickAudio(input,lib).shots[0].effects.map(e=>e.assetId)).toEqual(['b','a','b','a']);
});
