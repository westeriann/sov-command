// What a province sounds and looks like when you click it: a short ambience for
// its kind of place (a city's bustle, farm animals, mountain wind and now and
// then a goat, forest birds, desert wind, waves and gulls on the coast, the
// arctic wind, machinery, a parade ground) and a matching little scene on the
// map that fades in, moves for a few seconds and fades out, so nothing piles up.
import type { Map as MLMap } from 'maplibre-gl';
import type { Game } from './game';
import type { Province } from './political';
import type { Cue } from './sound';

type Scene = 'gulls' | 'birds' | 'cattle' | 'sheep' | 'goat' | 'eagle' | 'dust' | 'snow' | 'smoke' | 'crowd' | 'march' | 'fish';
const MILITARY = ['fort', 'airbase', 'air_defense', 'missile_defense', 'depot'];
const INDUSTRY = ['factory', 'mine', 'coal_plant', 'gas_plant', 'nuclear_plant'];

/** The sound and the scene for a province, by what is there and what kind of land it is. */
export function provinceMood(p: Province, game: Game, isCapital: boolean): { cue: Cue; scene: Scene } {
  const r = Math.random();
  if (p.kind === 'sea') return r < 0.5 ? { cue: 'p_gulls', scene: 'gulls' } : { cue: 'p_waves', scene: 'fish' };
  const built = (game.war.buildings[p.id] ?? []).filter((b) => b.progress >= 1).map((b) => b.type as string);
  if (built.some((b) => MILITARY.includes(b)) && r < 0.6) return { cue: 'p_base', scene: 'march' };
  if (built.some((b) => INDUSTRY.includes(b)) && r < 0.6) return { cue: 'p_industry', scene: 'smoke' };
  if (isCapital || (p.pop ?? 0) > 2.5e6) return { cue: 'p_city', scene: 'crowd' };
  if (p.coastal && r < 0.35) return { cue: 'p_gulls', scene: 'gulls' };
  switch (p.terrain) {
    case 'ice': case 'tundra': return { cue: 'p_wind', scene: 'snow' };
    case 'mountain_wet': case 'mountain_dry': return r < 0.17 ? { cue: 'p_goat', scene: 'goat' } : { cue: 'p_wind', scene: 'eagle' };
    case 'boreal': case 'temperate_forest': case 'rainforest': return { cue: 'p_forest', scene: 'birds' };
    case 'desert_sand': case 'desert_rock': case 'steppe': case 'shrubland': return { cue: 'p_desert', scene: 'dust' };
    case 'lake': return { cue: 'p_waves', scene: 'fish' };
    default: return { cue: 'p_farm', scene: r < 0.5 ? 'cattle' : 'sheep' };
  }
}

// little drawings, 40×24, in a soft white so they sit on any map colour
const BIRD = '<path d="M2 12c4-5 8-5 10 0 2-5 6-5 10 0" class="wing"/>';
const ART: Record<Scene, { svg: string; n: number; cls: string }> = {
  gulls: { svg: `<svg viewBox="0 0 24 16">${BIRD}</svg>`, n: 3, cls: 'fly' },
  birds: { svg: `<svg viewBox="0 0 24 16">${BIRD}</svg>`, n: 6, cls: 'fly small' },
  eagle: { svg: '<svg viewBox="0 0 40 16"><path d="M2 10c8-6 12-6 18-1 6-5 10-5 18 1" class="wing"/></svg>', n: 1, cls: 'soar' },
  cattle: { svg: '<svg viewBox="0 0 24 16"><path d="M3 6h14l3 2v3h-3v4h-2v-4H7v4H5v-4H3z" class="body"/><path d="M20 6l2-2" /></svg>', n: 3, cls: 'graze' },
  sheep: { svg: '<svg viewBox="0 0 24 16"><ellipse cx="11" cy="8" rx="7" ry="4.5" class="body"/><path d="M18 7h3v3h-3M7 12v3M15 12v3"/></svg>', n: 4, cls: 'graze' },
  goat: { svg: '<svg viewBox="0 0 24 16"><path d="M4 8h11l3-3 2 1-2 3v2h-2v4h-2v-4H7v4H5v-4z" class="body"/><path d="M18 5l1-3 2 1"/></svg>', n: 1, cls: 'hop' },
  dust: { svg: '<svg viewBox="0 0 40 16"><path d="M2 12c6-4 12 2 18-2s12 2 18-1" class="haze"/></svg>', n: 3, cls: 'drift' },
  snow: { svg: '<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="1.6" class="flake"/></svg>', n: 14, cls: 'fall' },
  smoke: { svg: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" class="puff"/></svg>', n: 5, cls: 'rise' },
  crowd: { svg: '<svg viewBox="0 0 6 6"><circle cx="3" cy="3" r="1.8" class="dot"/></svg>', n: 12, cls: 'walk' },
  march: { svg: '<svg viewBox="0 0 6 6"><rect x="1.5" y="1.5" width="3" height="3" class="dot"/></svg>', n: 8, cls: 'march' },
  fish: { svg: '<svg viewBox="0 0 24 12"><path d="M2 6c4-4 10-4 14 0-4 4-10 4-14 0zM16 6l5-3v6z" class="body"/></svg>', n: 2, cls: 'leap' },
};

export class ProvinceScenes {
  private layer: HTMLElement;
  private live: { el: HTMLElement; lon: number; lat: number; until: number }[] = [];
  private still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private map: MLMap) {
    this.layer = document.createElement('div');
    this.layer.className = 'prov-scenes';
    map.getContainer().appendChild(this.layer);
    map.on('move', () => this.place());
  }

  /** Play a scene at a point on the map (lon, lat). */
  play(scene: Scene, lon: number, lat: number) {
    if (this.still) return;
    const art = ART[scene];
    const el = document.createElement('div');
    el.className = `prov-scene ${art.cls}`;
    // a loose group, each member a little different in place, size and timing
    el.innerHTML = Array.from({ length: art.n }, (_, i) => {
      const x = (Math.random() - 0.5) * (art.n > 6 ? 90 : 60), y = (Math.random() - 0.5) * (art.n > 6 ? 50 : 30);
      return `<i style="--x:${x.toFixed(0)}px;--y:${y.toFixed(0)}px;--d:${(i * 0.12 + Math.random() * 0.3).toFixed(2)}s;--s:${(0.8 + Math.random() * 0.45).toFixed(2)}">${art.svg}</i>`;
    }).join('');
    this.layer.appendChild(el);
    const item = { el, lon, lat, until: performance.now() + 5200 };
    this.live.push(item);
    this.place();
    setTimeout(() => { el.remove(); this.live = this.live.filter((x) => x !== item); }, 5200);
    // only a couple at a time: the oldest goes first
    while (this.live.length > 3) { const old = this.live.shift()!; old.el.remove(); }
  }

  private place() {
    for (const s of this.live) {
      const p = this.map.project([s.lon, s.lat]);
      s.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    }
  }
}
