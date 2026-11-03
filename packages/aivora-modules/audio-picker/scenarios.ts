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
