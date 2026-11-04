import { describe,it,expect,beforeEach,afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { zipSync, unzipSync } from 'fflate';
import { packProject, importProject } from './index.js';
let dir:string,src:string,archive:string,dest:string;
beforeEach(async()=>{dir=await fs.mkdtemp(path.join(os.tmpdir(),'作品 测试-'));src=path.join(dir,'我的作品');archive=path.join(dir,'备份.aivora');dest=path.join(dir,'导入');await fs.mkdir(path.join(src,'镜头'),{recursive:true});await fs.writeFile(path.join(src,'剧本.txt'),'你好，世界！');await fs.writeFile(path.join(src,'镜头','视频.bin'),Buffer.from([0,255,3,7]));});
afterEach(async()=>{await fs.rm(dir,{recursive:true,force:true});});
async function mutate(fn:(entries:Record<string,Uint8Array>,manifest:any)=>void){await packProject(src,archive);const entries=unzipSync(await fs.readFile(archive));const m=JSON.parse(new TextDecoder().decode(entries['__aivora_manifest.json']));fn(entries,m);entries['__aivora_manifest.json']=new TextEncoder().encode(JSON.stringify(m));await fs.writeFile(archive,zipSync(entries));}
describe('作品备份',()=>{
 it('打包导入二进制及中文路径内容一致，同名自动改名',async()=>{await fs.mkdir(path.join(src,'空文件夹'));const m=await packProject(src,archive);expect(m.files).toHaveLength(2);const result=await importProject(archive,dest);expect((await fs.stat(path.join(result,'空文件夹'))).isDirectory()).toBe(true);for(const f of m.files)expect(await fs.readFile(path.join(result,f.path))).toEqual(await fs.readFile(path.join(src,f.path)));expect(await importProject(archive,dest)).toBe(path.join(dest,'我的作品 (1)'));});
 it('拒绝文件夹内输出及错误扩展名',async()=>{await expect(packProject(src,path.join(src,'x.aivora'))).rejects.toThrow('不能放');await expect(packProject(src,archive+'.zip')).rejects.toThrow('后缀');});
 it('拒绝非法限制、数量及体积超限',async()=>{await expect(packProject(src,archive,{maxFiles:0})).rejects.toThrow('限制不正确');await expect(packProject(src,archive,{maxBytes:1})).rejects.toThrow('超过');await expect(packProject(src,archive,{maxFiles:1})).rejects.toThrow('超过');});
 it('拒绝文件当文件夹和符号链接',async()=>{await expect(packProject(path.join(src,'剧本.txt'),archive)).rejects.toThrow('文件夹');await fs.symlink(path.join(src,'剧本.txt'),path.join(src,'链接'));await expect(packProject(src,archive)).rejects.toThrow('符号链接');await fs.symlink(src,path.join(dir,'链接目录'));await expect(packProject(path.join(dir,'链接目录'),archive)).rejects.toThrow('符号链接');});
 it.each(['__aivora_manifest.json','..\\危险','CON.txt','尾空格 '])('拒绝保留名 %s',async name=>{await fs.writeFile(path.join(src,name),'a');await expect(packProject(src,archive)).rejects.toThrow('文件名');});
 it('损坏文件的校验值不匹配时报中文错误',async()=>{await mutate((e,m)=>{e[m.files[0].path]=new Uint8Array([1]);});await expect(importProject(archive,dest)).rejects.toThrow('文件损坏或校验失败');});
 it('校验值错误',async()=>{await mutate((_e,m)=>{m.files[0].sha256='0'.repeat(64)});await expect(importProject(archive,dest)).rejects.toThrow('校验失败');});
 it('无清单和无效压缩文件',async()=>{await fs.writeFile(archive,zipSync({'a':new Uint8Array([1])}));await expect(importProject(archive,dest)).rejects.toThrow('缺少清单');await fs.writeFile(archive,'bad');await expect(importProject(archive,dest)).rejects.toThrow('格式损坏');});
 it.each(['../逃逸','/绝对路径','a\\b','C:/x','a/../x'])('阻止压缩包路径 %s',async name=>{await fs.writeFile(archive,zipSync({[name]:new Uint8Array([1])}));await expect(importProject(archive,dest)).rejects.toThrow('不安全');});
 it('清单错误、重复路径及清单外文件',async()=>{await mutate((e,m)=>{m.version=2;});await expect(importProject(archive,dest)).rejects.toThrow('清单不正确');await fs.unlink(archive);await mutate((e,m)=>{m.files.push(m.files[0]);});await expect(importProject(archive,dest)).rejects.toThrow('重复文件');await fs.unlink(archive);await mutate(e=>{e.extra=new Uint8Array([1]);});await expect(importProject(archive,dest)).rejects.toThrow('清单外');});
 it('清单中丢失文件',async()=>{await mutate((e,m)=>{delete e[m.files[0].path]});await expect(importProject(archive,dest)).rejects.toThrow('文件损坏');});
 it('导入文件数限制和大小限制',async()=>{await packProject(src,archive);await expect(importProject(archive,dest,{maxFiles:1})).rejects.toThrow('文件过多');await expect(importProject(archive,dest,{maxBytes:1})).rejects.toThrow('超过大小');});
 it('拒绝大小写碰撞',async()=>{await fs.writeFile(archive,zipSync({'A':new Uint8Array([1]),'a':new Uint8Array([1])}));await expect(importProject(archive,dest)).rejects.toThrow('重名');});
 it('不覆盖已有备份文件',async()=>{await packProject(src,archive);await expect(packProject(src,archive)).rejects.toThrow('打包失败');});
 it('解压写入失败清理不完整作品',async()=>{await mutate((e,m)=>{const f=m.files[0];const old=f.path;f.path='x';e.x=e[old];delete e[old];const f2=m.files[1];const old2=f2.path;f2.path='x/y';e['x/y']=e[old2];delete e[old2];});await expect(importProject(archive,dest)).rejects.toThrow('导入失败');expect(await fs.readdir(dest)).toEqual([]);});
});
describe('备份结构验证',()=>{
 it('拒绝本地头与中央目录大小不一致',async()=>{await packProject(src,archive);const b=Buffer.from(zipSync(unzipSync(await fs.readFile(archive))));b.writeUInt32LE(0x70000000,22);await fs.writeFile(archive,b);await expect(importProject(archive,dest)).rejects.toThrow('大小不一致');});
 it('打包时拒绝大小写冲突并计算目录数量',async()=>{await fs.writeFile(path.join(src,'A'),'a');await fs.writeFile(path.join(src,'a'),'b');await expect(packProject(src,archive)).rejects.toThrow('文件名');await fs.unlink(path.join(src,'a'));await expect(packProject(src,archive,{maxFiles:2})).rejects.toThrow('文件数量');});
 it('清单目录不能重复或逃出目标',async()=>{await mutate((_e,m)=>{m.directories=['../逃逸'];});await expect(importProject(archive,dest)).rejects.toThrow('文件夹路径');});
 it('错误数据报告中文',async()=>{await expect(importProject(path.join(dir,'不存在'),dest)).rejects.toThrow('文件或文件夹不存在');await fs.writeFile(archive,zipSync({'__aivora_manifest.json':new TextEncoder().encode('bad json')}));await expect(importProject(archive,dest)).rejects.toThrow('备份数据损坏');});
});
describe('流式归档边界',()=>{
 it('常见媒体格式包括大写扩展名使用STORE且导入内容完整，文本保持DEFLATE',async()=>{
  const media=['照片.jpg','照片.WEBP','视频.mov','声音.M4A','配音.mp3','视频.MP4','照片.JPEG','视频.webm','视频.MKV'];
  for(const name of media)await fs.writeFile(path.join(src,name),Buffer.alloc(10000,7));
  await fs.writeFile(path.join(src,'图片.PNG'),Buffer.alloc(10000,7));await fs.writeFile(path.join(src,'音乐.ogg'),Buffer.alloc(10000,8));
  await packProject(src,archive);const yauzl=await import('yauzl');
  const methods=await new Promise<Record<string,number>>((resolve,reject)=>yauzl.open(archive,{lazyEntries:true},(error,zip)=>{if(error){reject(error);return;}const out:Record<string,number>={};zip!.on('error',reject);zip!.on('entry',(e)=>{out[e.fileName]=e.compressionMethod;zip!.readEntry();});zip!.on('end',()=>resolve(out));zip!.readEntry();}));
  for(const name of media)expect(methods[name]).toBe(0);
  const restored=await importProject(archive,dest);
  for(const name of media)expect(await fs.readFile(path.join(restored,name))).toEqual(Buffer.alloc(10000,7));
  expect(methods['图片.PNG']).toBe(0);expect(methods['音乐.ogg']).toBe(0);expect(methods['剧本.txt']).toBe(8);
 });
 it.each(['变大','变小','删除'])('检测扫描后文件%s并清理半成品',async mode=>{
  const {vi}=await import('vitest');const realOpen=fs.open.bind(fs);
  const spy=vi.spyOn(fs,'open').mockImplementation(async (file,...args)=>{
   if(String(file)===path.join(src,'剧本.txt')){if(mode==='删除')await fs.unlink(String(file));else await fs.writeFile(String(file),mode==='变大'?'更长的文件'.repeat(100):'');}
   return realOpen(file,...args);
  });
  try { await expect(packProject(src,archive)).rejects.toThrow('打包失败');expect(await fs.stat(archive).catch(()=>null)).toBeNull(); }
  finally {spy.mockRestore();}
 });
 it.each(['符号链接','加密','不支持压缩','本地头错误','本地名错误'])('拒绝%s',async mode=>{
  await packProject(src,archive);const b=Buffer.from(zipSync(unzipSync(await fs.readFile(archive))));
  const central=b.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
  if(mode==='符号链接')b.writeUInt32LE(0xa1ff0000,central+38);
  if(mode==='加密')b.writeUInt16LE(1,central+8);
  if(mode==='不支持压缩')b.writeUInt16LE(99,central+10);
  if(mode==='本地头错误')b.writeUInt32LE(0,0);
  if(mode==='本地名错误')b[30]=0x78;
  await fs.writeFile(archive,b);await expect(importProject(archive,dest)).rejects.toThrow('导入失败');
 });
 it('空作品正常往返',async()=>{await fs.rm(src,{recursive:true});await fs.mkdir(src);const m=await packProject(src,archive);expect(m.files).toEqual([]);const out=await importProject(archive,dest);expect(await fs.readdir(out)).toEqual([]);});
});
