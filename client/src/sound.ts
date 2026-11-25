// The game's sound: recorded effects from client/public/sfx (see the Credits),
// played through Web Audio in three groups with their own volumes: interface,
// effects and ambience. Until the files have loaded (or if one cannot load) the
// old synthesised cues play instead, so the game is never silent.
import { ASSET_BASE } from './config';

export type Cue =
  | 'click' | 'notice' | 'war' | 'peace' | 'research' | 'alert' | 'battle' | 'urgent' | 'thunder'
  | 'hover' | 'open' | 'close' | 'tab' | 'toggle' | 'confirm' | 'error'
  | 'dispatch' | 'election' | 'smallarms' | 'air_strike' | 'helicopter' | 'naval_gun' | 'explosion' | 'distant_blast'
  | 'missile_launch' | 'nuke' | 'order_ack' | 'recruit_done' | 'build_done' | 'deal_signed' | 'market_alert'
  | 'ring' | 'p_city' | 'p_farm' | 'p_wind' | 'p_goat' | 'p_forest' | 'p_desert' | 'p_waves' | 'p_gulls' | 'p_industry' | 'p_base';
export type Loop = 'amb_rain' | 'amb_crowd';
export type Group = 'ui' | 'fx' | 'amb';

/** Each cue: its files (played together) and its volume group. */
const CUES: Record<Cue, [string[], Group]> = {
  click: [['ui_click'], 'ui'], hover: [['ui_hover'], 'ui'], open: [['ui_open'], 'ui'], close: [['ui_close'], 'ui'],
  tab: [['ui_tab'], 'ui'], toggle: [['ui_toggle'], 'ui'], confirm: [['ui_confirm'], 'ui'], error: [['ui_error'], 'ui'],
  notice: [['notice'], 'fx'], dispatch: [['dispatch'], 'fx'], alert: [['alert'], 'fx'], urgent: [['urgent'], 'fx'],
  war: [['war'], 'fx'], peace: [['peace'], 'fx'], research: [['research'], 'fx'], election: [['election'], 'fx'],
  battle: [['battle_land'], 'fx'], smallarms: [['battle_smallarms'], 'fx'], air_strike: [['air_strike'], 'fx'],
  helicopter: [['helicopter'], 'fx'], naval_gun: [['naval_gun'], 'fx'], explosion: [['explosion'], 'fx'],
  distant_blast: [['distant_blast'], 'fx'], missile_launch: [['missile_launch'], 'fx'], nuke: [['nuke'], 'fx'],
  order_ack: [['order_ack'], 'fx'], recruit_done: [['recruit_done'], 'fx'], thunder: [['amb_storm'], 'fx'],
  build_done: [['build_done'], 'fx'], deal_signed: [['deal_signed'], 'fx'], market_alert: [['market_alert'], 'fx'],
  ring: [['ui_hover'], 'ui'],
  // a province's sound when you click it (one of the files, picked at random)
  p_city: [['prov_city'], 'amb'], p_farm: [['prov_farm_sheep', 'prov_farm_birds'], 'amb'], p_wind: [['prov_wind'], 'amb'],
  p_goat: [['prov_goat'], 'amb'], p_forest: [['prov_forest'], 'amb'], p_desert: [['prov_desert'], 'amb'], p_waves: [['prov_waves'], 'amb'],
  p_gulls: [['prov_gulls'], 'amb'], p_industry: [['prov_industry'], 'amb'], p_base: [['order_ack'], 'amb'] /* radio traffic from the base */,
};
/** Cues whose files are alternatives (one plays) rather than layers (all play). */
const PICK_ONE = new Set<Cue>(['p_farm']);
/** Played faster (higher) than recorded. */
const RATE: Partial<Record<Cue, number>> = { ring: 1.45 };
const LOOPS: Loop[] = ['amb_rain', 'amb_crowd'];
/** How long before the same cue may sound again (ms): no machine-gun repeats. */
const GAP: Partial<Record<Cue, number>> = { battle: 4000, smallarms: 3000, thunder: 9000, air_strike: 6000, naval_gun: 4000, distant_blast: 5000,
  election: 8000, war: 6000, urgent: 3000, missile_launch: 8000, nuke: 8000, hover: 70, helicopter: 6000, order_ack: 400, ring: 90,
  p_city: 1200, p_farm: 1200, p_wind: 1200, p_goat: 1200, p_forest: 1200, p_desert: 1200, p_waves: 1200, p_gulls: 1200, p_industry: 1200, p_base: 1200 };

