// A short guided tour for new players. Runs once on a first visit; the manual
// (i in the header) starts it again. Each step can point at a part of the interface.

interface Step {
  title: string;
  text: string;
  target?: string; // CSS selector to highlight
}

const STEPS: Step[] = [
  {
    title: 'Welcome, commander',
    text: 'Sovereign Command is one shared, persistent world in 2026. It never pauses: a game day passes every 10 seconds and a game year every real hour. Every nation is led by a player or by the AI, under the same rules.',
  },
  {
    title: 'The theatre map',
    text: 'Drag to turn the globe, scroll to zoom, or use W A S D. Click any land to inspect the province and its nation. The MAP arrow at the bottom left opens map modes (politics, wealth, terrain, climate, night lights) and view settings.',
    target: '.map-toggle',
  },
  {
    title: 'Take command',
    text: 'Sign in (or play as a guest), click a nation that is run by the AI, and press "Take command of this nation". If you are away for an hour, advisers govern for you.',
    target: '#inspector',
  },
  {
    title: 'Your nation at a glance',
    text: 'GDP, defence budget, fuel, munitions, reservists and public approval. Keep approval up: below 25, governments fall to coups and revolutions.',
    target: '.resources',
  },
  {
    title: 'Economy',
    text: 'Set taxes and split the budget between the military, infrastructure, welfare and research. Six goods trade on one world market shared by every nation.',
    target: '[data-module="economy"]',
  },
  {
    title: 'Forces',
    text: 'Your army, navy and air force appear on the map as stacks. Click a stack to select it (click again to pick one unit type), then right-click a province (long-press on a phone): troops and ships move there, fighters patrol and strike wings support battles. Recruit in Ground forces.',
    target: '[data-module="army"]',
  },
  {
    title: 'Diplomacy',
    text: 'Every nation has an opinion of you, from Bitter enemies to Devoted: hover a nation on the map to see it. Open its page (Nations tab) for every treaty: trade, alliances, non-aggression pacts, military access, research cooperation, guarantees, supply contracts, gifts, envoys and demands.',
    target: '[data-module="diplomacy"]',
  },
  {
    title: 'War and peace',
    text: 'Declare war with a war goal: conquest, subjugation, regime change, reparations or humiliation. Taking land, winning battles and destroying divisions earns war score, which pays for terms at the peace conference.',
    target: '[data-module="army"]',
  },
  {
    title: 'Politics',
    text: 'Political capital pays for laws. In a democracy parliament votes on them, must back your wars and makes demands; parties rise and fall in the polls and elections can bring in a new coalition. Autocracies rule by decree, at a cost to public goodwill.',
    target: '[data-module="politics"]',
  },
  {
    title: 'Decisions',
    text: 'Strikes, scandals, booms, droughts and plots arrive as decisions: choose an answer, each with effects you can read before you pick. Unanswered, the first option is taken after 30 days.',
  },
  {
    title: 'Espionage',
    text: 'Recruit agent networks in other nations, then use them: reconnaissance, theft, sabotage, rigging their politics, even backing a coup. Counter-intelligence wears down their agents in your own country.',
    target: '[data-module="espionage"]',
  },
  {
    title: 'Research and government',
    text: 'Choose technologies for permanent bonuses, and reform your government when it suits your strategy. Each form of government has trade-offs.',
    target: '[data-module="research"]',
  },
  {
    title: 'Dispatches and chat',
    text: 'News arrives in the notifications under the date and in Dispatches; Records (V) keeps the full log and a ledger of every nation. Esc opens the main menu (options, save and load); Space pauses single player; the i button opens the manual, which explains everything and can replay this tour.',
    target: '[data-open="dispatches"]',
  },
];

const KEY = 'sov.tutorial';

export class Tutorial {
  private card: HTMLElement;
  private i = 0;
  private lit: Element | null = null;
  private started = false;

  constructor(private root: HTMLElement) {
    this.card = document.createElement('section');
    this.card.className = 'panel coach';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-label', 'Guided tour');
    this.card.hidden = true;
    root.appendChild(this.card);
    this.card.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-tour]')?.dataset.tour;
      if (a === 'next') this.show(this.i + 1);
      else if (a === 'back') this.show(this.i - 1);
      else if (a === 'skip' || a === 'done') this.end();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.card.hidden) this.end(); });
  }

  /** Start on a first visit only. */
  maybeStart() {
    if (this.started) return;
    this.started = true;
    let seen: string | null = null;
    try { seen = localStorage.getItem(KEY); } catch { /* storage blocked: show it */ }
    if (!seen) this.start();
  }

  start() { this.show(0); }

  private show(i: number) {
    this.i = Math.max(0, Math.min(STEPS.length - 1, i));
    const s = STEPS[this.i], last = this.i === STEPS.length - 1;
    this.lit?.classList.remove('coach-target');
    this.lit = s.target ? this.root.querySelector(s.target) : null;
    this.lit?.classList.add('coach-target');
    this.card.innerHTML = `
      <span class="label">GUIDE · ${this.i + 1} OF ${STEPS.length}</span>
      <h2>${s.title}</h2>
      <p>${s.text}</p>
      <div class="actions-row">
        ${this.i ? '<button type="button" class="claim" data-tour="back">Back</button>' : '<button type="button" class="claim" data-tour="skip">Skip tour</button>'}
        <button type="button" class="claim primary" data-tour="${last ? 'done' : 'next'}">${last ? 'Start playing' : 'Next'}</button>
      </div>`;
    this.card.hidden = false;
    (this.card.querySelector('[data-tour="next"], [data-tour="done"]') as HTMLElement | null)?.focus();
  }

  private end() {
    this.card.hidden = true;
    this.lit?.classList.remove('coach-target');
    this.lit = null;
    try { localStorage.setItem(KEY, 'done'); } catch { /* storage blocked */ }
  }
}
