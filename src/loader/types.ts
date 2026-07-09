// loader 層接縫:惰性、每首歌。三種來源(內建/zip/資料夾)共用此介面。
// 見 docs/adr/0005。loader 只搬 bytes,不解析、不含遊戲邏輯。

/** 單一首歌;檔案惰性讀取。 */
export interface SongHandle {
  /** 給玩家看的歌名(來自資料夾名或 Info.dat)。 */
  readonly title: string;
  /**
   * 讀取這首歌裡的一個檔案並回傳原始位元組。
   * 檔名比對應大小寫寬容(BeatSaver 檔名大小寫不一);
   * 01 內建自控檔名,寬容延到 issue 04/05。
   */
  readFile(name: string): Promise<ArrayBuffer>;
}

/** 一個譜面來源。 */
export interface ChartSource {
  /** 列出來源中的歌(內建/zip 回 1 首;資料夾回多首)。 */
  listSongs(): Promise<SongHandle[]>;
}