const KEY = 'sov.sound';
const LEVELS_KEY = 'sov.sound.levels';
export const SOUND_GROUPS: [Group, string][] = [['ui', 'Interface'], ['fx', 'Effects and alerts'], ['amb', 'Ambience']];

export class Sound {
  private ctx: AudioContext | null = null;
  private last = new Map<Cue, number>();
  private gains = new Map<Group, GainNode>();
  private buffers = new Map<string, AudioBuffer>();
  private loading = false;
  private loops = new Map<Loop, { src: AudioBufferSourceNode; gain: GainNode }>();
  private wantLoops = new Map<Loop, number>();
  levels: Record<Group, number> = { ui: 0.7, fx: 0.85, amb: 0.5 };
  on: boolean;

  constructor() {
    let saved: string | null = null;
    try { saved = localStorage.getItem(KEY); } catch { /* storage blocked */ }
    this.on = saved !== 'off';
    try { Object.assign(this.levels, JSON.parse(localStorage.getItem(LEVELS_KEY) ?? '{}')); } catch { /* storage blocked */ }
  }

  toggle() {
    this.on = !this.on;
    try { localStorage.setItem(KEY, this.on ? 'on' : 'off'); } catch { /* storage blocked */ }
    if (this.on) { this.play('click'); this.syncLoops(); } else for (const l of LOOPS) this.stopLoop(l);
  }

  setLevel(g: Group, v: number) {
    this.levels[g] = Math.max(0, Math.min(1, v));
    try { localStorage.setItem(LEVELS_KEY, JSON.stringify(this.levels)); } catch { /* storage blocked */ }
    const gain = this.gains.get(g);
    if (gain && this.ctx) gain.gain.setTargetAtTime(this.levels[g], this.ctx.currentTime, 0.05);
  }

  private audio() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      for (const [g] of SOUND_GROUPS) {
        const node = this.ctx.createGain();
        node.gain.value = this.levels[g];
        node.connect(this.ctx.destination);
        this.gains.set(g, node);
      }
      void this.load();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Fetch and decode every sound file once, after the first sound is asked for. */
  private async load() {
    if (this.loading || !this.ctx) return;
    this.loading = true;
    const names = new Set<string>([...Object.values(CUES).flatMap(([f]) => f), ...LOOPS]);
    await Promise.all([...names].map(async (n) => {
      try {
        const r = await fetch(`${ASSET_BASE}sfx/${n}.ogg`);
        if (!r.ok) return;
        this.buffers.set(n, await this.ctx!.decodeAudioData(await r.arrayBuffer()));
      } catch { /* this one stays synthesised */ }
    }));
    this.syncLoops();
  }

  /** Play a cue. `vol` (0..1) scales it, for things far from the camera. */
  play(cue: Cue, vol = 1) {
    if (!this.on || vol <= 0.01) return;
    const now = performance.now();
    if (now - (this.last.get(cue) ?? 0) < (GAP[cue] ?? 250)) return;
    this.last.set(cue, now);
    const ctx = this.audio();
    if (!ctx) return;
    const [files, group] = CUES[cue];
    let bufs = files.map((f) => this.buffers.get(f)).filter((b): b is AudioBuffer => !!b);
    if (PICK_ONE.has(cue) && bufs.length > 1) bufs = [bufs[Math.floor(Math.random() * bufs.length)]];
    if (!bufs.length) { this.synth(ctx, cue); return; }
    for (const b of bufs) {
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = b;
      src.playbackRate.value = RATE[cue] ?? 1;
      g.gain.value = vol;
      src.connect(g).connect(this.gains.get(group)!);
      src.start();
    }
  }

  /** Keep an ambience loop playing at a level (0 stops it). */
  loop(name: Loop, level: number) {
    this.wantLoops.set(name, level);
    if (this.ctx) this.syncLoops();
  }

