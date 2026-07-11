// BSR 來源(issue 16):貼 BeatSaver 代號(或 !bsr 代號 / URL)即從伺服器下載譜面。
// loader 只搬 bytes:抓 metadata → 取 downloadURL → 抓 zip → 委派給 ZipChartSource 解壓(不 parse、不含遊戲邏輯)。
// 實測 API 與 r2cdn 皆放行跨域(access-control-allow-origin:*),純前端可行(見 docs/issues/16)。
import type { ChartSource, SongHandle } from './types.ts';
import { ZipChartSource } from './zip.ts';

const API_BASE = 'https://api.beatsaver.com/maps/id/';

/** BeatSaver map JSON 的最小形狀(只取我們用到的欄位)。 */
interface BeatSaverVersion {
  readonly state?: string;
  readonly downloadURL?: string;
}
interface BeatSaverMap {
  readonly versions?: readonly BeatSaverVersion[];
  readonly metadata?: { readonly songName?: string };
}

/**
 * 從使用者輸入解析出 BSR 代號。純函式,可測。
 * 接受:純代號 `5277c`、`!bsr 5277c`(不分大小寫,BeatSaver「複製 !bsr」按鈕產物)、
 * 完整 URL `https://beatsaver.com/maps/5277c`。無法解析回 null。
 */
export function parseBsrCode(input: string): string | null {
  // 去開頭可選的 "!bsr "(不分大小寫)。
  let s = input.trim().replace(/^!bsr\s+/i, '').trim();
  // 若貼的是 BeatSaver URL,抽出 /maps/{key}。
  const urlMatch = /beatsaver\.com\/maps\/([0-9a-f]+)/i.exec(s);
  if (urlMatch) s = urlMatch[1]!;
  // BeatSaver 代號為 hex 字串。
  return /^[0-9a-f]+$/i.test(s) ? s.toLowerCase() : null;
}

/**
 * 從 BeatSaver map JSON 挑下載網址:取第一個 state==="Published" 的版本(= 官網下載鈕給的那版)。
 * 無任何 Published 版本則報錯。純函式,可測。
 */
export function pickDownloadUrl(map: BeatSaverMap): string {
  const v = map.versions?.find((x) => x.state === 'Published' && typeof x.downloadURL === 'string');
  if (!v?.downloadURL) throw new Error('這張圖查無可下載版本');
  return v.downloadURL;
}

const NETWORK_ERROR = '下載失敗,請檢查網路連線後再試';

/** BSR 譜面來源。一個代號 = 一首歌。傳入的 code 應已由 parseBsrCode 驗證過。 */
export class BsrChartSource implements ChartSource {
  // code 公開:編排層據此把成功載入的 BSR 記入「最近遊玩」清單(issue 19 切片)。
  constructor(public readonly code: string) {}

  async listSongs(): Promise<SongHandle[]> {
    // 1) 查 metadata。
    let res: Response;
    try {
      res = await fetch(API_BASE + this.code);
    } catch {
      throw new Error(NETWORK_ERROR);
    }
    if (res.status === 404) throw new Error('找不到這個 BSR 代號的譜面');
    if (!res.ok) throw new Error(NETWORK_ERROR);
    let map: BeatSaverMap;
    try {
      map = (await res.json()) as BeatSaverMap;
    } catch {
      throw new Error('BeatSaver 回應無法解析');
    }

    // 2) 挑第一個 Published 版本的下載網址(無版本 → pickDownloadUrl 報錯)。
    const url = pickDownloadUrl(map);

    // 3) 下載 zip bytes。
    let zipRes: Response;
    try {
      zipRes = await fetch(url);
    } catch {
      throw new Error(NETWORK_ERROR);
    }
    if (!zipRes.ok) throw new Error(NETWORK_ERROR);
    const bytes = await zipRes.arrayBuffer();

    // 4) 委派給 ZipChartSource 解壓;歌名/封面仍由下游讀 Info.dat 為準,
    //    API 的 songName 只當 SongHandle.title 備援(Info.dat 缺 _songName 時)。
    const titleFallback = map.metadata?.songName ?? this.code;
    return new ZipChartSource(bytes, titleFallback).listSongs();
  }
}
