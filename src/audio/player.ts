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
  /**
   * 歌曲整體衰減係數:Beat Saber 譜面的音樂普遍偏大聲、蓋過按鍵 tick,故一律減半。
   * 寫死常數(非滑桿):tick 已有獨立音量,歌只需一個固定的配平(見 grilling 2026-07-12)。
   */
  private static readonly MUSIC_GAIN = 0.5;
  private musicGainNode: GainNode | null = null;

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

  /**
   * 解鎖 AudioContext(自動播放政策:suspended → running)。需在使用者手勢的黏性啟用內呼叫。
   * 供「播放前先要發聲」的情境(如倒數的 tick):先 resume,playTick 才出得了聲。
   */
  async resume(): Promise<void> {
    const ctx = this.ensureCtx();
    if (ctx.state === 'suspended') await ctx.resume();
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
    // 歌曲經 musicGain 衰減後再進 destination(tick 仍直連,不受此係數影響)。node 一次建立、重用。
    this.musicGainNode ??= (() => {
      const g = ctx.createGain();
      g.gain.value = AudioPlayer.MUSIC_GAIN;
      g.connect(ctx.destination);
      return g;
    })();
    const source = ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.musicGainNode);
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
   * @param fancy 強調音符(issue 22):在底層 tick 之上疊一層「華麗」琶音閃光——不是變大聲,
   *   是變豐富。底層判定音高不動,故 Perfect/Good 聽辨完全不受影響。
   */
  playTick(pitch: 'high' | 'low' = 'high', fancy = false): void {
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
    // 強調音符(issue 22):同一顆 tick 也送進 echo 匯流排,長出幾聲迴音——聲音本體與普通打擊一致,只多了迴盪。
    if (fancy) gain.connect(this.ensureEchoBus());
    osc.start(t);
    osc.stop(t + 0.06);
  }

  // echo 匯流排(建一次、重用):延遲 + 回授(每次遞減),把送進來的 tick 迴盪數聲後自然消失。
  // 不含乾聲(乾聲是 tick 直連 destination),也不含混響——僅純迴音(見 grill 2026-07-13)。
  private echoBus: GainNode | null = null;
  private ensureEchoBus(): GainNode {
    if (this.echoBus) return this.echoBus;
    const ctx = this.ctx!;
    const input = ctx.createGain();
    input.gain.value = 0.55; // 迴音略低於原音
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.16;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.42; // 每次迴授遞減,約 4~5 聲後聽不見
    input.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(ctx.destination);
    this.echoBus = input;
    return input;
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
