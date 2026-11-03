import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeLoudness, measureLoudness, parseMeasurement, runFFmpeg } from './index.js';
const ffmpeg = process.env.FFMPEG_PATH ?? '/usr/bin/ffmpeg';
let directory: string, input: string;
beforeAll(async () => {
 directory = await mkdtemp(join(tmpdir(), '响度 测试 ')); input = join(directory, '原始 音频.wav');
 await runFFmpeg(ffmpeg, ['-v','error','-f','lavfi','-i','sine=frequency=440:duration=4:sample_rate=48000','-af','volume=0.15',input]);
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
