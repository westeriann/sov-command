// The in-game manual: every system explained, with links that open the window,
// map mode or place being described. Tables of units, buildings, technologies and
// governments are built from the game's own data, so they never go out of date.
import { BUILDINGS, BUILDING_TYPES } from '../../shared/buildings';
import { COMMODITIES, COMMODITY_INFO } from '../../shared/economy';
import { MAX_ALLIANCES, MAX_BLOC, MAX_SPY_OPS, MAX_TRADE_DEALS, PROPOSAL_DAYS, SPY_COST, SPY_MISSIONS, VOTE_DAYS } from '../../shared/diplomacy';
import { UNIT_ROLE, UNIT_SPECS, UNIT_TYPES } from '../../shared/military';
import { GOVERNMENTS, GOVERNMENT_INFO, MAX_RESEARCH_QUEUE, REFORM_DAYS, TECHS, TIER_COST } from '../../shared/research';

/**
 * Link targets, as data-go values:
 *   module:<id>            open a window (economy, market, army, navy, air, diplomacy, research, rankings, map)
 *   market:<tab>[:<good>]  open the Market on a tab and good
 *   mode:<map mode>        switch the map mode
 *   view:<id>              highlight a View setting (relief, tilt, models3d, borders...)
 *   do:<action>            capital, keys, guide, music, notices
 */
export interface ManualActions { go(target: string): void }

const L = (target: string, text: string) => `<a href="#" data-go="${target}">${text}</a>`;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface Chapter { id: string; title: string; html: () => string }

