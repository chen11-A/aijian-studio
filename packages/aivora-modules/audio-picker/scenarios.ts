import { pickAudio, type AudioAsset, type Scene } from './index.js';
export const scenarioCases: { title: string; scene: Scene }[] = [
  { title:'雨夜书店门口，手机震动', scene:{emotions:['悬疑'],description:'雨夜书店门口，手机震动',duration:45,shots:[{duration:45,hasDialogue:false,actions:[]}]} },
  { title:'小巷打斗，钢管砸下、拳头击中、刀划过手臂、倒地', scene:{emotions:['打斗'],description:'小巷打斗',duration:8,shots:[{duration:8,hasDialogue:false,actions:[{time:1,label:'钢管砸下'},{time:2,label:'拳头击中'},{time:3,label:'刀划过手臂'},{time:5,label:'倒地'}]}]} },
  { title:'医院走廊，心电监护仪，脚步', scene:{emotions:['紧张'],description:'医院走廊，心电监护仪，脚步',duration:45,shots:[{duration:45,hasDialogue:true,actions:[{time:1,label:'脚步'}]}]} },
  { title:'130 秒的温暖场景', scene:{emotions:['温暖'],description:'温暖场景',duration:130,shots:[{duration:130,hasDialogue:false,actions:[]}]} },
];
export function runScenarios(library: AudioAsset[]) {
  return scenarioCases.map(({ title, scene }) => ({ title, input:scene, output:pickAudio(scene,library) }));
}

/** 第三轮验收：多镜头环境连续，动作时刻相对各镜头。 */
export const round3Cases: { title: string; scene: Scene }[] = [
  { title: '小巷钢管打斗加倒地', scene: { emotions: ['打斗'], description: '夜晚小巷钢管打斗', duration: 55, shots: [
    { duration: 18, hasDialogue: false, actions: [{ time: 2, label: '钢管砸下' }, { time: 7, label: '拳头击中' }] },
    { duration: 20, hasDialogue: true, actions: [{ time: 4, label: '铁棍击打' }, { time: 9, label: '倒地' }] },
    { duration: 17, hasDialogue: false, actions: [{ time: 5, label: '棍子击打' }] },
  ] } },
  { title: '医院走廊', scene: { emotions: ['紧张'], description: '医院走廊，规律心电监护仪，脚步', duration: 65, shots: [
    { duration: 23, hasDialogue: false, actions: [{ time: 3, label: '脚步' }] },
    { duration: 19, hasDialogue: true, actions: [] },
    { duration: 23, hasDialogue: false, actions: [{ time: 6, label: '脚步' }] },
  ] } },
  { title: '夜街撑伞', scene: { emotions: ['平静'], description: '夜街撑伞，街道脚步', duration: 75, shots: [
    { duration: 22, hasDialogue: false, actions: [{ time: 3, label: '开伞' }] },
    { duration: 28, hasDialogue: true, actions: [{ time: 7, label: '脚步' }] },
    { duration: 25, hasDialogue: false, actions: [{ time: 16, label: '收伞' }] },
  ] } },
];
export function runRound3Scenarios(library: AudioAsset[]) {
  return round3Cases.map(({ title, scene }) => ({ title, input: scene, output: pickAudio(scene, library) }));
}
