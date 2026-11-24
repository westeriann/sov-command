// A star on the map at every nation's capital, coloured by its form of government.
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import type { Game } from './game';
import type { Political } from './political';

/** Star colours by government (shown in the map key and the manual). */
export const GOV_STAR: Record<string, [string, string]> = {
  democracy: ['#5ab0ff', 'Democracy'],
  technocracy: ['#6af0c0', 'Technocracy'],
  autocracy: ['#ff5caa', 'Autocracy'],
  junta: ['#e0b04a', 'Military junta'],
};

export class Capitals {
  private key = '';
  constructor(private map: MLMap, private game: Game, private pol: Political) {
    map.addImage('capital-star', starIcon(), { pixelRatio: 2, sdf: true });
    map.addSource('capitals', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'capitals', type: 'symbol', source: 'capitals', minzoom: 1.2,
      layout: {
        'icon-image': 'capital-star', 'icon-size': ['interpolate', ['linear'], ['zoom'], 1.2, 0.45, 4, 0.7, 7, 0.95] as never,
        'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-offset': [0, -14],
      },
      paint: {
        'icon-color': ['match', ['get', 'g'], ...Object.entries(GOV_STAR).flatMap(([k, [c]]) => [k, c]), '#c9ccd2'] as never,
        'icon-halo-color': 'rgba(4, 10, 20, 0.85)', 'icon-halo-width': 1.4,
      },
    });
    game.on((c) => { if (c.has('nations') || c.has('war') || c.has('mine')) this.render(); });
    this.render();
  }

  private render() {
    const feats: GeoJSON.Feature[] = [];
    for (const n of this.pol.nations.values()) {
      const pub = this.game.nations.get(n.id);
      if (pub?.annexedBy) continue;
      const p = this.pol.provinces.get(n.capital);
      if (!p) continue;
      feats.push({ type: 'Feature', properties: { g: pub?.government ?? '', id: n.id }, geometry: { type: 'Point', coordinates: p.label } });
    }
    const key = feats.map((f) => `${f.properties!.id}${f.properties!.g}`).join(',');
    if (key === this.key) return; // unchanged: leave the map alone
    this.key = key;
    (this.map.getSource('capitals') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: feats });
  }
}

/** A five-pointed star as a signed-distance image, so the map can colour it. */
function starIcon(): ImageData {
  const S = 48, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 9 : 21, a = -Math.PI / 2 + (i * Math.PI) / 5;
    g[i ? 'lineTo' : 'moveTo'](24 + r * Math.cos(a), 25 + r * Math.sin(a));
  }
  g.closePath(); g.fill();
  return g.getImageData(0, 0, S, S);
}
