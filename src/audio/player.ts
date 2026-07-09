// 薄音訊層:以 Web Audio 解碼 OGG(song.egg)並播放。
// AudioContext.currentTime 為主時鐘,供 preview 的 playhead 與日後判定對齊。
// 不含遊戲邏輯;compileChart 不碰音訊(見 docs/adr/0004)。

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;

  // 以 ctx.currentTime 為基準推算播放位置。
  private startedAtCtx = 0; // 這次 start 當下的 ctx.currentTime
  private offsetSec = 0; // 這次 start 時從歌曲的哪一秒開始
  private playing = false;

  /** 播放自然結束時的回呼(非手動 stop)。 */
  onEnded: (() => void) | null = null;

  /**
   * 按鍵 tick 音量,0..1。tick 在「最大安全峰值」處定案,此值只往下縮、不會推過天花板,
   * 故 tick 自身永不削波(歌+tick 疊加削波不在此處理,是刻意的取捨)。0 = 靜音。
   */
  tickVolume = 0.55;
  /** tick 的最大峰值(tickVolume=1 時的振幅);slider 在 0..此值間縮放。歌很大聲時可推到滿。 */
  private static readonly MAX_TICK_GAIN = 1.0;

  private ensureCtx(): AudioContext {
    this.ctx ??= new AudioContext();
    return this.ctx;
  }

  /** 解碼音訊位元組。需在使用者手勢後呼叫(AudioContext 自動播放政策)。 */
  async load(bytes: ArrayBuffer): Promise<void> {
    const ctx = this.ensureCtx();
    // decodeAudioData 可能 detach 傳入 buffer,故傳副本以利重用。
    this.buffer = await ctx.decodeAudioData(bytes.slice(0));
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** 目前播放位置(秒);未播放時停在暫停/結束的位置。 */
  get positionSec(): number {
    if (!this.ctx || !this.buffer) return 0;
    const pos = this.playing ? this.offsetSec + (this.ctx.currentTime - this.startedAtCtx) : this.offsetSec;
    return Math.min(pos, this.buffer.duration);
  }

  /** 從 fromSec 開始播放(預設接續目前位置)。 */
  async play(fromSec = this.positionSec): Promise<void> {
    if (!this.buffer) throw new Error('尚未載入音訊');
    const ctx = this.ensureCtx();
    if (ctx.state === 'suspended') await ctx.resume();

    this.stopSource();
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(ctx.destination);
    source.onended = () => {
      if (source !== this.source) return; // 被新的 start 取代,忽略
      this.playing = false;
      this.offsetSec = this.buffer?.duration ?? 0;
      this.onEnded?.();
    };
    const startOffset = Math.max(0, Math.min(fromSec, this.buffer.duration));
    source.start(0, startOffset);
    this.source = source;
    this.startedAtCtx = ctx.currentTime;
    this.offsetSec = startOffset;
    this.playing = true;
  }

  /** 暫停,保留目前位置。 */
  pause(): void {
    if (!this.playing) return;
    this.offsetSec = this.positionSec;
    this.stopSource();
    this.playing = false;
  }

  /** 停止並回到開頭。 */
  stop(): void {
    this.stopSource();
    this.playing = false;
    this.offsetSec = 0;
  }

  /**
   * 合成一個短「tick」按鍵音,供玩家對準時機。複用主 AudioContext(播放時已 resume)。
   * 三角波快速下滑 + ~45ms 指數衰減,不載外部音檔。
   * @param pitch 'high' = 清脆高音(Perfect);'low' = 稍低沉(其他判定),以利區分。
   */
  playTick(pitch: 'high' | 'low' = 'high'): void {
    if (!this.ctx || this.ctx.state !== 'running') return; // 僅在音訊已啟動時發聲
    const peak = AudioPlayer.MAX_TICK_GAIN * Math.max(0, Math.min(1, this.tickVolume));
    if (peak < 0.001) return; // 靜音:不發聲(exponentialRamp 也不能收斂到 0)
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const [f0, f1] = pitch === 'high' ? [2000, 1200] : [1150, 700];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + 0.03);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.002); // 快速起音 = 清脆
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  private stopSource(): void {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        // 尚未 start 或已停止,忽略
      }
      this.source.disconnect();
      this.source = null;
    }
  }
}
