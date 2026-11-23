// The music player: the game's own soundtrack (composed live in code with Web
// Audio, so there are no files to ship), any tracks listed in music/playlist.json
// beside the game, and music files the player adds (kept in this browser or app).
//
// music/playlist.json, optional: [{ "title": "Theme", "file": "theme.mp3" }, ...]

const KEY = 'sov.music';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface Track { id: string; title: string; source: 'game' | 'folder' | 'yours'; url?: string; synth?: SynthSpec }

// ---- the game's own soundtrack ------------------------------------------------------
interface SynthSpec {
  bpm: number;
  root: number; // MIDI note of the key
  scale: number[]; // semitones of the scale
  chords: number[][]; // scale-degree triads, one per bar
  brass: boolean; // a brass-like lead instead of bells
  drums: 'march' | 'pulse' | 'none';
  seed: number;
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const SOUNDTRACK: Track[] = [
  { id: 'game:command', title: 'Command Room', source: 'game', synth: { bpm: 72, root: 50, scale: MINOR, chords: [[0, 2, 4], [5, 0, 2], [2, 4, 6], [6, 1, 3]], brass: false, drums: 'pulse', seed: 11 } },
  { id: 'game:watch', title: 'Long Night Watch', source: 'game', synth: { bpm: 54, root: 45, scale: MINOR, chords: [[0, 2, 4], [5, 0, 2], [2, 4, 6], [6, 1, 3], [3, 5, 0], [0, 2, 4]], brass: false, drums: 'none', seed: 23 } },
  { id: 'game:dawn', title: 'Frontier Dawn', source: 'game', synth: { bpm: 84, root: 52, scale: MINOR, chords: [[0, 2, 4], [5, 0, 2], [2, 4, 6], [6, 1, 3]], brass: true, drums: 'march', seed: 37 } },
];
const TRACK_SECONDS = 200; // each composed piece plays this long, then the next begins

const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Plays one composed piece: pads, bass, a lead line and drums, scheduled a little ahead. */
class Composer {
  private timer = 0;
  private next = 0; // time of the next beat to schedule
  private beat = 0;
  private rand: () => number;
  private noise: AudioBuffer;
  private melody = 0; // current scale degree of the lead

  constructor(private ctx: AudioContext, private out: GainNode, private spec: SynthSpec) {
    this.rand = rng(spec.seed);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  start() {
    this.next = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 100);
    this.schedule();
  }
  stop() { window.clearInterval(this.timer); }

  private note(degree: number, octave = 0) {
    const s = this.spec.scale, n = s.length;
    const d = ((degree % n) + n) % n;
    return this.spec.root + s[d] + 12 * (octave + Math.floor(degree / n));
  }

  private schedule() {
    const spb = 60 / this.spec.bpm;
    while (this.next < this.ctx.currentTime + 0.4) {
      const t = this.next, b = this.beat, bar = Math.floor(b / 4), inBar = b % 4;
      const chord = this.spec.chords[bar % this.spec.chords.length];
      if (inBar === 0) {
        this.pad(chord.map((d) => this.note(d, 0)), t, spb * 4);
        this.bass(this.note(chord[0], -1), t, spb * 2);
      }
      if (inBar === 2) this.bass(this.note(chord[0], -1), t, spb * 2 * 0.9);
      // the lead: a wandering line on the scale, with rests, leaning on chord tones
      if (this.rand() < (this.spec.brass ? 0.45 : 0.35)) {
        const step = [-2, -1, -1, 0, 1, 1, 2][Math.floor(this.rand() * 7)];
        this.melody = Math.max(-2, Math.min(9, this.melody + step));
        if (inBar === 0 && this.rand() < 0.6) this.melody = chord[Math.floor(this.rand() * 3)] + (this.melody > 4 ? 7 : 0);
        const len = spb * (this.rand() < 0.3 ? 2 : 1);
        if (this.spec.brass) this.brass(this.note(this.melody, 1), t, len); else this.bell(this.note(this.melody, 2), t);
      }
      if (this.spec.drums === 'march') {
        if (inBar === 0) this.timpani(this.note(0, -2), t);
        if (inBar === 2 || (inBar === 3 && this.rand() < 0.5)) this.snare(t, 0.05);
        if (inBar === 3 && this.rand() < 0.4) this.snare(t + spb / 2, 0.035);
      } else if (this.spec.drums === 'pulse') {
        if (inBar === 0) this.timpani(this.note(0, -2), t);
        this.snare(t + spb / 2, 0.012);
      }
      this.next += spb;
      this.beat++;
    }
  }

