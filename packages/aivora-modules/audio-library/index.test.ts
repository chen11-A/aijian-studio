import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadAudioLibrary, type AudioAsset } from './index.js';
let root: string;
const asset: AudioAsset = { id: '雨声', path: '声音/小雨 01.ogg', type: 'sfx', category: '环境', name: '小雨', tags: ['平静'], scene: '雨夜街道。', duration: 2, loop: true, loudness: -18, source: 'https://example.org/audio', license: 'CC0' };
const save = (value: unknown) => writeFile(path.join(root, 'manifest.json'), JSON.stringify(value));
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), '素材 测试 '));
  await mkdir(path.join(root, '声音'));
  await writeFile(path.join(root, asset.path), 'fixture');
  await save([asset]);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe('素材库读取', () => {
  it.each(['CC0', 'CC0-1.0', 'Public Domain', '公有领域'])('接受许可 %s 并保留相对路径', async license => {
    await save([{ ...asset, license }]);
    expect(await loadAudioLibrary(root)).toEqual([{ ...asset, license }]);
  });
  it('接受配乐和 HTTP 来源', async () => {
    await save([{ ...asset, type: 'music', loop: false, source: 'http://example.org/a', tags: [] }]);
    expect((await loadAudioLibrary(root))[0].type).toBe('music');
  });
  it.each([{}, [], null, '清单'])('拒绝非数组或空数组 %#', async value => {
    await save(value);
    await expect(loadAudioLibrary(root)).rejects.toThrow('非空数组');
  });
  it.each([null, [], 2])('拒绝非对象条目 %#', async value => {
    await save([value]);
    await expect(loadAudioLibrary(root)).rejects.toThrow('必须是对象');
  });
  it.each(['id', 'path', 'category', 'name', 'scene', 'source', 'license'])('拒绝空字段 %s', async key => {
    await save([{ ...asset, [key]: '' }]);
    await expect(loadAudioLibrary(root)).rejects.toThrow('不能为空');
  });
  it('拒绝字符串字段错误类型', async () => {
    await save([{ ...asset, id: 8 }]);
    await expect(loadAudioLibrary(root)).rejects.toThrow('不能为空');
  });
  it.each([
    ['type', 'video', '类型'], ['tags', '平静', '情绪标签'], ['tags', [2], '情绪标签'], ['tags', [' '], '情绪标签'],
    ['loop', 'true', '循环标记'], ['duration', '2', '时长'], ['duration', 0, '时长'], ['duration', -2, '时长'],
    ['loudness', '-18', '响度'], ['license', 'CC-BY', '许可证'], ['source', 'file:///etc/a', '来源'], ['source', '坏链接', '来源'],
  ])('拒绝无效字段 %s=%j', async (key, value, message) => {
    await save([{ ...asset, [key as string]: value }]);
    await expect(loadAudioLibrary(root)).rejects.toThrow(message as string);
  });
  it('拒绝非有限数字', async () => {
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify([asset]).replace('"duration":2', '"duration":1e999'));
    await expect(loadAudioLibrary(root)).rejects.toThrow('时长');
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify([asset]).replace('"loudness":-18', '"loudness":1e999'));
    await expect(loadAudioLibrary(root)).rejects.toThrow('响度');
  });
  it.each(['/tmp/a.ogg', 'C:\\声音\\a.ogg', 'C:a.ogg', '../a.ogg', '声音/../a.ogg', './a.ogg', '声音//a.ogg', 'a\0.ogg'])('拒绝越界路径 %s', async file => {
    await save([{ ...asset, path: file }]);
    await expect(loadAudioLibrary(root)).rejects.toThrow('路径必须');
  });
  it('拒绝重复编号', async () => {
    await save([asset, asset]);
    await expect(loadAudioLibrary(root)).rejects.toThrow('编号重复');
  });
  it('拒绝大小写不同的重复路径', async () => {
    await save([asset, { ...asset, id: '第二个', path: asset.path.toUpperCase() }]);
    await expect(loadAudioLibrary(root)).rejects.toThrow('文件路径重复');
  });
  it('拒绝非 ogg 扩展名', async () => {
    await save([{ ...asset, path: 'a.mp3' }]);
    await expect(loadAudioLibrary(root)).rejects.toThrow('.ogg');
  });
  it('拒绝文件缺失和目录充当文件', async () => {
    await save([{ ...asset, path: '缺失.ogg' }]);
    await expect(loadAudioLibrary(root)).rejects.toThrow('文件不存在');
    await mkdir(path.join(root, '目录.ogg'));
    await save([{ ...asset, path: '目录.ogg' }]);
    await expect(loadAudioLibrary(root)).rejects.toThrow('文件不存在');
  });
  it('拒绝损坏或缺失清单', async () => {
    await writeFile(path.join(root, 'manifest.json'), '{');
    await expect(loadAudioLibrary(root)).rejects.toThrow('无法读取素材清单');
    await rm(path.join(root, 'manifest.json'));
    await expect(loadAudioLibrary(root)).rejects.toThrow('无法读取素材清单');
  });
  it('拒绝素材和清单的库外符号链接', async () => {
    const external = await mkdtemp(path.join(tmpdir(), '外部素材'));
    try {
      await writeFile(path.join(external, 'a.ogg'), 'outside');
      await symlink(path.join(external, 'a.ogg'), path.join(root, '链接.ogg'));
      await save([{ ...asset, path: '链接.ogg' }]);
      await expect(loadAudioLibrary(root)).rejects.toThrow('路径越界');
      await writeFile(path.join(external, 'manifest.json'), JSON.stringify([asset]));
      await rm(path.join(root, 'manifest.json'));
      await symlink(path.join(external, 'manifest.json'), path.join(root, 'manifest.json'));
      await expect(loadAudioLibrary(root)).rejects.toThrow('无法读取素材清单');
    } finally { await rm(external, { recursive: true, force: true }); }
  });
});

it('短于400毫秒的单次音效可明确标记无法测量积分响度',async()=>{
 const short={...asset,duration:.2,loudness:null,loudnessNote:'不足400毫秒，无法测量积分响度'};
 await save([short]);expect((await loadAudioLibrary(root))[0].loudness).toBeNull();
 for(const bad of [{...short,duration:.4},{...short,loudnessNote:''},{...short,loudnessNote:undefined},{...short,type:'music'}]){await save([bad]);await expect(loadAudioLibrary(root)).rejects.toThrow('响度');}
});
