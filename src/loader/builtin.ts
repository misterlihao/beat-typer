// 內建範例來源:從 public/sample/ 以 fetch 取檔。issue 01 唯一的 ChartSource。
import type { ChartSource, SongHandle } from './types.ts';

const SAMPLE_BASE = 'sample';

class BuiltinSongHandle implements SongHandle {
  readonly title = 'Typer Sample(內建範例)';

  async readFile(name: string): Promise<ArrayBuffer> {
    const res = await fetch(`${import.meta.env.BASE_URL}${SAMPLE_BASE}/${name}`);
    if (!res.ok) {
      throw new Error(`讀取範例檔「${name}」失敗:HTTP ${res.status}`);
    }
    return res.arrayBuffer();
  }
}

/** 內建範例來源。 */
export class BuiltinChartSource implements ChartSource {
  listSongs(): Promise<SongHandle[]> {
    return Promise.resolve([new BuiltinSongHandle()]);
  }
}
