// Interface sound, synthesised with Web Audio (no audio files to download).
// Quiet, short cues for things that happen to your own nation.

export type Cue = 'click' | 'notice' | 'war' | 'peace' | 'research' | 'alert' | 'battle';

const KEY = 'sov.sound';

export class Sound {
  private ctx: AudioContext | null = null;
  private last = new Map<Cue, number>();
  on: boolean;

  constructor() {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* storage blocked */ }
    this.on = saved !== 'off';
  }

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem(KEY, this.on ? 'on' : 'off'); } catch { /* storage blocked */ }
    if (this.on) this.play('click');
  }

  private audio() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** One note: frequency (Hz), start offset and length (s), waveform, peak volume. */
  private tone(ctx: AudioContext, f: number, at: number, len: number, type: OscillatorType, vol: number, slideTo?: number) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + len + 0.02);
  }

  play(cue: Cue) {
    if (!this.on) return;
    const now = performance.now();
    if (now - (this.last.get(cue) ?? 0) < (cue === 'battle' ? 4000 : 250)) return; // no machine-gun repeats
    this.last.set(cue, now);
    const ctx = this.audio();
    if (!ctx) return;
    switch (cue) {
      case 'click': this.tone(ctx, 1400, 0, 0.04, 'square', 0.025); break;
      case 'notice': this.tone(ctx, 880, 0, 0.12, 'sine', 0.06); this.tone(ctx, 1320, 0.1, 0.18, 'sine', 0.05); break;
      case 'research': [660, 880, 1100, 1320].forEach((f, i) => this.tone(ctx, f, i * 0.08, 0.22, 'triangle', 0.05)); break;
      case 'peace': this.tone(ctx, 523, 0, 0.5, 'sine', 0.06); this.tone(ctx, 659, 0.12, 0.5, 'sine', 0.05); this.tone(ctx, 784, 0.24, 0.6, 'sine', 0.05); break;
      case 'alert': this.tone(ctx, 740, 0, 0.14, 'square', 0.035); this.tone(ctx, 740, 0.2, 0.14, 'square', 0.035); break;
      case 'war':
        this.tone(ctx, 110, 0, 0.6, 'sawtooth', 0.08, 55);
        this.tone(ctx, 220, 0.05, 0.4, 'square', 0.03, 110);
        this.tone(ctx, 98, 0.45, 0.7, 'sawtooth', 0.07, 49);
        break;
      case 'battle': this.tone(ctx, 90, 0, 0.25, 'sawtooth', 0.05, 40); this.tone(ctx, 70, 0.18, 0.3, 'sawtooth', 0.04, 35); break;
    }
  }
}
