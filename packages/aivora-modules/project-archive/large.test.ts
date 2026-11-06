import { it, expect } from 'vitest';
import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import * as yauzl from 'yauzl';
import { packProject, importProject } from './index.js';
async function hashFile(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { highWaterMark: 64 * 1024 })) hash.update(chunk);
  return hash.digest('hex');
}
it('超过1GiB的真实流式打包、导入和独立校验；视频使用STORE', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'大作品 测试-'));
  const source = path.join(dir,'作品'), archive = path.join(dir,'大型备份.aivora');
  const fileSize = 1024 ** 3 + 1024 ** 2;
  const baselineRss = process.memoryUsage().rss;
  let peakRss = baselineRss;
  const timer = setInterval(() => { peakRss = Math.max(peakRss,process.memoryUsage().rss); },10);
  const started = performance.now();
  try {
    await fs.mkdir(source);
    const file = path.join(source,'中文 视频.mp4');
    const handle = await fs.open(file,'w');
    await handle.truncate(fileSize);
    await handle.write(Buffer.from('实际读取全部稀疏文件字节，并非模拟文件大小'),0,Buffer.byteLength('实际读取全部稀疏文件字节，并非模拟文件大小'),0);
    await handle.write(Buffer.from('结尾标记'),0,Buffer.byteLength('结尾标记'),fileSize-Buffer.byteLength('结尾标记'));
    await handle.close();
    const sourceHash = await hashFile(file);
    const packStart = performance.now();
    const manifest = await packProject(source,archive);
    const packSeconds = (performance.now()-packStart)/1000;
    expect(manifest.files[0]).toMatchObject({size:fileSize,sha256:sourceHash});
    expect((await fs.stat(archive)).size).toBeGreaterThan(fileSize);
    await new Promise<void>((resolve,reject) => yauzl.open(archive,{lazyEntries:true},(error,zip)=>{
      if(error){reject(error);return;}
      zip!.once('error',reject);zip!.once('entry',(entry:yauzl.Entry)=>{
        try { expect(entry.compressionMethod).toBe(0);expect(entry.uncompressedSize).toBe(fileSize);zip!.close();resolve(); } catch (error) { reject(error); }
      });zip!.readEntry();
    }));
    const importStart = performance.now();
    const result = await importProject(archive,path.join(dir,'恢复'));
    const importSeconds = (performance.now()-importStart)/1000;
    const resultHash = await hashFile(path.join(result,'中文 视频.mp4'));
    expect(resultHash).toBe(sourceHash);
    expect((await fs.stat(path.join(result,'中文 视频.mp4'))).size).toBe(fileSize);
    const report = { node:process.version,platform:process.platform,fileSize,archiveBytes:(await fs.stat(archive)).size,packSeconds,importSeconds,totalSeconds:(performance.now()-started)/1000,baselineRss,peakRss,peakRssIncrease:peakRss-baselineRss,sha256:sourceHash,compressionMethod:'STORE',result:'通过' };
    await fs.writeFile(path.join(os.tmpdir(),'aivora-archive-large-report.json'),JSON.stringify(report,null,2)+'\n');
    console.log('大作品实测：'+JSON.stringify(report));
    // 非整文件缓存：1GiB输入期间峰值RSS增量应显著低于单文件大小。
    expect(peakRss-baselineRss).toBeLessThan(256*1024**2);
  } finally { clearInterval(timer);await fs.rm(dir,{recursive:true,force:true}); }
},240000);
