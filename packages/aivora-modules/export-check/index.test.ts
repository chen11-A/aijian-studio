import { afterAll,beforeAll,expect,it } from 'vitest';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkExport,detectIntervals,runProgram,subtractBlackIntervals } from './index.js';
const options={ffmpegPath:process.env.FFMPEG_PATH??'/usr/bin/ffmpeg',ffprobePath:process.env.FFPROBE_PATH??'/usr/bin/ffprobe'};
let dir:string,video:string,black:string,audio:string,small:string,corrupt:string,originalAudio:string,still:string;
beforeAll(async()=>{
 dir=await mkdtemp(join(tmpdir(),'自检 中文 '));video=join(dir,'动态.mp4');black=join(dir,'黑屏.mp4');audio=join(dir,'声音.wav');small=join(dir,'小画面.mp4');corrupt=join(dir,'损坏.mp4');
 for(const [path,filter] of [[video,'testsrc2=size=160x90:rate=10:duration=3.5'],[black,'color=black:size=160x90:rate=10:duration=3.5'],[small,'testsrc2=size=80x80:rate=10:duration=1']]) await runProgram(options.ffmpegPath,['-v','error','-f','lavfi','-i',filter,'-c:v','mpeg4',path]);
 await runProgram(options.ffmpegPath,['-v','error','-f','lavfi','-i','sine=frequency=500:duration=3.5',audio]);await writeFile(corrupt,'坏文件');
 originalAudio=join(dir,'带原声 视频.mp4');still=join(dir,'静帧 白色.mp4');
 await runProgram(options.ffmpegPath,['-v','error','-i',video,'-i',audio,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac',originalAudio]);
 await runProgram(options.ffmpegPath,['-v','error','-f','lavfi','-i','color=white:size=160x90:rate=10:duration=3.5','-c:v','mpeg4',still]);
});
afterAll(async()=>{await rm(dir,{recursive:true,force:true});});
it('正常画面和配音通过真实解码检查',async()=>{
 const result=await checkExport({shots:[{path:video,start:0,end:3.5,voices:[{path:audio,start:0,end:3.5}]}]},options);
 expect(result.ok).toBe(true);expect(result.text).toContain('自检通过');
});
it('真实检测黑屏、静帧和无声',async()=>{
 const result=await checkExport({shots:[{path:black,start:0,end:3.5}]},options);
 expect(result.issues.map(x=>x.code)).toEqual(expect.arrayContaining(['black','silence']));expect(result.text).toContain('第 1 个镜头');expect(result.issues.some(x=>x.code==='freeze')).toBe(false);
});
it('检查缺文件、坏文件、时间空白和无效时间',async()=>{
 const result=await checkExport({duration:10,shots:[{path:video,start:-1,end:0},{path:join(dir,'缺失'),start:1,end:2},{path:corrupt,start:2,end:3}]},options);
 expect(result.issues.map(x=>x.code)).toEqual(expect.arrayContaining(['time','missing','decode','gap','duration']));
});
it('检查尺寸、时长、重叠、台词截断及音画范围',async()=>{
 const result=await checkExport({shots:[{path:video,start:0,end:4,sourceStart:0,voices:[{path:audio,start:0,end:5,sourceStart:.2,speechStart:0,speechEnd:6},{path:audio,start:-1,end:0}]},{path:small,start:3,end:4}]},options);
 expect(result.issues.map(x=>x.code)).toEqual(expect.arrayContaining(['size','video-duration','overlap','sync','speech-cut','audio-time','audio-duration']));
});
it('检测错误媒体类型',async()=>{
 const result=await checkExport({shots:[{path:audio,start:0,end:1,music:[{path:video,start:0,end:1}]}]},options);
 expect(result.issues.map(x=>x.code)).toEqual(expect.arrayContaining(['video','audio']));
});
it('真实混音检查头尾静音并处理无效阈值',async()=>{
 const result=await checkExport({duration:7,shots:[{path:video,start:0,end:7,music:[{path:audio,start:3,end:4}]}]},options);
 expect(result.issues.filter(x=>x.code==='silence').length).toBe(2);
 await expect(checkExport({shots:[{path:video,start:0,end:1}]},{...options,silenceSeconds:0})).rejects.toThrow('阈值');
});
it('空时间线和日志边界',async()=>{
 expect((await checkExport({shots:[]},options)).issues[0].code).toBe('empty');
 expect(detectIntervals('silence_end: 1 silence_start: 2 silence_end: 5 silence_start: 7','silence',10)).toEqual([[2,5],[7,10]]);
});
it('不搜索PATH且返回中文程序错误',async()=>{
 await expect(checkExport({shots:[]},{...options,ffmpegPath:'ffmpeg'})).rejects.toThrow('完整路径');
 await expect(runProgram('ffprobe',[])).rejects.toThrow('完整路径');
 await expect(runProgram('/不存在/ffprobe',[])).rejects.toThrow('无法启动');
});

it('视频原声默认参与混音且允许关闭',async()=>{
 const timeline={shots:[{path:originalAudio,start:0,end:3.5}]};
 expect((await checkExport(timeline,options)).ok).toBe(true);
 expect((await checkExport(timeline,{...options,includeOriginalAudio:false})).issues.some(x=>x.code==='silence')).toBe(true);
});
it('同视频显式音频覆盖默认原声，避免重复混音',async()=>{
 const result=await checkExport({shots:[{path:originalAudio,start:0,end:3.5,voices:[{path:originalAudio,start:2.5,end:3.5,sourceStart:1}]}]},options);
 expect(result.issues.filter(x=>x.code==='silence')).toHaveLength(1);
 expect(result.issues.find(x=>x.code==='silence')?.time).toBe(0);
});
it('非黑静帧仍单独报告',async()=>{
 const result=await checkExport({shots:[{path:still,start:0,end:3.5}]},options);
 expect(result.issues.some(x=>x.code==='freeze')).toBe(true);
 expect(result.issues.some(x=>x.code==='black')).toBe(false);
});
it('仅扣除重叠的黑屏区间，保留静帧左右片段',()=>{
 expect(subtractBlackIntervals([0,10],[[3,6]])).toEqual([[0,3],[6,10]]);
 expect(subtractBlackIntervals([0,10],[[0,3],[8,12]])).toEqual([[3,8]]);
 expect(subtractBlackIntervals([0,10],[[10,12],[-2,0]])).toEqual([[0,10]]);
 expect(subtractBlackIntervals([0,10],[[-2,12]])).toEqual([]);
});
