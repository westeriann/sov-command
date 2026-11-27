// Holographic troop models for the Ground Forces, Naval Ops and Air Command
// screens. Each type is a small side-on drawing whose parts move: vehicles roll
// in on turning wheels and stop, then idle (a turret traverses, a gun lifts,
// rotors turn); ships sail in and ride the swell while their guns train; aircraft
// fly in and hold, bobbing, with their engines glowing. Drawn in the theme's
// cyan as a projection, in SVG with CSS animation (still when reduced motion is asked).
import type { UnitType } from '../../shared/military';

const wheel = (x: number, y: number, r: number) => `<g class="wheel" style="transform-origin:${x}px ${y}px"><circle cx="${x}" cy="${y}" r="${r}"/><path d="M${x - r} ${y}h${2 * r}M${x} ${y - r}v${2 * r}"/></g>`;
const wheels = (xs: number[], y: number, r: number) => xs.map((x) => wheel(x, y, r)).join('');

/** viewBox 0 0 160 90; ground line at y = 78. */
const MODELS: Record<UnitType, string> = {
  infantry: [0, 34, 68].map((dx, i) => `<g class="walker" style="animation-delay:${-i * 0.18}s" transform="translate(${36 + dx} 0)">
      <circle cx="0" cy="34" r="5"/><path d="M-6 32h12"/><path class="body" d="M0 39v19"/><path class="arm" d="M0 43l-7 9M0 43l8 4 10-6"/>
      <path class="leg-a" d="M0 58l-6 19"/><path class="leg-b" d="M0 58l6 19"/></g>`).join(''),
  mechanized: `<path class="hull" d="M18 66l8-20h90l16 12v12l-6 6H24z"/><path d="M40 46v-8h26v8"/><g class="turret" style="transform-origin:53px 40px"><path class="barrel" d="M64 40h26"/></g>
      <path d="M30 56h84" class="detail"/>${wheels([36, 60, 84, 108], 72, 7)}`,
  armored: `<path class="hull" d="M14 60l10-10h104l12 10-8 12H22z"/>
      <g class="turret" style="transform-origin:72px 44px"><path d="M50 50l6-12h34l8 12z"/><g class="barrel" style="transform-origin:96px 42px"><path d="M96 42h46"/><path d="M138 39v6"/></g><path d="M64 38v-5h10v5" class="detail"/></g>
      <path class="track" d="M20 64h120a8 8 0 0 1 0 14H20a8 8 0 0 1 0-14z"/>${wheels([28, 46, 64, 82, 100, 118, 134], 71, 5)}`,
  marines: `<path class="hull" d="M14 70l6-18h86l26 8 8 10-6 6H22z"/><path d="M40 52v-10h30v10"/><g class="turret" style="transform-origin:55px 42px"><path class="barrel" d="M68 44h24"/></g>
      <path class="wake" d="M4 80c10-4 20 4 30 0s20 4 30 0"/>${wheels([42, 70, 98], 73, 6)}`,
  // facing right, the way it flies in
  special_forces: `<g class="heli"><g transform="matrix(-1 0 0 1 160 0)"><path class="hull" d="M40 52c0-10 10-16 28-16h20c14 0 20 8 20 16s-8 14-20 14H62c-14 0-22-6-22-14z"/><path d="M108 50h40l6-8M146 50l6 8"/>
      <path d="M58 66l-4 10h52M90 66l4 10"/><path d="M88 36v-6"/><g class="rotor" style="transform-origin:88px 30px"><path d="M40 30h96"/></g>
      <g class="tail-rotor" style="transform-origin:152px 44px"><path d="M152 36v16"/></g><path class="detail" d="M70 44h14v8H70z"/></g></g>`,
  destroyers: `<g class="ship"><path class="hull" d="M8 62h144l-14 16H26z"/><path d="M40 62V50h44v12M56 50V36h14v14M62 36V22"/><path class="detail" d="M60 26h12M58 30h16"/>
      <g class="turret" style="transform-origin:112px 58px"><path d="M104 62v-6h16v6"/><path class="barrel" d="M118 57h20"/></g>
      <g class="turret aft" style="transform-origin:26px 58px"><path d="M20 62v-5h12v5"/><path class="barrel" d="M22 58h-14"/></g></g>`,
  submarines: `<g class="ship sub"><path class="hull" d="M14 66c0-6 14-10 30-10h86c12 0 20 5 20 10s-8 10-20 10H44c-16 0-30-4-30-10z"/>
      <path d="M70 56V44h20l4 12"/><g class="periscope"><path d="M84 44V30h8"/></g><path d="M8 62l10 4-10 4"/></g>`,
  carrier: `<g class="ship"><path class="hull" d="M4 60h152l-10 18H18z"/><path d="M4 60l-2-6h156l-2 6"/><path d="M112 54V36h16v18M118 36v-8"/>
      <g class="deck-jet"><path class="detail" d="M30 52l14-4h14l6 4z"/></g><path class="detail" d="M70 52h30"/></g>`,
  fighters: `<g class="jet"><path class="hull" d="M20 50l26-4h70l22 4-22 4H46z"/><path d="M70 46l-18-20h12l26 20M70 54l-18 18h12l26-18"/><path d="M30 47l-10-12h8l14 12"/>
      <path class="detail" d="M112 47c6 0 12 1 16 3"/><g class="burner"><path d="M20 48l-14 2 14 2z"/></g></g>`,
  strike: `<g class="jet"><path class="hull" d="M16 52l20-6h80l26 6-26 6H36z"/><path d="M64 46l-10-22h12l22 22M64 58l-10 20h12l22-20"/><path d="M26 48l-8-14h8l12 14"/>
      <path class="detail" d="M60 60h16M84 60h16"/><g class="burner"><path d="M16 50l-12 2 12 2z"/></g></g>`,
  drones: `<g class="jet drone"><path class="hull" d="M40 50c0-4 8-6 20-6h50c8 0 14 2 14 6s-6 6-14 6H60c-12 0-20-2-20-6z"/><path d="M60 50h-32l-8-12M28 50l-8 12M80 44l-6-16h8l14 16"/>
      <g class="prop" style="transform-origin:38px 50px"><path d="M38 40v20"/></g><circle class="detail" cx="112" cy="52" r="3"/></g>`,
  bombers: `<g class="jet"><path class="hull" d="M10 52l18-6h96l28 6-28 6H28z"/><path d="M60 46l-6-26h14l30 26M60 58l-6 24h14l30-24"/><path d="M20 47l-8-14h8l14 14"/>
      <path class="detail" d="M70 41v-4h8v4M84 41v-4h8v4"/><g class="burner"><path d="M10 50l-10 2 10 2z"/></g></g>`,
};

