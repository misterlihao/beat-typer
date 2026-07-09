// zip 來源:用 JSZip 在瀏覽器內解壓 BeatSaver 譜面包。issue 04 的 ChartSource。
// loader 只搬 bytes,不 parse、不含遊戲邏輯(見 docs/adr/0005)。
// readFile 用「大小寫不敏感 + basename 比對」吃掉髒 zip 的大小寫/巢狀雜訊(見 docs/adr/0007)。
import JSZip from 'jszip';
import type { ChartSource, SongHandle } from './types.ts';

/** JSZip.loadAsync 接受的二進位輸入(瀏覽器丟 File/Blob;測試丟 Uint8Array)。 */
type ZipInput = ArrayBuffer | Uint8Array | Blob;

/** 取路徑最後一段並轉小寫(去 / 與 \ 的目錄前綴)。 */
function baseKey(path: string): string {
  const seg = path.split(/[/\\]/).pop() ?? path;
  return seg.toLowerCase();
}

/** 由 zip 檔名推歌名備援:去目錄、去 .zip 副檔名。 */
function titleFromFilename(filename: string): string {
  const seg = filename.split(/[/\\]/).pop() ?? filename;
  return seg.replace(/\.zip$/i, '') || seg;
}

class ZipSongHandle implements SongHandle {
  constructor(
    readonly title: string,
    private readonly byBase: ReadonlyMap<string, JSZip.JSZipObject>,
  ) {}

  async readFile(name: string): Promise<ArrayBuffer> {
    const entry = this.byBase.get(baseKey(name));
    if (!entry) throw new Error(`譜面包缺少檔案「${name}」`);
    return entry.async('arraybuffer');
  }
}

/** zip 譜面來源。一個 zip = 一首歌。 */
export class ZipChartSource implements ChartSource {
  constructor(
    private readonly data: ZipInput,
    private readonly filename: string,
  ) {}

  async listSongs(): Promise<SongHandle[]> {
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(this.data);
    } catch {
      throw new Error('這個檔案不是有效的 zip 譜面包');
    }

    // 建 basename(小寫)→ entry 對照表;撞名取第一個 + warn(見 docs/adr/0007)。
    const byBase = new Map<string, JSZip.JSZipObject>();
    zip.forEach((path, entry) => {
      if (entry.dir) return;
      const key = baseKey(path);
      if (byBase.has(key)) {
        console.warn(`zip 內有多個同名檔「${key}」,採用先出現的那個`);
        return;
      }
      byBase.set(key, entry);
    });

    return [new ZipSongHandle(titleFromFilename(this.filename), byBase)];
  }
}
