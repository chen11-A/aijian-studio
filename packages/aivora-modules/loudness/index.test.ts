import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { normalizeLoudness, measureLoudness, parseMeasurement, runFFmpeg } from './index.js';
const ffmpeg = process.env.FFMPEG_PATH ?? '/usr/bin/ffmpeg';
let directory: string, input: string, videoInput: string, videoSilent: string;
beforeAll(async () => {
 directory = await mkdtemp(join(tmpdir(), '响度 测试 ')); input = join(directory, '原始 音频.wav');
 await runFFmpeg(ffmpeg, ['-v','error','-f','lavfi','-i','sine=frequency=440:duration=4:sample_rate=48000','-af','volume=0.15',input]);
 videoInput=join(directory,'带声音 视频.mp4');videoSilent=join(directory,'无声 视频.mp4');
 await runFFmpeg(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=80x80:rate=10:duration=4','-i',input,'-c:v','mpeg4','-c:a','aac',videoInput]);
 await runFFmpeg(ffmpeg,['-v','error','-i',videoInput,'-map','0:v:0','-c:v','copy',videoSilent]);
});
afterAll(async () => { await rm(directory,{recursive:true,force:true}); });
it.each([-14,-23] as const)('真实测量 %s LUFS 前后响度', async target => {
 const result = await normalizeLoudness({ffmpegPath:ffmpeg,input,output:join(directory,`${target} 完成.wav`),target});
 expect(result.before.integrated).toBeLessThan(-30);
 expect(Math.abs(result.after.integrated-target)).toBeLessThan(.5);
 expect(result.after.truePeak).toBeLessThanOrEqual(-1);
});
it.each(['ogg','m4a'])('处理 %s 输出格式',async extension => {
 const result=await normalizeLoudness({ffmpegPath:ffmpeg,input,output:join(directory,`完成.${extension}`),target:-14});
 expect(result.after.integrated).toBeCloseTo(-14,0);
});
it('拒绝覆盖、错误目标和不存在的音频',async()=>{
 await expect(normalizeLoudness({ffmpegPath:ffmpeg,input,output:input,target:-14})).rejects.toThrow('不能覆盖');
 await expect(normalizeLoudness({ffmpegPath:ffmpeg,input,output:'x',target:-10 as -14})).rejects.toThrow('目标响度');
 await expect(measureLoudness(ffmpeg,join(directory,'不存在.wav'))).rejects.toThrow('处理失败');
});
it('拒绝静音',async()=>{
 const silence=join(directory,'静音.wav');
 await runFFmpeg(ffmpeg,['-v','error','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','1',silence]);
 await expect(measureLoudness(ffmpeg,silence)).rejects.toThrow('没有可测量');
});
it('处理错误程序路径和日志',async()=>{
 await expect(runFFmpeg('ffmpeg',[])).rejects.toThrow('完整路径');
 await expect(runFFmpeg('/不存在/ffmpeg',[])).rejects.toThrow('无法启动');
 expect(()=>parseMeasurement('错误')).toThrow('未能读取');
 expect(parseMeasurement('{"input_i":"-14","input_tp":"-2","input_lra":"1","input_thresh":"-24","target_offset":"0"}').truePeak).toBe(-2);
});

it.each(['wav','ogg'])('视频输入导出纯音频 %s 时去除视频流',async extension=>{
 const output=join(directory,`视频转音频.${extension}`);
 const result=await normalizeLoudness({ffmpegPath:ffmpeg,input:videoInput,output,target:-14});
 expect(Math.abs(result.after.integrated+14)).toBeLessThan(.5);
 const probe=await promisify(execFile)(process.env.FFPROBE_PATH??'/usr/bin/ffprobe',['-v','error','-show_streams','-of','json',output]);
 const streams=JSON.parse(probe.stdout).streams;
 expect(streams).toHaveLength(1);expect(streams[0].codec_type).toBe('audio');
});
it('视频输出保留画面并规范化声音',async()=>{
 const output=join(directory,'视频成片.mp4');
 await normalizeLoudness({ffmpegPath:ffmpeg,input:videoInput,output,target:-23});
 const probe=await promisify(execFile)(process.env.FFPROBE_PATH??'/usr/bin/ffprobe',['-v','error','-show_streams','-of','json',output]);
 expect(JSON.parse(probe.stdout).streams.map((s:{codec_type:string})=>s.codec_type)).toEqual(['video','audio']);
});
it('缺音轨、重复输出和未知格式提供具体中文错误',async()=>{
 await expect(normalizeLoudness({ffmpegPath:ffmpeg,input:videoSilent,output:join(directory,'无声输出.wav'),target:-14})).rejects.toThrow('没有可用音轨');
 await expect(normalizeLoudness({ffmpegPath:ffmpeg,input,output:join(directory,'未知.xyz'),target:-14})).rejects.toThrow('输出格式不支持');
 const output=join(directory,'重复输出.wav');
 await normalizeLoudness({ffmpegPath:ffmpeg,input,output,target:-14});
 await expect(normalizeLoudness({ffmpegPath:ffmpeg,input,output,target:-14})).rejects.toThrow('输出文件已存在');
});
