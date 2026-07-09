// ZipChartSource 的行為測試:用 JSZip 現場產生記憶體 zip 當 fixture(非 mock 檔案系統)。
// 驗證 basename+大小寫查找、缺檔/壞 zip 錯誤、歌名備援(見 docs/adr/0007)。
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { ZipChartSource } from '../zip.ts';

const decoder = new TextDecoder('utf-8');

/** 產生一份記憶體 zip;entries: 路徑 → 內容。 */
async function makeZip(entries: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  return zip.generateAsync({ type: 'uint8array' });
}

async function singleSong(entries: Record<string, string>, filename = 'song.zip') {
  const bytes = await makeZip(entries);
  const [song] = await new ZipChartSource(bytes, filename).listSongs();
  return song!;
}

describe('ZipChartSource', () => {
  it('讀根層檔案並回傳原始位元組', async () => {
    const song = await singleSong({ 'Info.dat': '{"hello":1}' });
    expect(decoder.decode(await song.readFile('Info.dat'))).toBe('{"hello":1}');
  });

  it('查找大小寫不敏感:readFile("Info.dat") 命中 zip 內的 info.dat', async () => {
    const song = await singleSong({ 'info.dat': 'x' });
    expect(decoder.decode(await song.readFile('Info.dat'))).toBe('x');
  });

  it('查找忽略路徑:命中巢狀子夾內的同 basename 檔', async () => {
    const song = await singleSong({ 'Pale/Info.dat': 'nested', 'Pale/song.egg': 'audio' });
    expect(decoder.decode(await song.readFile('Info.dat'))).toBe('nested');
    expect(decoder.decode(await song.readFile('song.egg'))).toBe('audio');
  });

  it('缺檔時丟出含檔名的清楚錯誤', async () => {
    const song = await singleSong({ 'Info.dat': '{}' });
    await expect(song.readFile('song.egg')).rejects.toThrow('譜面包缺少檔案「song.egg」');
  });

  it('壞 / 非 zip 位元組 → 清楚錯誤而非崩潰', async () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(new ZipChartSource(garbage, 'bad.zip').listSongs()).rejects.toThrow(
      '這個檔案不是有效的 zip 譜面包',
    );
  });

  it('title 備援用 zip 檔名去副檔名', async () => {
    const song = await singleSong({ 'Info.dat': '{}' }, 'Pale.zip');
    expect(song.title).toBe('Pale');
  });

  it('撞名(不同子夾同 basename)取先出現者 + warn', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const song = await singleSong({ 'a/Info.dat': 'first', 'b/Info.dat': 'second' });
    const text = decoder.decode(await song.readFile('Info.dat'));
    expect(text).toBe('first');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