  private syncLoops() {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const name of LOOPS) {
      const want = this.on ? (this.wantLoops.get(name) ?? 0) : 0;
      const cur = this.loops.get(name);
      if (want > 0.01) {
        const buf = this.buffers.get(name);
        if (!buf) continue;
        if (!cur) {
          const src = ctx.createBufferSource(), gain = ctx.createGain();
          src.buffer = buf; src.loop = true;
          gain.gain.value = 0;
          src.connect(gain).connect(this.gains.get('amb')!);
          src.start();
          this.loops.set(name, { src, gain });
        }
        this.loops.get(name)!.gain.gain.setTargetAtTime(want, ctx.currentTime, 0.8);
      } else if (cur) this.stopLoop(name);
    }
  }

  private stopLoop(name: Loop) {
    const cur = this.loops.get(name);
    if (!cur || !this.ctx) return;
    cur.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    cur.src.stop(this.ctx.currentTime + 2);
    this.loops.delete(name);
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
    o.connect(g).connect(this.gains.get('fx') ?? ctx.destination);
    o.start(t);
    o.stop(t + len + 0.02);
  }

  /** The original synthesised cues, used until (or unless) the recordings load. */
  private synth(ctx: AudioContext, cue: Cue) {
    switch (cue) {
      case 'click': case 'tab': case 'toggle': case 'confirm': this.tone(ctx, 1400, 0, 0.04, 'square', 0.025); break;
      case 'notice': case 'dispatch': case 'deal_signed': case 'market_alert': case 'build_done': case 'recruit_done':
        this.tone(ctx, 880, 0, 0.12, 'sine', 0.06); this.tone(ctx, 1320, 0.1, 0.18, 'sine', 0.05); break;
      case 'research': [660, 880, 1100, 1320].forEach((f, i) => this.tone(ctx, f, i * 0.08, 0.22, 'triangle', 0.05)); break;
      case 'peace': case 'election': this.tone(ctx, 523, 0, 0.5, 'sine', 0.06); this.tone(ctx, 659, 0.12, 0.5, 'sine', 0.05); this.tone(ctx, 784, 0.24, 0.6, 'sine', 0.05); break;
      case 'alert': case 'error': this.tone(ctx, 740, 0, 0.14, 'square', 0.035); this.tone(ctx, 740, 0.2, 0.14, 'square', 0.035); break;
      case 'war':
        this.tone(ctx, 110, 0, 0.6, 'sawtooth', 0.08, 55);
        this.tone(ctx, 220, 0.05, 0.4, 'square', 0.03, 110);
        this.tone(ctx, 98, 0.45, 0.7, 'sawtooth', 0.07, 49);
        break;
      case 'thunder': {
        // a crack, then a long low rumble: filtered noise
        const len = 2.6, buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate), d = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < d.length; i++) { last = last * 0.985 + (Math.random() * 2 - 1) * 0.15; d[i] = last; }
        const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        src.buffer = buf; f.type = 'lowpass'; f.frequency.value = 420;
        const t = ctx.currentTime;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9, t + 0.04); g.gain.exponentialRampToValueAtTime(0.25, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        src.connect(f); f.connect(g); g.connect(this.gains.get('fx') ?? ctx.destination);
        src.start(t); src.stop(t + len);
        break;
      }
      case 'urgent':
        for (let i = 0; i < 3; i++) {
          this.tone(ctx, 620, i * 0.42, 0.2, 'square', 0.05, 900);
          this.tone(ctx, 900, i * 0.42 + 0.2, 0.2, 'square', 0.05, 620);
        }
        this.tone(ctx, 82, 0, 1.2, 'sawtooth', 0.05, 60);
        break;
      case 'battle': case 'smallarms': case 'naval_gun': case 'explosion': case 'distant_blast': case 'nuke': case 'missile_launch': case 'air_strike':
        this.tone(ctx, 90, 0, 0.25, 'sawtooth', 0.05, 40); this.tone(ctx, 70, 0.18, 0.3, 'sawtooth', 0.04, 35); break;
      default: break; // hover, open, close, order and helicopter stay silent without their recordings
    }
  }
}
