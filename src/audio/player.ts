// 薄音訊層:以 Web Audio 解碼 OGG(song.egg)並播放。
// AudioContext.currentTime 為主時鐘,供 preview 的 playhead 與日後判定對齊。
// 不含遊戲邏輯;compileChart 不碰音訊(見 docs/adr/0004)。

/**
 * `startHoldTone` 回傳的控制把手:呼叫端負責在該停的時機呼叫一次 `stop()`。
 * 命名刻意避開「Sustain」——CONTEXT.md 的「持續段 (Sustain)」另指長按頭到尾的區段,語意不同。
 */
export interface HoldTone {
  stop(): void;
}

/** `stop()` 呼叫兩次以上是安全的(第二次以後無效果),避免呼叫端要自己追蹤是否已停過。 */
const NOOP_HOLD_TONE: HoldTone = { stop: () => {} };

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

  /**
   * 長按持續音(issue 27)的音色設計參數,源自外部調音工具的 `hitParams`——原表是一次性的
   * 「打擊/撥弦」音效設計,這裡改成起音後直接維持、按住期間持續播放,放開才進入釋音。語意:
   * - frequency:基音頻率(Hz)。
   * - ratio:疊加的第二個諧波音頻率 = frequency * ratio(非整數比 → 不諧和的鐘聲感)。
   * - brightness:0..1,第二諧波音相對基音的音量比例(音色亮度/泛音量)。
   * - shimmer:0..1,疊加在 frequency*4.07 的高頻泛音音量(金屬感的高頻閃爍)。
   * - attack(ms):音量線性升到峰值所需時間,升到峰值後維持不變(持續播放)。
   * - decay(ms):放開(`stop()`)後的釋音(release)淡出時間——原表是「一次性衰減時間常數」,
   *   改成持續音設計後重新賦予意義為釋音時間。
   * - sweep:半音數,起音瞬間音高從 frequency*2^(sweep/12) 在 35ms 內滑到 frequency(0 = 無滑音)。
   * - click/clickDecay:起音疊加的高通白噪音「喀」聲強度與其衰減時間(ms);click=0 時不發聲,只響一次。
   *
   * 原表還有 `volume`、`tail`、`delay` 三個欄位:`volume` 改用遊戲既有的 `tickVolume` 設定(見
   * `startHoldTone`),不採用原表校準的絕對值;`tail`/`delay`(回音分身)已拿掉——按住期間持續
   * 開著的回音會疊出干涉/顫音感,不想要那個效果,故不再套用回音網路。
   */
  private static readonly HOLD_TONE = {
    frequency: 1318.5,
    decay: 500,
    sweep: 0,
    brightness: 0.8,
    ratio: 1.26,
    shimmer: 0,
    attack: 3,
    click: 0,
    clickDecay: 3,
  } as const;

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

  /**
   * 起一個長按持續音,供長按過程中提示「還按著」(issue 27);音色與 `playTick` 明顯不同(鐘聲式
   * 音色,非高頻三角波),不分 high/low。起音(attack)後直接維持在該音量持續播放,不會自己衰減,
   * 一路響到呼叫端在該停的時機(放開/鎖定/破)呼叫回傳把手的 `stop()`——此時才依 `decay`
   * 當作釋音(release)時間淡出。音量取自遊戲的 `tickVolume` 設定再減半(不用調音工具原表的
   * `volume`,那個值只在獨立測試頁校過,搬進遊戲的混音裡會被 tick/音樂蓋過)。
   */
  startHoldTone(): HoldTone {
    if (!this.ctx || this.ctx.state !== 'running') return NOOP_HOLD_TONE; // 僅在音訊已啟動時發聲
    const peak = Math.max(0, Math.min(1, this.tickVolume)) * 0.5;
    if (peak < 0.001) return NOOP_HOLD_TONE; // 靜音:不發聲
    const ctx = this.ctx;
    const p = AudioPlayer.HOLD_TONE;
    const t = ctx.currentTime + 0.005;
    const a = p.attack / 1000;

    const bus = ctx.createGain();
    bus.gain.value = peak * 0.65;
    bus.connect(ctx.destination);
    const nodes: AudioNode[] = [bus];
    const envGains: GainNode[] = [];
    const oscillators: OscillatorNode[] = [];

    const tone = (freq: number, level: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(Math.min(freq * Math.pow(2, p.sweep / 12), ctx.sampleRate * 0.45), t);
      o.frequency.exponentialRampToValueAtTime(Math.min(freq, ctx.sampleRate * 0.45), t + 0.035);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + a); // 起音後維持在 level,按住期間持續播放、不自行衰減
      o.connect(g).connect(bus);
      o.start(t);
      nodes.push(o, g);
      envGains.push(g);
      oscillators.push(o);
    };
    tone(p.frequency, 0.65); // 基音
    tone(p.frequency * p.ratio, p.brightness * 0.36); // 第二諧波音
    tone(p.frequency * 4.07, p.shimmer * 0.18); // 高頻閃爍泛音

    if (p.click > 0) {
      // 起音瞬間疊加的高通白噪音「喀」聲,衰減曲線直接烤進 buffer 樣本裡,只響一次。
      const sampleCount = Math.ceil(((ctx.sampleRate * p.clickDecay) / 1000) * 7);
      const noiseBuf = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let seed = 123456;
      const tau = (ctx.sampleRate * p.clickDecay) / 1000;
      for (let i = 0; i < sampleCount; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        data[i] = (seed / 2147483648) * Math.exp(-i / tau);
      }
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const clickGain = ctx.createGain();
      source.buffer = noiseBuf;
      filter.type = 'highpass';
      filter.frequency.value = 2800;
      clickGain.gain.value = p.click * 0.35;
      source.connect(filter).connect(clickGain).connect(bus);
      source.start(t);
      source.stop(t + p.clickDecay / 1000 + 0.01); // 不循環播放的話會自然結束,顯式停止只是求明確、跟其餘一次性音源一致
      nodes.push(source, filter, clickGain);
    }

    let stopped = false;
    return {
      stop: () => {
        if (stopped) return; // 保證 stop() 呼叫兩次以上安全
        stopped = true;
        const now = ctx.currentTime;
        const release = p.decay / 1000; // decay 在持續音設計下改當釋音時間用
        for (const g of envGains) {
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(g.gain.value, now); // 從當下音量接續淡出,避免跳變喀聲
          g.gain.linearRampToValueAtTime(0, now + release);
        }
        const stopAt = now + release + 0.02;
        let cleaned = false;
        const cleanup = () => {
          if (cleaned) return; // 三顆都排程在同一個 stopAt,ended 派發順序不保證,故用旗標只清一次
          cleaned = true;
          for (const node of nodes) node.disconnect();
        };
        for (const o of oscillators) {
          o.stop(stopAt);
          o.onended = cleanup;
        }
      },
    };
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