  private env(t: number, attack: number, hold: number, release: number, level: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setValueAtTime(level, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(this.out);
    return g;
  }

  private pad(notes: number[], t: number, len: number) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1300, t + len * 0.5);
    f.frequency.linearRampToValueAtTime(700, t + len);
    f.connect(this.env(t, len * 0.35, len * 0.4, len * 0.5, 0.05));
    for (const n of notes) for (const det of [-6, 5]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midi(n);
      o.detune.value = det;
      o.connect(f);
      o.start(t); o.stop(t + len * 1.3);
    }
  }

  private bass(n: number, t: number, len: number) {
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midi(n);
    o.connect(this.env(t, 0.02, len * 0.5, len * 0.5, 0.16));
    o.start(t); o.stop(t + len * 1.1);
  }

  private bell(n: number, t: number) {
    for (const [mult, lvl] of [[1, 0.06], [2.76, 0.018], [5.4, 0.008]] as const) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = midi(n) * mult;
      o.connect(this.env(t, 0.005, 0.02, 2.2 / mult, lvl));
      o.start(t); o.stop(t + 2.4);
    }
  }

  private brass(n: number, t: number, len: number) {
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.linearRampToValueAtTime(1800, t + 0.12);
    f.frequency.linearRampToValueAtTime(900, t + len);
    f.connect(this.env(t, 0.06, len * 0.6, 0.35, 0.07));
    for (const det of [-4, 4]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = midi(n);
      o.detune.value = det;
      o.connect(f);
      o.start(t); o.stop(t + len + 0.5);
    }
  }

  private timpani(n: number, t: number) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(midi(n) * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(midi(n), t + 0.15);
    o.connect(this.env(t, 0.005, 0.05, 0.9, 0.22));
    o.start(t); o.stop(t + 1.1);
  }

  private snare(t: number, level: number) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1800;
    s.connect(f);
    f.connect(this.env(t, 0.002, 0.01, 0.14, level));
    s.start(t, Math.random() * 0.5); s.stop(t + 0.2);
  }
}