const CHAPTERS: Chapter[] = [
  {
    id: 'start', title: 'Getting started', html: () => `
      <p>Sovereign Command is a grand strategy game on a whole generated planet, starting on 1 January 2026. You lead one nation among about 145; every other nation is run by the AI under exactly the same rules.</p>
      <ol>
        <li><b>Pick a nation.</b> Click any land on the map, then <b>Take command of this nation</b> in the panel on the right.</li>
        <li><b>Set your course.</b> Choose a national focus and tax rate in that panel, then open ${L('module:economy', 'Economy')} to set the budget.</li>
        <li><b>Line up research</b> in ${L('module:research', 'R&amp;D')}, and <b>raise forces</b> in ${L('module:army', 'Ground forces')}, ${L('module:navy', 'Naval ops')} and ${L('module:air', 'Air command')}.</li>
        <li><b>Watch your</b> ${L('do:notices', 'notifications')} and the alert icons in the top bar: they tell you what needs attention.</li>
      </ol>
      <h3>Time</h3>
      <p>The world never waits: one game day passes every 10 seconds at 1×. The buttons beside the date run it 5, 10 or 20 times faster. Your game saves itself every 20 seconds and when you close it; <b>New game</b> (top bar) starts a fresh world.</p>
      <p>The ${L('do:guide', 'guided tour')} walks through the basics on screen; ${L('do:keys', 'all keyboard shortcuts')} are one key away (<kbd>?</kbd>).</p>`,
  },
  {
    id: 'map', title: 'The map', html: () => `
      <h3>Moving around</h3>
      <ul>
        <li><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> move the camera (hold <kbd>Shift</kbd> to go faster); drag with the left mouse button to turn the globe; the wheel zooms.</li>
        <li>Right-drag (or <kbd>Ctrl</kbd>-drag) tilts and turns the view. The camera also leans over the map as you zoom in: switch that off with ${L('view:tilt', 'Tilt with zoom')}.</li>
        <li>${L('view:relief', 'Relief (3D)')} raises or flattens the mountains; ${L('view:models3d', '3D models')} shows troops, ships, aircraft, cities and buildings when zoomed in.</li>
        <li>Click a province or sea zone to inspect it; right-click for a menu of what you can do there.</li>
      </ul>
      <h3>Map modes</h3>
      <ul>
        <li>${L('mode:political', 'Political')}: who owns what. Occupied land shows the occupier's colour.</li>
        <li>${L('mode:wealth', 'Wealth per person')}: income per head, poor to rich.</li>
        <li>${L('mode:satellite', 'Satellite only')}, ${L('mode:terrain', 'Terrain types')} and ${L('mode:elevation', 'Elevation')}: the land itself.</li>
        <li>${L('mode:climate', 'Temperature')}: mean temperature, hot deserts to frozen poles; mountain tops are colder.</li>
        <li>${L('mode:lights', 'Night lights')}: the planet at night. Cities glow by how well their nation is powered; blackouts go dark.</li>
      </ul>
      <p>Borders follow rivers and ridges where they can; rivers slow armies that cross them and help defenders.</p>`,
  },
  {
    id: 'nation', title: 'Your nation', html: () => `
      <p>The panel on the right shows your nation when you lead one, and whatever you have selected below it.</p>
      <h3>National focus</h3>
      <ul>
        <li><b>Economy</b>: <g>+0.6% growth a year</g>.</li>
        <li><b>Military</b>: <g>units built 20% faster, +15% reservists</g>, <r>−0.3% growth</r>.</li>
        <li><b>Research</b>: <g>research 25% faster, +0.2% growth</g>.</li>
        <li><b>Diplomacy</b>: <g>+3 stability, +0.2% growth</g>, and other nations trust you more.</li>
      </ul>
      <h3>Taxes and advisers</h3>
      <p>Taxes pay for everything; above 25% they slow growth and cost stability. Tick <b>Let advisers govern while I'm away</b> and the AI runs your nation until you return.</p>
      <p><b>Name, colour and flag</b> in the panel lets you rename your nation, pick its map colour and design its flag; achievements unlock extra emblems.</p>`,
  },
  {
    id: 'economy', title: 'Economy', html: () => `
      <p>Open ${L('module:economy', 'Economy')} (<kbd>E</kbd>). Government spends about 24% of GDP, split four ways by the budget sliders:</p>
      <ul>
        <li><b>Military</b>: the defence budget that builds and keeps your forces.</li>
        <li><b>Infrastructure</b>: raises output, the power grid and growth over time.</li>
        <li><b>Welfare</b>: stability and population growth.</li>
        <li><b>Research</b>: research points and a little growth.</li>
      </ul>
      <p><b>Treasury</b>: taxes above spending pay down debt; below it, you borrow, and debt charges interest. <b>Stability</b> (approval) falls with high taxes, shortages, blackouts, debt, occupation and war; <r>below 25, coups and revolutions become possible</r>.</p>
      <h3>Buildings</h3>
      <p>Build from a province's panel (click one of your provinces). Up to 4 projects at once, paid from the treasury:</p>
      <table class="man-table"><thead><tr><th>Building</th><th>Cost</th><th>Days</th><th>Effect</th></tr></thead><tbody>
        ${BUILDING_TYPES.map((b) => `<tr><td>${esc(BUILDINGS[b].name)}</td><td>$${BUILDINGS[b].cost}bn</td><td>${BUILDINGS[b].days}</td><td>${esc(BUILDINGS[b].text)}</td></tr>`).join('')}
      </tbody></table>
      <p><b>Borders and refugees</b>: with open borders your nation takes in refugees fleeing war and occupation next door; closed borders keep them out. The Economy window shows who came and went.</p>`,
  },
  {
    id: 'market', title: 'Market and goods', html: () => `
      <p>Open the ${L('module:market', 'Market')} (<kbd>X</kbd>). It has two tabs:</p>
      <ul>
        <li>${L('market:local', 'Local market')}: what your nation makes and uses of each good, its surplus or shortfall, trade, stocks and the world price. Click a row to chart it over time.</li>
        <li>${L('market:world', 'World market')}: one market for every nation. Prices rise when the world uses more than it makes; charts show prices, world supply against demand, and an index of all goods.</li>
      </ul>
      <h3>The goods</h3>
      <ul>
        ${COMMODITIES.map((c) => `<li>${L(`market:local:${c}`, esc(COMMODITY_INFO[c].name))} (${COMMODITY_INFO[c].unit})${c === 'oil' ? ': fuel for your forces; <r>without it they fight up to 40% weaker</r>' : c === 'metals' ? ': <r>shortages slow unit production and factories</r>' : c === 'rare_earths' ? ': <r>shortages slow research</r>' : c === 'coal' || c === 'gas' ? ': burned by power stations' : ': feeds your people'}</li>`).join('')}
      </ul>
      <p>Surpluses are sold and shortfalls bought every day at world prices. <r>Unmet needs are shortages, which hurt growth and stability.</r> Embargoes and naval blockades cut trade.</p>
      <h3>Electricity</h3>
      <p>${L('market:local:power', 'Electricity')} cannot be traded. Demand grows with your economy; the national grid grows more slowly, so a growing nation needs power stations (coal, gas, nuclear, wind and solar). <r>Blackouts cut growth and stability and stall factories.</r> See them from space in ${L('mode:lights', 'Night lights')}.</p>`,
  },
  {
    id: 'forces', title: 'Armed forces', html: () => `
      <p>Recruit in ${L('module:army', 'Ground forces')} (<kbd>F</kbd>), ${L('module:navy', 'Naval ops')} (<kbd>N</kbd>) and ${L('module:air', 'Air command')} (<kbd>B</kbd>). New units appear at your capital (land units march to your rally point if you set one).</p>
      <table class="man-table"><thead><tr><th>Unit</th><th>Attack</th><th>Defense</th><th>Speed / radius</th><th>Cost</th><th>Role</th></tr></thead><tbody>
        ${UNIT_TYPES.map((t) => { const s = UNIT_SPECS[t]; return `<tr><td>${esc(s.name)}</td><td>${s.attack}</td><td>${s.defense}</td><td>${s.range ? `${s.range} km` : `${s.speed} km/day`}</td><td>$${s.cost}bn</td><td>${esc(UNIT_ROLE[t] ?? '')}</td></tr>`; }).join('')}
      </tbody></table>
      <h3>Giving orders</h3>
      <p>Click one of your counters to select it (<kbd>Shift</kbd>-click adds more; click a selected stack again to pick one type). A command card appears with every order and its key:</p>
      <ul>
        <li><kbd>Q</kbd> order, then click a province: troops march or sail there (attacking if at war); fighters patrol, strike wings support a battle or bomb industry. Right-click does the same at once.</li>
        <li><kbd>H</kbd> halt after this leg · <kbd>T</kbd> go to the units · <kbd>L</kbd> appoint a general · <kbd>U</kbd> stand down aircraft · <kbd>Tab</kbd> next stack.</li>
      </ul>
      <p>Troops take the quickest sensible route over land, taking ship only for islands or when the sea is much faster; a march halted by a battle carries on after a win.</p>
      <h3>Fighting</h3>
      <ul>
        <li>Battles happen daily where enemies meet. Terrain, rivers, forts, generals, air support and supply all count.</li>
        <li><r>Units cut off from your territory or a port lose strength and fight weaker.</r></li>
        <li><r>Winter in cold lands slows armies by half and wears down troops on foreign soil.</r></li>
        <li>Missiles, nuclear warheads (after Nuclear deterrent), satellites and anti-satellite strikes live in ${L('module:air', 'Air command')}.</li>
      </ul>`,
  },
  {
    id: 'war', title: 'War and peace', html: () => `
      <p>Declare war from a nation's panel (click its land). Its allies may join against you, and yours with you. Your troops may enter its land; empty provinces you march into are occupied.</p>
      <p>Peace needs both sides: <b>white peace</b> (everyone goes home), <b>ceding</b> the provinces you hold, or making the loser your <b>vassal</b> (it pays tribute). A nation that loses all its land is annexed. Occupied land can rise in revolt.</p>
      <p>The ${L('module:army', 'Ground forces')} window lists your wars, what each side holds, and peace offers.</p>`,
  },
  {
    id: 'diplomacy', title: 'Diplomacy', html: () => `
      <p>Open ${L('module:diplomacy', 'Diplomacy')} (<kbd>P</kbd>). Proposals lapse after ${PROPOSAL_DAYS} game days.</p>
      <ul>
        <li><b>Trade agreements</b> (up to ${MAX_TRADE_DEALS}): <g>+0.15% growth a year each</g>. War ends them.</li>
        <li><b>Alliances</b> (up to ${MAX_ALLIANCES}): allies cross each other's land and join wars against an aggressor.</li>
        <li><b>Blocs</b> (up to ${MAX_BLOC} members): named coalitions that defend every member.</li>
        <li><b>World council</b>: table sanctions, condemnations or ceasefires; every nation votes for ${VOTE_DAYS} days.</li>
        <li><b>Embargoes</b> stop trade with a nation.</li>
        <li><b>Spies</b> ($${SPY_COST}bn each, ${MAX_SPY_OPS} at a time): ${Object.values(SPY_MISSIONS).map((m) => esc(m.name.toLowerCase())).join(', ')}.</li>
      </ul>`,
  },
  {
    id: 'research', title: 'Research and government', html: () => `
      <p>Open ${L('module:research', 'R&amp;D')} (<kbd>R</kbd>). Points come from the research budget. Press <b>Research now</b> to start a technology, or <b>Queue</b> to line up to ${MAX_RESEARCH_QUEUE} after it: the next starts by itself.</p>
      <table class="man-table"><thead><tr><th>Technology</th><th>Tier</th><th>Points</th><th>Effect</th></tr></thead><tbody>
        ${TECHS.map((t) => `<tr><td>${esc(t.name)}</td><td>${t.tier}</td><td>${TIER_COST[t.tier].toLocaleString('en-US')}</td><td>${esc(t.text)}</td></tr>`).join('')}
      </tbody></table>
      <h3>Government</h3>
      <table class="man-table"><tbody>${GOVERNMENTS.map((g) => `<tr><td>${esc(GOVERNMENT_INFO[g].name)}</td><td>${esc(GOVERNMENT_INFO[g].text)}</td></tr>`).join('')}</tbody></table>
      <p>A reform takes ${REFORM_DAYS} game days of turmoil (<r>−10 stability</r>) and is possible once a game year. Democracies hold elections; losing one blocks new wars for six months. The same window covers society: ideology, factions and propaganda.</p>`,
  },
  {
    id: 'world', title: 'The living world', html: () => `
      <ul>
        <li><b>Seasons</b>: each game year has four (opposite in the two hemispheres). Harvests peak in autumn; winter is hard on armies in cold lands.</li>
        <li><b>Weather</b>: storms ground aircraft and batter ships; droughts and hurricanes strike.</li>
        <li><b>World events</b>: crashes, pandemics, oil shocks and tech booms hit every nation.</li>
        <li><b>Climate</b>: the world's coal and gas warm the planet; low coasts flood and farmland moves toward the poles.</li>
        <li><b>Civil wars</b>: deeply unstable nations can split apart.</li>
      </ul>`,
  },
  {
    id: 'alerts', title: 'Notifications and alerts', html: () => `
      <p>The ${L('do:notices', 'notifications list')} under the date gathers news about your nation. <r>Urgent items</r> (war declared on you, provinces lost, divisions destroyed, strikes, revolts, coups) are red and sound an alarm. Click any notification to open the window it is about and look at the place it names.</p>
      <p>Alert icons in the top bar mark standing problems: at war, nothing being researched or an empty queue, blackouts, debt, low stability, shortages, units out of supply, proposals awaiting an answer. Hover one for details; click it to open the window that fixes it.</p>
      <p>Hover almost anything for a tooltip: <g>benefits in green</g>, <r>costs in red</r>.</p>`,
  },
  {
    id: 'scoring', title: 'Scoring and rankings', html: () => `
      <p>${L('module:rankings', 'Rankings')} (<kbd>K</kbd>) shows season scores, the leaderboard, nation comparisons, your missions and achievements, and replays of how the map changed.</p>`,
  },
  {
    id: 'keys', title: 'Keyboard', html: () => `
      <table class="man-table keys"><tbody>
        <tr><td><kbd>W A S D</kbd></td><td>Move the camera (Shift: faster)</td></tr>
        <tr><td><kbd>E</kbd> <kbd>X</kbd></td><td>Economy, Market</td></tr>
        <tr><td><kbd>F</kbd> <kbd>N</kbd> <kbd>B</kbd></td><td>Ground forces, Naval ops, Air command</td></tr>
        <tr><td><kbd>P</kbd> <kbd>R</kbd> <kbd>K</kbd></td><td>Diplomacy, R&amp;D, Rankings</td></tr>
        <tr><td><kbd>M</kbd></td><td>Back to the map (close windows)</td></tr>
        <tr><td><kbd>Q</kbd> <kbd>H</kbd> <kbd>T</kbd> <kbd>L</kbd> <kbd>U</kbd> <kbd>Tab</kbd></td><td>Orders for selected units</td></tr>
        <tr><td><kbd>I</kbd></td><td>This manual</td></tr>
        <tr><td><kbd>C</kbd> <kbd>G</kbd> <kbd>?</kbd></td><td>Chat, guided tour, all keys</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Cancel, close windows, clear selection</td></tr>
        <tr><td><kbd>F11</kbd></td><td>Full screen (desktop app)</td></tr>
      </tbody></table>`,
  },
  {
    id: 'music', title: 'Music and settings', html: () => `
      <p>The ${L('do:music', 'music player')} (♪ in the top bar) plays the game's own soundtrack, any tracks placed in the game's <code>music</code> folder, and music files you add yourself. Sound effects are switched with <b>Sound on/off</b>.</p>
      <p>View settings on the left: borders, rivers, names, grid lines, colour-blind friendly colours, tilt, relief and 3D models. If the map runs slowly, turning off 3D models helps most.</p>`,
  },
];

