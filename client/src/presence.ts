// Weather and shipping on the map. Both matter: storms ground aircraft and
// batter ships underneath them; trade sails the lanes, and an enemy warship
// anywhere on a lane cuts that trade (drawn red).
import { Marker, type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import type { Game } from './game';
import type { Political } from './political';
import { seasonAt } from '../../shared/seasons';

export class Presence {
  constructor(private map: MLMap, private game: Game, private pol: Political) {
    // a light snow tint over the hemisphere in winter, beyond 40 degrees, where armies slow and invaders freeze
    map.addSource('winter', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'winter', type: 'fill', source: 'winter', paint: { 'fill-color': '#eaf3f8', 'fill-opacity': 0.13, 'fill-antialias': false } });
    window.setInterval(() => this.renderWinter(), 5000);
    this.renderWinter();
    map.addSource('lanes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'lanes', type: 'line', source: 'lanes', minzoom: 1.2,
      paint: {
        'line-color': ['case', ['get', 'raided'], '#ff6b5a', '#8fd8e6'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 1.2, 0.6, 5, 1.6],
        'line-opacity': ['case', ['get', 'raided'], 0.9, ['case', ['get', 'mine'], 0.75, 0.32]],
        'line-dasharray': [2, 2],
      },
    });
    // storms are drawn by the 3D layer (cloud sheets above the ground); this keeps their state and animation
    window.setInterval(() => this.animate(), 300);
    game.on((c) => { if (c.has('war') || c.has('mine')) this.render(); });
    this.render();
  }

  /** Set once Shipping draws the lanes along routed paths through the water. */
  routedLanes = false;
  private winterNorth: boolean | null = null;

  private renderWinter() {
    const now = this.game.gameNow().getTime();
    const north = seasonAt(now, 45) === 'winter', south = seasonAt(now, -45) === 'winter';
    const key = north ? true : south ? false : null;
    if (key === this.winterNorth && this.map.getSource('winter')) return;
    this.winterNorth = key;
    const band = (a: number, b: number): GeoJSON.Feature => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-180, a], [180, a], [180, b], [-180, b], [-180, a]]] } });
    const features = [...(north ? [band(40, 84)] : []), ...(south ? [band(-84, -40)] : [])];
    (this.map.getSource('winter') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }

  private render() {
    const w = this.game.war, me = this.game.mine?.id;
    const at = (id: number) => this.pol.provinces.get(id)?.label;
    const lanes = (w.lanes ?? []).map((l) => ({
      type: 'Feature' as const,
      properties: { raided: l.raided, mine: l.a === me || l.b === me },
      geometry: { type: 'LineString' as const, coordinates: l.path.map(at).filter((p): p is [number, number] => !!p) },
    })).filter((f) => f.geometry.coordinates.length > 1);
    this.storms = w.storms ?? [];
    this.drawStorms();
    if (!this.routedLanes) (this.map.getSource('lanes') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: lanes });
  }

  // ---- storms -------------------------------------------------------------------------
  private storms: { lon: number; lat: number; r: number; kind?: 'storm' | 'hurricane'; cat?: number; name?: string }[] = [];
  private spin = 0;
  private frame = 0;
  private tick = 0;
  private labels = new Map<string, Marker>();
  /** Set by the game: thunder over your own land (a sound cue). */
  onThunder: (lon: number, lat: number) => void = () => {};

  private drawStorms() {
    const features: GeoJSON.Feature[] = [];
    const seen = new Set<string>();
    for (const [k, s] of this.storms.entries()) {
      const cos = Math.max(0.2, Math.cos((s.lat * Math.PI) / 180));
      if (s.kind === 'hurricane') {
        // one great spiral, turning (anticlockwise in the north, clockwise in the south)
        const turn = s.lat >= 0 ? -1 : 1;
        features.push({ type: 'Feature', properties: { km: s.r * 3, img: s.lat >= 0 ? 'hurricane-n' : 'hurricane-s', rot: (this.spin * turn * (1 + (s.cat ?? 1) * 0.25) + k * 47) % 360, part: 'core' }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } });
        const key = s.name ?? `h${k}`;
        seen.add(key);
        let m = this.labels.get(key);
        if (!m) {
          const el = document.createElement('div');
          el.className = 'storm-label';
          m = new Marker({ element: el, offset: [0, -14], opacityWhenCovered: '0' }).setLngLat([s.lon, s.lat]).addTo(this.map);
          this.labels.set(key, m);
        }
        m.setLngLat([s.lon, s.lat]);
        m.getElement().textContent = `Hurricane ${s.name ?? ''} · category ${s.cat ?? 1}`;
        m.getElement().dataset.tip = `<b>Hurricane ${s.name ?? ''}</b>\nCategory ${s.cat ?? 1} of 5\n<r>Aircraft grounded and ships battered beneath it</r>\n<r>On landfall it can damage buildings near its eye; they must be repaired</r>\nRare: born only over warm tropical sea`;
        continue;
      }
      // an ordinary storm: a dense core and a few ragged masses round it, each a different cloud
      features.push({ type: 'Feature', properties: { km: s.r * 1.7, img: `cloud-${k % 3}`, rot: (k * 83) % 360, part: 'core' }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + k, d = s.r * 0.55;
        features.push({
          type: 'Feature', properties: { km: s.r * (0.7 + ((i * 37 + k) % 10) / 30), img: `cloud-${(i + k + 1) % 3}`, rot: (i * 97 + k * 31) % 360, part: 'edge' },
          geometry: { type: 'Point', coordinates: [s.lon + ((d / 111) * Math.cos(a)) / cos, s.lat + (d / 111) * Math.sin(a)] },
        });
      }
    }
    for (const [key, m] of this.labels) if (!seen.has(key)) { m.remove(); this.labels.delete(key); }
    this.clouds = features.map((f) => ({ lon: (f.geometry as GeoJSON.Point).coordinates[0], lat: (f.geometry as GeoJSON.Point).coordinates[1], ...(f.properties as { km: number; img: string; rot: number; part: string }) }));
  }

  /** What the 3D layer draws: cloud sheets, rain under storm cores, and the current lightning. */
  clouds: { lon: number; lat: number; km: number; img: string; rot: number; part: string }[] = [];
  flashes: { lon: number; lat: number; km: number }[] = [];
  get rainFrame() { return this.frame; }

  private animate() {
    if (!this.storms.length) return;
    this.tick = (this.tick + 1) % 1000;
    // hurricanes turn slowly: a new angle every second is enough, and keeps the map light
    if (this.tick % 3 === 0 && this.storms.some((s) => s.kind === 'hurricane')) { this.spin = (this.spin + 4) % 360; this.drawStorms(); }
    this.frame = (this.frame + 1) % 3;
    // lightning: now and then, somewhere inside a storm
    const flashes: { lon: number; lat: number; km: number }[] = [];
    for (const s of this.storms) {
      if (Math.random() > (s.kind === 'hurricane' ? 0.12 : 0.05)) continue;
      const a = Math.random() * Math.PI * 2, d = Math.random() * s.r * 0.6;
      const cos = Math.max(0.2, Math.cos((s.lat * Math.PI) / 180));
      const lon = s.lon + ((d / 111) * Math.cos(a)) / cos, lat = s.lat + (d / 111) * Math.sin(a);
      flashes.push({ lon, lat, km: 60 + Math.random() * 80 });
      this.onThunder(lon, lat);
    }
    this.flashes = flashes;
    this.map.triggerRepaint();
  }
}
