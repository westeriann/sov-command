import { art } from './art-icons';
// The in-game manual: every system explained, with links that open the window,
// map mode or place being described. Tables of units, buildings, technologies and
// governments are built from the game's own data, so they never go out of date.
import { BUILDINGS, BUILDING_TYPES } from '../../shared/buildings';
import { COMMODITIES, COMMODITY_INFO } from '../../shared/economy';
import { ENVOY_COST, ENVOY_DAYS, MAX_BLOC, MAX_CONTRACTS, MAX_ENVOYS, MAX_SPY_OPS, PACTS, PACT_INFO, PROPOSAL_DAYS, SPY_COST, SPY_MISSIONS, VOTE_DAYS } from '../../shared/diplomacy';
import { DECREE_DISCOUNT, HIGH_TAX, HIGH_TAX_SUPPORT, LAWS, LAW_IDS, MAX_CAPITAL, WAR_SUPPORT } from '../../shared/politics';
import { SPECIALTIES, SPECIALTY_LIST } from '../../shared/specialties';
import { EQUIP_PER_BN, SUPPLY_HOPS, WAR_GOALS, type WarGoal } from '../../shared/military';
import { DEMIL_YEARS, MAX_REPARATIONS, PEACE_COST, REPARATION_YEARS } from '../../shared/peace';
import { EVENTS, EVENT_DAYS, type EventKey } from '../../shared/events';
import { AUTONOMY_COST, CAMPAIGN_COST, CAMPAIGN_DAYS, COALITION_COST } from '../../shared/parties';
import { MAX_NETWORKS, NETWORK_GROWTH } from '../../shared/diplomacy';
import { UNIT_ROLE, UNIT_SPECS, UNIT_TYPES } from '../../shared/military';
import { GOVERNMENTS, GOVERNMENT_INFO, MAX_RESEARCH_QUEUE, REFORM_DAYS, TECHS, TIER_COST } from '../../shared/research';