// ---- your own files ----------------------------------------------------------------------
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('sovereign-music', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('tracks');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function loadOwn(): Promise<{ id: string; title: string; blob: Blob }[]> {
  try {
    const d = await db();
    return await new Promise((resolve) => {
      const out: { id: string; title: string; blob: Blob }[] = [];
      const c = d.transaction('tracks').objectStore('tracks').openCursor();
      c.onsuccess = () => { const cur = c.result; if (!cur) { resolve(out); return; } out.push(cur.value); cur.continue(); };
      c.onerror = () => resolve(out);
    });
  } catch { return []; }
}
async function putOwn(t: { id: string; title: string; blob: Blob }) {
  try { const d = await db(); d.transaction('tracks', 'readwrite').objectStore('tracks').put(t, t.id); } catch { /* storage blocked */ }
}
async function deleteOwn(id: string) {
  try { const d = await db(); d.transaction('tracks', 'readwrite').objectStore('tracks').delete(id); } catch { /* storage blocked */ }
}

// ---- the player ----------------------------------------------------------------------------
export class MusicPlayer {
  private el: HTMLElement;
  private tracks: Track[] = [...SOUNDTRACK];
  private index = 0;
  private playing = false;
  private wanted: boolean; // play when the player first can (browsers need a click first)
  private volume: number;
  private shuffle: boolean;
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private composer: Composer | null = null;
  private audio = new Audio();
  private trackTimer = 0;
  private objectUrls = new Map<string, string>();

  constructor(root: HTMLElement, base: string, private anchor: () => HTMLElement | null) {
    let saved: { on?: boolean; vol?: number; shuffle?: boolean; track?: string } = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { /* storage blocked */ }
    this.wanted = saved.on ?? true;
    this.volume = saved.vol ?? 0.45;
    this.shuffle = saved.shuffle ?? false;
    this.audio.addEventListener('ended', () => this.step(1));
    this.el = document.createElement('section');
    this.el.className = 'panel music-panel';
    this.el.setAttribute('aria-label', 'Music player');
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => {
      const v = (e.target as HTMLInputElement);
      if (v.id === 'musicVol') {
        this.volume = Number(v.value) / 100; this.applyVolume(); this.save();
        const o = this.el.querySelector('output'); if (o) o.textContent = `${v.value}%`;
      }
    });
    this.el.addEventListener('change', (e) => {
      const f = e.target as HTMLInputElement;
      if (f.id === 'musicFiles' && f.files) void this.addFiles([...f.files]);
    });
    void this.loadLists(base, saved.track);
    // browsers only allow sound after the player has clicked or pressed a key
    const kick = () => { if (this.wanted && !this.playing) this.play(); window.removeEventListener('pointerdown', kick, true); window.removeEventListener('keydown', kick, true); };
    window.addEventListener('pointerdown', kick, true);
    window.addEventListener('keydown', kick, true);
    document.addEventListener('pointerdown', (e) => {
      if (this.el.hidden) return;
      const t = e.target as HTMLElement;
      if (!this.el.contains(t) && !t.closest('[data-act="music"]')) this.el.hidden = true;
    });
  }

  private async loadLists(base: string, last?: string) {
    try {
      const r = await fetch(`${base}music/playlist.json`);
      if (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')) {
        const list = (await r.json()) as { title: string; file: string }[];
        for (const t of list) this.tracks.push({ id: `folder:${t.file}`, title: t.title || t.file, source: 'folder', url: `${base}music/${t.file}` });
      }
    } catch { /* no music folder */ }
    for (const t of await loadOwn()) this.addOwn(t);
    const i = this.tracks.findIndex((t) => t.id === last);
    if (i >= 0) this.index = i;
    this.render();
  }

  private addOwn(t: { id: string; title: string; blob: Blob }) {
    const url = URL.createObjectURL(t.blob);
    this.objectUrls.set(t.id, url);
    this.tracks.push({ id: t.id, title: t.title, source: 'yours', url });
  }

  private async addFiles(files: File[]) {
    for (const f of files) {
      if (!f.type.startsWith('audio/') && !/\.(mp3|ogg|oga|wav|flac|m4a|aac|opus|webm)$/i.test(f.name)) continue;
      const t = { id: `yours:${Date.now()}:${f.name}`, title: f.name.replace(/\.[^.]+$/, ''), blob: f as Blob };
      await putOwn(t);
      this.addOwn(t);
    }
    this.render();
  }

  /** For the Options menu: volume 0..1, and whether music plays. */
  get level() { return this.volume; }
  setLevel(v: number) { this.volume = Math.max(0, Math.min(1, v)); this.applyVolume(); this.save(); }
  get on() { return this.playing; }

  toggle() {
    this.el.hidden = !this.el.hidden;
    if (!this.el.hidden) {
      const a = this.anchor()?.getBoundingClientRect();
      if (a) { this.el.style.top = `${a.bottom + 8}px`; this.el.style.right = `${Math.max(8, innerWidth - a.right - 8)}px`; }
      this.render();
    }
  }

  private save() {
    try { localStorage.setItem(KEY, JSON.stringify({ on: this.wanted, vol: this.volume, shuffle: this.shuffle, track: this.tracks[this.index]?.id })); } catch { /* storage blocked */ }
  }

  private applyVolume() {
    this.audio.volume = this.volume;
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(this.volume * 0.9, this.ctx.currentTime, 0.1);
  }

  private stopAll() {
    this.composer?.stop();
    this.composer = null;
    if (this.gain && this.ctx) {
      // fade the composed music out instead of cutting it
      const g = this.gain;
      g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
      window.setTimeout(() => g.disconnect(), 1500);
      this.gain = null;
    }
    this.audio.pause();
    window.clearTimeout(this.trackTimer);
  }

  play() {
    const t = this.tracks[this.index];
    if (!t) return;
    this.stopAll();
    this.playing = true;
    this.wanted = true;
    if (t.synth) {
      if (!this.ctx) {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
      }
      void this.ctx.resume();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 0;
      this.gain.connect(this.ctx.destination);
      this.gain.gain.setTargetAtTime(this.volume * 0.9, this.ctx.currentTime, 0.6);
      this.composer = new Composer(this.ctx, this.gain, t.synth);
      this.composer.start();
      this.trackTimer = window.setTimeout(() => this.step(1), TRACK_SECONDS * 1000);
    } else if (t.url) {
      this.audio.src = t.url;
      this.audio.volume = this.volume;
      void this.audio.play().catch(() => { this.playing = false; this.render(); });
    }
    this.save();
    this.render();
  }

  pause() {
    this.stopAll();
    this.playing = false;
    this.wanted = false;
    this.save();
    this.render();
  }

  private step(dir: number) {
    if (!this.tracks.length) return;
    if (this.shuffle && this.tracks.length > 1) {
      let i = this.index;
      while (i === this.index) i = Math.floor(Math.random() * this.tracks.length);
      this.index = i;
    } else this.index = (this.index + dir + this.tracks.length) % this.tracks.length;
    if (this.playing) this.play(); else { this.save(); this.render(); }
  }

  private onClick(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mu]');
    if (!b) return;
    const a = b.dataset.mu;
    if (a === 'play') { if (this.playing) this.pause(); else this.play(); }
    else if (a === 'next') this.step(1);
    else if (a === 'prev') this.step(-1);
    else if (a === 'shuffle') { this.shuffle = !this.shuffle; this.save(); this.render(); }
    else if (a === 'pick') { this.index = Number(b.dataset.i); this.play(); }
    else if (a === 'remove') {
      const t = this.tracks[Number(b.dataset.i)];
      if (!t || t.source !== 'yours') return;
      void deleteOwn(t.id);
      const url = this.objectUrls.get(t.id);
      if (url) URL.revokeObjectURL(url);
      const wasCurrent = this.tracks[this.index] === t;
      this.tracks = this.tracks.filter((x) => x !== t);
      this.index = Math.min(this.index, this.tracks.length - 1);
      if (wasCurrent && this.playing) this.play(); else this.render();
    }
    else if (a === 'close') this.el.hidden = true;
  }

  private render() {
    if (this.el.hidden) return;
    const cur = this.tracks[this.index];
    const group = (src: Track['source'], title: string) => {
      const list = this.tracks.map((t, i) => [t, i] as const).filter(([t]) => t.source === src);
      if (!list.length && src !== 'yours') return '';
      return `<span class="label">${title}</span><ol class="music-list">${list.map(([t, i]) => `<li class="${i === this.index ? 'on' : ''}">
        <button type="button" data-mu="pick" data-i="${i}">${i === this.index && this.playing ? '▶ ' : ''}${esc(t.title)}</button>
        ${t.source === 'yours' ? `<button type="button" class="link" data-mu="remove" data-i="${i}" aria-label="Remove ${esc(t.title)}">Remove</button>` : ''}</li>`).join('')
        || '<li class="hint">None yet.</li>'}</ol>`;
    };
    this.el.innerHTML = `
      <div class="row-between"><span class="label">MUSIC</span><button type="button" class="link" data-mu="close">Close</button></div>
      <div class="music-now"><b>${cur ? esc(cur.title) : 'No track'}</b><span>${this.playing ? 'Playing' : 'Paused'}${cur ? ` · ${cur.source === 'game' ? 'soundtrack' : cur.source === 'folder' ? 'music folder' : 'your music'}` : ''}</span></div>
      <div class="music-controls">
        <button type="button" class="claim" data-mu="prev" aria-label="Previous track">⏮</button>
        <button type="button" class="claim primary" data-mu="play" aria-label="${this.playing ? 'Pause' : 'Play'}">${this.playing ? '⏸' : '▶'}</button>
        <button type="button" class="claim" data-mu="next" aria-label="Next track">⏭</button>
        <button type="button" class="claim${this.shuffle ? ' primary' : ''}" data-mu="shuffle" aria-pressed="${this.shuffle}" aria-label="Shuffle">⤮</button>
      </div>
      <div class="slider"><label for="musicVol"><span>VOLUME</span><output>${Math.round(this.volume * 100)}%</output></label>
        <input id="musicVol" type="range" min="0" max="100" value="${Math.round(this.volume * 100)}"></div>
      ${group('game', 'SOUNDTRACK')}${group('folder', 'MUSIC FOLDER')}${group('yours', 'YOUR MUSIC')}
      <label class="claim music-add">Add music files…<input id="musicFiles" type="file" accept="audio/*" multiple hidden></label>`;
  }
}