export interface TroopEntry { type: UnitType; label: string; count: number; queued: number; locked: boolean }

/** The parade for one arm of the forces; returns the element (built once, updated in place). */
export function troopParade(entries: TroopEntry[], domain: 'land' | 'sea' | 'air') {
  const el = document.createElement('div');
  el.className = `parade ${domain}`;
  el.innerHTML = `<div class="parade-floor"></div>${entries.map((e, i) => `
    <button type="button" class="troop" data-key="${e.type}" style="--i:${i}">
      <svg viewBox="0 0 160 90" aria-hidden="true"><g class="model">${MODELS[e.type]}</g>${domain === 'sea' ? '<path class="swell" d="M0 80c13-5 27 5 40 0s27 5 40 0 27 5 40 0 27 5 40 0"/>' : ''}</svg>
      <span class="troop-label"></span><span class="troop-count mono"></span>
      <span class="troop-tip"></span>
    </button>`).join('')}`;
  updateParade(el, entries);
  animate(el, domain);
  return el;
}

/**
 * The models' motion, by script rather than CSS: the window redraws (and re-attaches this
 * element) every game tick, which restarts CSS animations, so the entrance would replay
 * forever. Script animations keep running through that.
 */
function animate(el: HTMLElement, domain: 'land' | 'sea' | 'air') {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !el.animate) return;
  const ease = 'cubic-bezier(0.2, 0.7, 0.25, 1)';
  el.querySelectorAll<HTMLElement>('.troop').forEach((t, i) => {
    const model = t.querySelector<SVGGElement>('.model');
    if (!model) return;
    // started on the document clock at once, rather than waiting for a frame to confirm the start
    // (while the window is being re-attached that confirmation could fail to come, leaving it stuck at 0)
    const go = (target: Element | null | undefined, frames: Keyframe[], o: KeyframeAnimationOptions) => {
      if (!target) return;
      const a = target.animate(frames, { fill: 'both', ...o });
      a.startTime = document.timeline.currentTime;
    };
    const lag = i * 280;
    if (domain === 'air') {
      go(model, [{ transform: 'translate(-140%, 14px)', opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: 'none', opacity: 1 }], { duration: 1800, delay: lag, easing: ease });
      go(model.querySelector('.jet, .heli'), [{ transform: 'translateY(0)' }, { transform: 'translateY(-4px)' }, { transform: 'translateY(0)' }], { duration: 3400, delay: lag + 1800, iterations: Infinity, easing: 'ease-in-out' });
    } else if (domain === 'sea') {
      go(model, [{ transform: 'translateX(-130%)', opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: 'none', opacity: 1 }], { duration: 2200, delay: lag, easing: ease });
      go(model.querySelector('.ship'), [{ transform: 'translateY(0) rotate(0)' }, { transform: 'translateY(2px) rotate(-1deg)' }, { transform: 'translateY(0) rotate(0)' }], { duration: 4200, delay: lag + 2200, iterations: Infinity, easing: 'ease-in-out' });
    } else {
      go(model, [{ transform: 'translateX(-130%)', opacity: 0 }, { opacity: 1, offset: 0.25 }, { transform: 'none', opacity: 1 }], { duration: 1700, delay: lag, easing: ease });
    }
    // wheels turn while rolling in, then stop; soldiers stride in, then stand
    model.querySelectorAll('.wheel').forEach((w) => go(w, [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { duration: 450, delay: lag, iterations: 4 }));
    // four strides, each leg swinging out and back through its own stance, then standing as drawn (feet apart), not crossed
    model.querySelectorAll('.leg-a, .leg-b').forEach((l, k) => {
      const out = k % 2 ? 16 : -16;
      go(l, [{ transform: 'rotate(0)' }, { transform: `rotate(${out}deg)` }, { transform: 'rotate(0)' }, { transform: `rotate(${-out}deg)` }, { transform: 'rotate(0)' }], { duration: 900, delay: lag, iterations: 2 });
    });
    // idle: turrets traverse, guns lift, rotors and propellers turn, the periscope rises, engines glow
    model.querySelectorAll('.turret').forEach((g, k) => go(g, [{ transform: 'rotate(0)' }, { transform: 'rotate(-4deg)', offset: 0.3 }, { transform: 'rotate(3deg)', offset: 0.6 }, { transform: 'rotate(0)' }], { duration: 6000, delay: lag + 1800, iterations: Infinity, easing: 'ease-in-out', direction: k ? 'reverse' : 'normal' }));
    model.querySelectorAll<SVGGraphicsElement>('.barrel').forEach((g) => {
      if (!(g as SVGElement).style.transformOrigin) {
        const d = (g.matches('path') ? g : g.querySelector('path'))?.getAttribute('d') ?? '';
        const m = /M\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/.exec(d);
        if (m) (g as SVGElement).style.transformOrigin = `${m[1]}px ${m[2]}px`;
      }
    });
    model.querySelectorAll('.barrel').forEach((g) => go(g, [{ transform: 'rotate(0)' }, { transform: 'rotate(-7deg)', offset: 0.4 }, { transform: 'rotate(-2deg)', offset: 0.7 }, { transform: 'rotate(0)' }], { duration: 4500, delay: lag + 2200, iterations: Infinity, easing: 'ease-in-out' }));
    model.querySelectorAll('.rotor').forEach((g) => go(g, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0.15)' }, { transform: 'scaleX(1)' }], { duration: 350, iterations: Infinity }));
    model.querySelectorAll('.tail-rotor, .prop').forEach((g) => go(g, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0.15)' }, { transform: 'scaleY(1)' }], { duration: 180, iterations: Infinity }));
    model.querySelectorAll('.periscope').forEach((g) => go(g, [{ transform: 'translateY(6px)' }, { transform: 'translateY(0)', offset: 0.3 }, { transform: 'translateY(0)', offset: 0.7 }, { transform: 'translateY(6px)' }], { duration: 5000, delay: 2400, iterations: Infinity, easing: 'ease-in-out' }));
    model.querySelectorAll('.burner').forEach((g) => go(g, [{ opacity: 0.55 }, { opacity: 1 }], { duration: 250, iterations: Infinity, direction: 'alternate' }));
  });
}

export function updateParade(el: HTMLElement, entries: TroopEntry[]) {
  for (const e of entries) {
    const b = el.querySelector<HTMLElement>(`.troop[data-key="${e.type}"]`);
    if (!b) continue;
    b.classList.toggle('locked', e.locked);
    b.classList.toggle('none', e.count === 0);
    b.querySelector('.troop-label')!.textContent = e.label;
    b.querySelector('.troop-count')!.textContent = `${e.count}${e.queued ? ` +${e.queued}` : ''}`;
    b.querySelector('.troop-tip')!.textContent = `${e.count} fielded${e.queued ? ` · ${e.queued} in training` : ''}${e.locked ? ' · not yet available' : ' · click to recruit one more'}`;
    b.setAttribute('aria-label', `${e.label}: ${e.count} fielded${e.queued ? `, ${e.queued} in training` : ''}`);
  }
}