/**
 * Link targets, as data-go values:
 *   module:<id>            open a window (economy, market, army, navy, air, diplomacy, research, rankings, map)
 *   market:<tab>[:<good>]  open the Market on a tab and good
 *   mode:<map mode>        switch the map mode
 *   view:<id>              highlight a View setting (relief, tilt, models3d, borders...)
 *   do:<action>            capital, keys, guide, music, notices
 *   econ:<input id>        open Economy and highlight a control (econTax, b-welfare...)
 *   nation:<id>            fly to a nation and show its card;  diplo:<id>  open Diplomacy on it
 *   build:<province>       the build list of a province;  manual:<chapter>  a manual chapter
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
        <li>Click a province or sea zone to inspect it; right-click for a menu of what you can do there. Hover over a foreign nation to see what it thinks of you. Each place sounds and stirs a little when you click it: a city's traffic, farm animals, forest birds, mountain wind, waves and gulls.</li>
        <li><b>Cities</b> are small provinces of their own inside the province they grew in, placed by the land around them: on a shore, a lake or a river, at the foot of the mountains, in a valley, now and then on an island. Each holds about half its area's people and can be built in, defended and taken on its own. A star marks every capital, coloured by its form of government.</li>
        <li>Click the name of a hurricane (or its eye) for its strength, winds, heading and what it threatens.</li>
        <li>Lost? The round button by the MAP arrow (or the <kbd>Home</kbd> key) flies you back to your capital.</li>
        <li>Clicking a nation's name in any window opens a small card about it (country, economy, military, diplomacy) with a button to zoom to it.</li>
        <li>The flat map (Globe or Flat, at the bottom of the map drawer) stays centred on the world.</li>
        <li>Map modes (the MAP arrow, bottom left) include <b>Resources</b> (pick a resource, or province specialties) and <b>Diplomatic</b> (every nation coloured by how it stands with you, with a filter for allies, trade partners, pacts, truces, wars, embargoes, claims and opinion).</li>
      </ul>
      <h3>Map modes</h3>
      <ul>
        <li>${L('mode:political', 'Political')}: who owns what. Occupied land shows the occupier's colour.</li>
        <li>${L('mode:wealth', 'Wealth per person')}: income per head, poor to rich.</li>
        <li>${L('mode:satellite', 'Satellite only')}, ${L('mode:terrain', 'Terrain types')} and ${L('mode:elevation', 'Elevation')}: the land itself.</li>
        <li>${L('mode:climate', 'Temperature')}: mean temperature, hot deserts to frozen poles; mountain tops are colder.</li>
        <li>${L('mode:lights', 'Night lights')}: the planet at night. Cities glow by how well their nation is powered; blackouts go dark.</li>
      </ul>
      <p>${L('view:opacity', 'Colour strength')} sets how strongly a map mode is painted over the satellite photo; each mode remembers its own. The map drawer's sections fold away to save space.</p>
      <p>Borders follow rivers and ridges where they can; rivers slow armies that cross them and help defenders.</p>`,
  },
  {
    id: 'nation', title: 'Your nation', html: () => `
      <p>The panel on the right shows your nation when you lead one, and whatever you have selected below it.</p>
      <h3>The top bar</h3>
      <p>By default: treasury (with the yearly surplus or deficit), GDP and growth, stability, political capital, manpower and equipment, war (with your worst war score), and research. Click a figure to open the window where you change it; <kbd>Ctrl</kbd>-click shrinks it to a tab. Choose and order the figures in Options. Fuel, munitions and electricity appear as warning icons when they run low.</p>
      <h3>Lenses</h3>
      <p>The <b>Military</b> and <b>Eco</b> buttons in the bottom bar open compact quick views: wars and scores, forces, production with quick recruit buttons; or treasury, taxes, budget, power and construction. Each gives advice on what is needed and what to build next, with links straight to the place to act.</p>
      <h3>Building and roads</h3>
      <p>In the Eco lens, <b>Build…</b> sets the lens aside: click any of your provinces and a menu by the click lists what can be built there, with cost and time. <b>Back</b> (or <kbd>Esc</kbd>) returns to the lens.</p>
      <p><b>Roads…</b> lays roads: press on one of your provinces and drag across your land. With <b>Snap on</b> the road runs through province centres and cities; with it off it follows your pointer. Drag back to shorten it; release to see the cost and time, then build. A road costs $0.35bn a stretch and takes 8 days plus 3 a stretch (three at a time). Land troops move 40% faster along a finished road.</p>
      <h3>Windows</h3>
      <p>Drag any window's edges or corners to resize it; it remembers its size. Double-click its title to reset it. Charts sit in a grid at half size: click one to enlarge it.</p>
      <h3>Advisers (single player)</h3>
      <p>In ${L('politics:advisers', 'Politics')}, tick what your advisers may handle: the budget and taxes, construction, research, recruitment, trade and treaties, laws, decisions, espionage. They act once a game week and list what they did; they never move troops or start or end wars. In shared worlds, advisers instead take over while you are away.</p>
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
      <p>Move the sliders freely; a <b>Finalize budget</b> button then confirms the new split (<b>Even out</b> balances it to 100%, <b>Undo</b> drops the changes). Nothing moves on its own.</p>
      <h3>Development</h3>
      <p>Every province has a <b>development</b> score from 0 to 100: it weighs how crowded and urban a place is together with how rich its nation is per person, so a packed city in a poor nation is still poorly developed, rich farmland is fairly developed, and a rich city is the most; finished works there (factories, ports, power plants) add a little. It matters a lot for building (from half speed in the wilds to one and a half times in a big city) and a little for recruiting, which follows your nation's average. It leans politics too: cities and crowded country pull toward liberal, open policies, the remote countryside toward authoritarian ones that look after their own.</p>
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
      <h3>Equipment</h3>
      <p>Every unit needs equipment: ${EQUIP_PER_BN} kit for each $1bn of its cost, drawn day by day while it is built, and more to bring damaged units back to strength. State arsenals make it from the defence budget; each factory complex adds 1.5 a day, if it has metals and electricity. Short of equipment, production and reinforcement stall: the Ground forces window shows what you make and use.</p>
      <h3>Supply</h3>
      <p>Your own land supplies your armies anywhere in it. Beyond it, supply reaches ${SUPPLY_HOPS} provinces from your capital, a port or a <b>supply depot</b> (build one in a province you hold, even an occupied one). Units out of supply fight weaker and lose strength every day.</p>
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
      <p>Declare war from a nation's panel or its Diplomacy page, and choose a <b>war goal</b>: terms that match it cost half at the peace table.</p>
      <table class="man-table"><tbody>${(Object.keys(WAR_GOALS) as WarGoal[]).map((g) => `<tr><td>${WAR_GOALS[g].name}</td><td>${esc(WAR_GOALS[g].text)}</td></tr>`).join('')}</tbody></table>
      <p>Its allies and guarantors join against you; breaking a non-aggression pact is remembered by every nation. Your troops may enter its land; empty provinces you march into are occupied.</p>
      <h3>War score and the peace conference</h3>
      <p>War score (−100 to +100) counts the share of their people under your occupation, battles won and divisions destroyed. At the <b>peace conference</b> you choose terms and pay for them with it: provinces (by their share of the loser's people), reparations of up to ${MAX_REPARATIONS * 100}% of their GDP a year for ${REPARATION_YEARS} years (${PEACE_COST.reparationsPerPct} per 1%), a demilitarised border for ${DEMIL_YEARS} years (${PEACE_COST.demilitarize}), a new government (${PEACE_COST.regime}) or vassalage (${PEACE_COST.puppet}). AI governments accept terms their war score can pay for, more readily as a war drags on; white peace ends any war. A <b>truce</b> (30, 90 or 180 days, from Diplomacy) stops the fighting where the lines stand: nobody attacks or advances, peace can still be signed, and when it runs out the war resumes. A nation that loses all its land is annexed. Ceded land is restless for a while.</p>`,
  },
  {
    id: 'diplomacy', title: 'Diplomacy', html: () => `
      <p>Open ${L('module:diplomacy', 'Diplomacy')} (<kbd>P</kbd>). The <b>Nations</b> tab lists every nation by what it thinks of you; click one (or its name in a province panel) for its page: their opinion and why, every treaty, supply contracts, gifts, envoys, demands, denouncing, embargoes and war. Proposals to players lapse after ${PROPOSAL_DAYS} game days; AI governments answer at once.</p>
      <h3>Opinion</h3>
      <p>Each nation thinks of every other from −100 to +100: alike beliefs and governments, treaties, trade, a common enemy, a diplomatic focus and envoys raise it; wars, embargoes, claims on their land, border tensions, war on their friends and propaganda lower it. Deeds are remembered and slowly fade: gifts <g>warm</g>, demands, denunciations and broken treaties <r>sour</r>, and breaking a non-aggression pact is a betrayal <r>the whole world remembers</r>. AI governments answer proposals mostly by opinion.</p>
      <h3>Treaties</h3>
      <table class="man-table"><tbody>${PACTS.map((k) => `<tr><td>${PACT_INFO[k].name}</td><td>${esc(PACT_INFO[k].text)}</td><td>up to ${PACT_INFO[k].max}</td></tr>`).join('')}</tbody></table>
      <h3>Deals and pressure</h3>
      <ul>
        <li><b>Supply contracts</b> (up to ${MAX_CONTRACTS}): a fixed yearly amount of a good, bought or sold at the world price of the day you sign, delivered daily from the seller's stock. Embargoes and blockades do not stop them.</li>
        <li><b>Gifts</b> of money need no answer and raise opinion. <b>Envoys</b> ($${ENVOY_COST}bn, ${MAX_ENVOYS} at a time) work on a nation for ${ENVOY_DAYS} days.</li>
        <li><b>Demands</b>: a border province or tribute (up to 5% of their GDP). They give way only to overwhelming power; a refusal gives you a <b>claim</b> (see ${L('module:politics', 'Politics')}).</li>
        <li><b>Denounce</b> a nation: its opinion and its allies' fall, its enemies like you more, and you gain political capital at home.</li>
        <li><b>Blocs</b> (up to ${MAX_BLOC} members): named coalitions that defend every member.</li>
        <li><b>World council</b>: table sanctions, condemnations or ceasefires; every nation votes for ${VOTE_DAYS} days.</li>
        <li><b>Embargoes</b> stop trade with a nation.</li>
        <li><b>Spies</b> ($${SPY_COST}bn each, ${MAX_SPY_OPS} at a time): ${Object.values(SPY_MISSIONS).map((m) => esc(m.name.toLowerCase())).join(', ')}.</li>
      </ul>`,
  },
  {
    id: 'politics', title: 'Politics and laws', html: () => `
      <p>Open ${L('module:politics', 'Politics')} (<kbd>O</kbd>). Governing costs <b>political capital</b>: earned every day from stability and a government that suits the people (a Diplomacy focus helps), up to ${MAX_CAPITAL}.</p>
      <h3>Who must agree</h3>
      <ul>
        <li><b>Democracy</b>: parliament votes on every law (it passes at 50%), must back a war of choice (${WAR_SUPPORT}% support; 25% against a nation you hold a claim on), and must agree to taxes above ${HIGH_TAX}% (${HIGH_TAX_SUPPORT}% support). Its support follows the public, business, the military and stability.</li>
        <li><b>Technocracy</b>: a council of experts votes, listening most to business, growth and stability.</li>
        <li><b>Autocracy</b>: laws by decree, ${Math.round((1 - DECREE_DISCOUNT) * 100)}% cheaper, but laws the public dislikes <r>cost stability</r>.</li>
        <li><b>Military junta</b>: decrees too, but nothing passes against the officers unless the military is very content.</li>
      </ul>
      <p><b>Demands</b>: parliament (or, under rule by decree, the unhappiest of the military, business and the public) asks something every few months: more welfare, research or defence spending, lower taxes, peace, a trade deal, or a law. Meet it within 90 days for <g>+15 capital and goodwill</g>; ignore or refuse it and <r>support and stability fall</r>.</p>
      <p><b>Emergency powers</b> suspend parliament's votes, at a cost to liberty and the public's mood. <b>Claims</b> come from demands other nations refuse, made in ${L('module:diplomacy', 'Diplomacy')}.</p>
      <h3>Parties and elections</h3>
      <p>Parliaments have four parties, each speaking for the military, business or the public, and each liberal or authoritarian, nationalist or internationalist. Their polls follow what the people believe, how their group feels, and, for the governing coalition, how the country is doing. Parliament's support follows the coalition's seats. Invite a party into government (${COALITION_COST} capital) if it is not too far from yours; a partner may walk out if support collapses. ${CAMPAIGN_DAYS} days before an election you can campaign (${CAMPAIGN_COST} capital). At the election seats follow the polls; if the coalition falls short of half, a new one forms, parliament blocks new wars for six months and repeals a law its voters dislike.</p>
      <p><b>Address the nation</b> (50 capital): +6 stability.</p>
      <h3>Separatism</h3>
      <p>Conquered provinces are restless. A garrison and welfare calm them; <b>autonomy</b> (${AUTONOMY_COST} capital, from the province panel) halves unrest and stops revolts, but the province keeps a quarter of its output. Restless land goes back to its old nation if it can, or declares independence if that nation is gone.</p>
      <h3>Laws</h3>
      <table class="man-table"><tbody>${LAW_IDS.map((l) => `<tr><td>${LAWS[l].name}</td><td>${esc(LAWS[l].text)}</td><td>${LAWS[l].cost}</td></tr>`).join('')}</tbody></table>`,
  },
  {
    id: 'decisions', title: 'Decisions', html: () => `
      <p>Every month or two something happens to your nation and you choose how to answer. Each option lists its effects; unanswered, the first option is taken after ${EVENT_DAYS} days. Some lead to later events (a gold rush, then lawless boom towns). Decisions waiting show as a flag icon at the top.</p>
      <table class="man-table"><tbody>${(Object.keys(EVENTS) as EventKey[]).map((k) => `<tr><td><span class="sp-ico">${art(k)}</span> ${EVENTS[k].title}</td><td>${EVENTS[k].options.map((o) => esc(o.text)).join(' · ')}</td></tr>`).join('')}</tbody></table>`,
  },
  {
    id: 'espionage', title: 'Espionage', html: () => `
      <p>Open ${L('module:espionage', 'Espionage')} (<kbd>J</kbd>). Missions need an <b>agent network</b> in the target nation: recruit one (up to ${MAX_NETWORKS} at once, +${NETWORK_GROWTH} a day, paid from military funds). Idle networks fade slowly, and the target's counter-intelligence wears them down and catches agents: a caught spy ring damages relations and may hand the target a decision.</p>
      <table class="man-table"><tbody>${Object.values(SPY_MISSIONS).map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.text)}</td><td>network ${m.need}</td></tr>`).join('')}</tbody></table>
      <p><b>Counter-intelligence</b> (none to total) costs a share of GDP and protects your own nation.</p>`,
  },
  {
    id: 'specialties', title: 'Province specialties', html: () => `
      <p>Every land province is known for one specialty, decided by its climate and place: its terrain, how near the poles or the equator it lies, its height, its coast and its rivers. The province panel shows it; ${L('market:local:spec', 'the Market')} lists yours, the luxuries your trade partners share, and who holds the rest.</p>
      <p>Each province with a specialty adds its bonus, each one less than the last (up to twice the first). <b>Luxuries</b> reach your trade partners at half strength, and theirs reach you: a reason to trade with nations unlike your own.</p>
      <table class="man-table"><tbody>${SPECIALTY_LIST.map((k) => `<tr><td><span class="sp-ico">${art(k)}</span> ${SPECIALTIES[k].name}</td><td>${esc(SPECIALTIES[k].effect)}</td></tr>`).join('')}</tbody></table>`,
  },
  {
    id: 'research', title: 'Research and government', html: () => `
      <p>Open ${L('module:research', 'R&amp;D')} (<kbd>R</kbd>). Points come from the research budget. Press <b>Research now</b> to start a technology, or <b>Queue</b> to line up to ${MAX_RESEARCH_QUEUE} after it: the next starts by itself.</p>
      <table class="man-table"><thead><tr><th>Technology</th><th>Tier</th><th>Points</th><th>Effect</th></tr></thead><tbody>
        ${TECHS.map((t) => `<tr><td>${esc(t.name)}</td><td>${t.tier}</td><td>${TIER_COST[t.tier].toLocaleString('en-US')}</td><td>${esc(t.text)}</td></tr>`).join('')}
      </tbody></table>
      <h3>Government</h3>
      <table class="man-table"><tbody>${GOVERNMENTS.map((g) => `<tr><td>${esc(GOVERNMENT_INFO[g].name)}</td><td>${esc(GOVERNMENT_INFO[g].text)}</td></tr>`).join('')}</tbody></table>
      <p>A reform takes ${REFORM_DAYS} game days of turmoil (<r>−10 stability</r>) and is possible once a game year. Democracies hold elections; losing one blocks new wars for six months. Government reform, the people's beliefs, factions and propaganda are in ${L('module:politics', 'Politics')}.</p>`,
  },
  {
    id: 'world', title: 'The living world', html: () => `
      <ul>
        <li><b>Seasons</b>: each game year has four (opposite in the two hemispheres). Harvests peak in autumn; winter is hard on armies in cold lands.</li>
        <li><b>Weather</b>: storms ground aircraft and batter ships; droughts and hurricanes strike.</li>
        <li><b>Shipping</b>: every sea trade agreement sails a lane between the two nations' ports, with merchant ships on it. An enemy warship anywhere on a lane cuts that trade, only for the nations it is at war with; the lane turns red and the ships leave it.</li>
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
        <tr><td><kbd>P</kbd> <kbd>O</kbd> <kbd>J</kbd></td><td>Diplomacy, Politics, Espionage</td></tr>
        <tr><td><kbd>R</kbd> <kbd>K</kbd> <kbd>V</kbd></td><td>R&amp;D, Rankings, Records</td></tr>
        <tr><td><kbd>Ctrl</kbd>-click</td><td>Shrink anything in the top bar to a small tab (click the tab to restore it)</td></tr>
        <tr><td><kbd>Space</kbd></td><td>Pause (single player; also the ${art('pause')} button by the speeds) or vote to pause (shared worlds)</td></tr>
        <tr><td><kbd>M</kbd></td><td>Back to the map (close windows)</td></tr>
        <tr><td><kbd>Q</kbd> <kbd>H</kbd> <kbd>T</kbd> <kbd>L</kbd> <kbd>U</kbd> <kbd>Tab</kbd></td><td>Orders for selected units</td></tr>
        <tr><td><kbd>I</kbd></td><td>This manual</td></tr>
        <tr><td><kbd>C</kbd> <kbd>G</kbd> <kbd>?</kbd></td><td>Chat, guided tour, all keys</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Cancel, close windows, clear selection; with nothing open, the main menu</td></tr>
        <tr><td><kbd>F11</kbd></td><td>Full screen (desktop app)</td></tr>
      </tbody></table>`,
  },
  {
    id: 'music', title: 'Menu, music and settings', html: () => `
      <p>The <b>main menu</b> (${art('menu')} in the top bar, or <kbd>Esc</kbd> with nothing open) holds single player, save and load, a new campaign (optionally <b>Ironman</b>: one autosave, no going back), multiplayer, options for graphics, sound, interface and game speed, this manual and the credits. Single player pauses while it is open, and <kbd>Space</kbd> pauses it at any time.</p>
      <h3>Multiplayer</h3>
      <p>In the desktop app, <b>Host a game</b> runs a shared world on your computer: friends on your network join at the address it shows, in the game or a browser (for friends elsewhere, forward port 8787). Or join any world server by its address. In a shared world, pick a nation from the menu; <kbd>Space</kbd> votes to pause, and the world pauses when every leader online agrees (for up to ten minutes).</p>
      <p>${L('module:records', 'Records')} (<kbd>V</kbd>) holds the ledger of every nation, sortable, and the full log of dispatches, filtered by kind.</p>
      <p>The ${L('do:music', 'music player')} (${art('music')} in the top bar) plays the game's own soundtrack, any tracks placed in the game's <code>music</code> folder, and music files you add yourself. Sound effects are switched with <b>Sound on/off</b>.</p>
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
      if (go) { e.preventDefault(); e.stopPropagation(); this.close(); this.actions.go(go.dataset.go!); }
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