export class Manual {
  private el: HTMLElement;
  private current = 'start';

  constructor(root: HTMLElement, private actions: ManualActions) {
    this.el = document.createElement('div');
    this.el.className = 'manual-backdrop';
    this.el.hidden = true;
    root.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.el || t.closest('[data-man="close"]')) { this.close(); return; }
      const ch = t.closest<HTMLElement>('[data-ch]');
      if (ch) { this.current = ch.dataset.ch!; this.render(); return; }
      const go = t.closest<HTMLElement>('[data-go]');
      if (go) { e.preventDefault(); this.close(); this.actions.go(go.dataset.go!); }
    });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.el.hidden) { e.stopImmediatePropagation(); this.close(); } }, true);
  }

  get isOpen() { return !this.el.hidden; }
  open(chapter?: string) { if (chapter) this.current = chapter; this.el.hidden = false; this.render(); }
  close() { this.el.hidden = true; }
  toggle() { if (this.el.hidden) this.open(); else this.close(); }

  private render() {
    const ch = CHAPTERS.find((c) => c.id === this.current) ?? CHAPTERS[0];
    // good and bad effects in the text, as in tooltips
    const body = ch.html().replace(/<g>/g, '<span class="tip-good">').replace(/<\/g>/g, '</span>').replace(/<r>/g, '<span class="tip-bad">').replace(/<\/r>/g, '</span>');
    this.el.innerHTML = `<section class="panel manual" role="dialog" aria-label="Manual">
      <div class="econ-head"><div><span class="label">MANUAL</span><h2>${esc(ch.title)}</h2></div><button type="button" class="link" data-man="close">Close</button></div>
      <div class="manual-body">
        <nav class="manual-toc" aria-label="Chapters">${CHAPTERS.map((c) => `<button type="button" data-ch="${c.id}" aria-current="${c.id === ch.id}">${esc(c.title)}</button>`).join('')}</nav>
        <article class="manual-text">${body}</article>
      </div>
    </section>`;
  }
}
