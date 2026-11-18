// Weather and shipping on the map. Both matter: storms ground aircraft and
// batter ships underneath them; trade sails the lanes, and an enemy warship
// anywhere on a lane cuts that trade (drawn red).
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
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
    map.addSource('storms', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'lanes', type: 'line', source: 'lanes', minzoom: 1.2,
      paint: {
        'line-color': ['case', ['get', 'raided'], '#ff6b5a', '#8fd8e6'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 1.2, 0.6, 5, 1.6],
        'line-opacity': ['case', ['get', 'raided'], 0.9, ['case', ['get', 'mine'], 0.75, 0.32]],
        'line-dasharray': [2, 2],
      },
    });
    // clouds: a cluster of soft discs per storm, sized in kilometres on the ground
    map.addLayer({
      id: 'storms', type: 'circle', source: 'storms',
      paint: {
        'circle-color': '#f2f6f8',
        'circle-blur': 0.9,
        'circle-opacity': 0.42,
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 0, ['/', ['get', 'km'], 156.5], 10, ['/', ['get', 'km'], 0.1529]],
        'circle-pitch-alignment': 'map',
      },
    });
    game.on((c) => { if (c.has('war') || c.has('mine')) this.render(); });
    this.render();
  }

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
    const clouds: GeoJSON.Feature[] = [];
    for (const s of w.storms ?? []) {
      // a ragged ring of cloud around a dense core
      const cos = Math.max(0.2, Math.cos((s.lat * Math.PI) / 180));
      clouds.push({ type: 'Feature', properties: { km: s.r * 0.55 }, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + s.lon, d = s.r * 0.55;
        clouds.push({
          type: 'Feature', properties: { km: s.r * (0.32 + ((i * 37) % 10) / 50) },
          geometry: { type: 'Point', coordinates: [s.lon + ((d / 111) * Math.cos(a)) / cos, s.lat + (d / 111) * Math.sin(a)] },
        });
      }
    }
    (this.map.getSource('lanes') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: lanes });
    (this.map.getSource('storms') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: clouds });
  }
}
