// The technology tree: nine branches over twelve eras, from today's battlefield
// drones to a spacefaring, post-scarcity civilisation. Each technology names the
// ones it needs (the first of the era before in its branch, if it names none);
// many reach across branches, so the far end of the tree takes the whole of it.
// Bonuses are worked out from the era: later technologies give more, and each
// branch ends in a capstone that gives a great deal.

import type { Effects } from './research';

export type Branch = 'economy' | 'industry' | 'energy' | 'land' | 'sea' | 'air' | 'space' | 'society' | 'science';
export const BRANCHES: Branch[] = ['economy', 'industry', 'energy', 'land', 'sea', 'air', 'space', 'society', 'science'];
export const BRANCH_NAMES: Record<Branch, string> = {
  economy: 'Economy and trade', industry: 'Industry', energy: 'Energy', land: 'Land warfare', sea: 'Naval warfare',
  air: 'Air power', space: 'Space and strategic', society: 'Society', science: 'Science and intelligence',
};

/** One word each, for tight spaces. */
export const BRANCH_SHORT: Record<Branch, string> = { economy: 'Economy', industry: 'Industry', energy: 'Energy', land: 'Land', sea: 'Naval', air: 'Air', space: 'Space', society: 'Society', science: 'Science' };

/** The twelve eras, one per tier. */
export const ERA_NAMES = ['', 'Present day', 'Near future', '2040s', '2050s', '2060s', '2070s', '2080s', '2090s', '2100s', '2110s', '2120s', 'Far future'];
export const MAX_TIER = 12;

/** Research points per tier. At the default 15% research budget a tier-1 technology takes about a month of game time; the last era years. */
export const TIER_COST: Record<number, number> = { 1: 1000, 2: 1600, 3: 2400, 4: 3400, 5: 4700, 6: 6300, 7: 8300, 8: 10800, 9: 13800, 10: 17500, 11: 22000, 12: 27500 };

// Short keys for the bonuses, and what one step of each is worth.
type Key = 'g' | 'st' | 'la' | 'ld' | 'nv' | 'ar' | 'mp' | 'bd' | 'rs' | 'cs' | 'fd' | 'tr' | 'pw' | 'sp';
const KEY: Record<Key, [keyof Effects, number]> = {
  g: ['growth', 0.0003], st: ['stability', 0.6], la: ['landAttack', 0.025], ld: ['landDefense', 0.025],
  nv: ['naval', 0.02], ar: ['air', 0.02], mp: ['manpower', 0.035], bd: ['build', 0.025], rs: ['research', 0.025],
  cs: ['construct', 0.03], fd: ['food', 0.02], tr: ['treasury', 0.0003], pw: ['power', 0.008], sp: ['spy', 0.015],
};

export interface TechDef {
  id: string;
  name: string;
  branch: Branch;
  tier: number;
  needs: string[];
  effects: Partial<Effects>;
  /** What it lets you do, beyond its bonuses. */
  unlock?: string;
  capstone?: boolean;
}

const defs: TechDef[] = [];
let branch: Branch = 'economy';
/** A technology: tier, id, name, bonus keys ('g+tr'), what it needs, what it unlocks. */
function T(tier: number, id: string, name: string, keys: string, needs: string[] = [], unlock?: string, capstone = false) {
  const ks = keys ? (keys.split('+') as Key[]) : [];
  // a step is worth more each era; a bonus shared between several kinds is split, a little generously
  const step = (0.8 + 0.22 * tier) * (capstone ? 2.5 : 1) * (ks.length > 1 ? 1.25 / ks.length : 1);
  const effects: Partial<Effects> = {};
  for (const k of ks) { const [name, unit] = KEY[k]; effects[name] = (effects[name] ?? 0) + unit * step; }
  if (!needs.length && tier > 1) {
    const before = defs.find((d) => d.branch === branch && d.tier === tier - 1);
    if (before) needs = [before.id];
  }
  defs.push({ id, name, branch, tier, needs, effects, unlock, capstone });
}
const B = (b: Branch) => { branch = b; };

// ---- Economy and trade: growth, the treasury, food ----
B('economy');
T(1, 'e_fintech', 'Digital payments', 'g');
T(1, 'e_precision_ag', 'Precision agriculture', 'fd');
T(2, 'e_trade_ai', 'Algorithmic trading', 'g+tr', ['e_fintech']);
T(2, 'e_vertical_farms', 'Vertical farming', 'fd', ['e_precision_ag']);
T(3, 'e_cbdc', 'Central bank digital currency', 'tr', ['e_trade_ai']);
T(3, 'e_gene_crops', 'Gene-edited crops', 'fd+g', ['e_vertical_farms']);
T(3, 'e_smart_ports', 'Smart ports', 'g', ['e_trade_ai', 'logistics_ai']);
T(4, 'e_market_models', 'Predictive market models', 'g+tr', ['e_cbdc']);
T(4, 'e_lab_meat', 'Cultured meat', 'fd+st', ['e_gene_crops']);
T(5, 'e_auto_freight', 'Autonomous freight', 'g', ['e_smart_ports', 'i_cobots']);
T(5, 'e_desert_farming', 'Desert agriculture', 'fd', ['e_lab_meat', 'n_desal']);
T(6, 'e_planetary_ledger', 'Planetary ledger', 'tr', ['e_market_models']);
T(6, 'e_dividend', 'Automation dividend', 'st+g', ['e_market_models', 'i_lights_out']);
T(7, 'e_arcology_farms', 'Arcology farms', 'fd+st', ['e_desert_farming']);
T(7, 'e_ai_planning', 'AI economic planning', 'g+tr', ['e_planetary_ledger', 'x_general_ai']);
T(8, 'e_climate_crops', 'Climate-proof crops', 'fd', ['e_arcology_farms']);
T(8, 'e_frictionless', 'Frictionless trade', 'g', ['e_ai_planning', 'e_auto_freight']);
T(9, 'e_asteroid_markets', 'Asteroid commodity markets', 'tr+g', ['e_frictionless', 'o_asteroid_mining']);
T(9, 'e_food_synthesis', 'Molecular food synthesis', 'fd+st', ['e_climate_crops']);
T(10, 'e_abundance', 'Material abundance', 'g+st', ['e_food_synthesis', 'e_asteroid_markets']);
T(10, 'e_orbital_finance', 'Orbital finance', 'tr', ['e_asteroid_markets']);
T(11, 'e_reputation', 'Reputation economy', 'st+tr', ['e_abundance', 'e_orbital_finance']);
T(11, 'e_matter_compilers', 'Matter compilers', 'g+bd', ['e_abundance', 'i_programmable_matter']);
T(12, 'e_post_scarcity', 'Post-scarcity economy', 'g+st+tr+fd', ['e_matter_compilers', 'e_reputation'], undefined, true);

// ---- Industry: arms output, building, growth ----
B('industry');
T(1, 'automation', 'Industrial automation', 'g+bd');
T(1, 'i_3d_print', 'Additive manufacturing', 'cs');
T(2, 'logistics_ai', 'AI logistics', 'g+bd', ['automation']);
T(2, 'i_modular', 'Modular construction', 'cs', ['i_3d_print']);
T(3, 'i_cobots', 'Collaborative robotics', 'bd', ['logistics_ai']);
T(3, 'i_smart_materials', 'Smart materials', 'cs+bd', ['i_modular']);
T(4, 'i_lights_out', 'Lights-out factories', 'bd+g', ['i_cobots']);
T(4, 'i_self_healing', 'Self-healing concrete', 'cs', ['i_smart_materials']);
T(5, 'i_nanofab', 'Nanofabrication', 'bd+cs', ['i_lights_out', 'i_smart_materials']);
T(5, 'i_megaprojects', 'Megaproject engineering', 'cs', ['i_self_healing']);
T(6, 'i_graphene', 'Graphene industry', 'bd+g', ['i_nanofab']);
T(6, 'i_build_swarms', 'Construction swarms', 'cs', ['i_megaprojects', 'i_nanofab']);
T(7, 'i_self_running', 'Self-running supply chains', 'bd+g', ['i_graphene', 'e_auto_freight']);
T(7, 'i_metamaterials', 'Metamaterials', 'bd', ['i_graphene']);
T(8, 'i_molecular', 'Molecular assembly', 'bd+cs', ['i_metamaterials']);
T(8, 'i_arcologies', 'Arcologies', 'cs+st', ['i_build_swarms']);
T(9, 'i_orbital_foundries', 'Orbital foundries', 'bd', ['i_molecular', 'o_space_tugs']);
T(9, 'i_self_replicating', 'Self-replicating factories', 'bd+g', ['i_molecular']);
T(10, 'i_programmable_matter', 'Programmable matter', 'bd+cs', ['i_self_replicating']);
T(10, 'i_space_elevator', 'Space elevator', 'cs+g', ['i_orbital_foundries', 'i_arcologies']);
T(11, 'i_system_industry', 'Solar-system industry', 'g+bd', ['i_space_elevator']);
T(11, 'i_instant_cities', 'Instant cities', 'cs+st', ['i_programmable_matter']);
T(12, 'i_universal_fab', 'Universal fabrication', 'bd+cs+g', ['i_system_industry', 'i_instant_cities'], undefined, true);

// ---- Energy: electricity, growth ----
B('energy');
T(1, 'n_grid_storage', 'Grid-scale batteries', 'pw');
T(1, 'n_solar', 'Perovskite solar', 'pw+g');
T(2, 'n_smr', 'Small modular reactors', 'pw', ['n_grid_storage']);
T(2, 'n_smart_grid', 'Smart grid', 'g', ['n_solar']);
T(3, 'n_offshore_wind', 'Floating wind farms', 'pw', ['n_solar']);
T(3, 'n_hydrogen', 'Green hydrogen', 'pw+g', ['n_smart_grid']);
T(4, 'n_supergrid', 'Continental supergrid', 'pw+g', ['n_smart_grid', 'n_smr']);
T(4, 'n_deep_geothermal', 'Deep geothermal', 'pw', ['n_smr']);
T(4, 'n_desal', 'Mass desalination', 'fd+st', ['n_offshore_wind']);
T(5, 'n_fusion_ignition', 'Fusion ignition', 'pw', ['n_supergrid', 'x_quantum_computing']);
T(5, 'n_carbon_capture', 'Carbon capture', 'st+g', ['n_hydrogen']);
T(6, 'fusion_grid', 'Fusion power grid', 'g+pw', ['n_fusion_ignition']);
T(6, 'n_superconductors', 'Room-temperature superconductors', 'pw+bd', ['n_supergrid', 'i_nanofab']);
T(7, 'n_space_solar', 'Space-based solar', 'pw', ['fusion_grid', 'o_space_tugs']);
T(7, 'n_compact_fusion', 'Compact fusion', 'pw+nv', ['fusion_grid', 'n_superconductors']);
T(8, 'n_wireless_power', 'Wireless power', 'g+pw', ['n_space_solar', 'n_superconductors']);
T(8, 'n_weather', 'Weather engineering', 'fd+st', ['n_space_solar', 'n_carbon_capture']);
T(9, 'n_helium3', 'Helium-3 fusion', 'pw+g', ['n_compact_fusion', 'o_lunar_base']);
T(9, 'n_planetary_grid', 'Planetary grid', 'pw', ['n_wireless_power']);
T(10, 'n_antimatter', 'Antimatter containment', 'pw+ar', ['n_helium3', 'x_unified_physics']);
T(10, 'n_climate_restoration', 'Climate restoration', 'st+fd', ['n_weather']);
T(11, 'n_dyson_swarm', 'Dyson swarm prototype', 'pw+g', ['n_planetary_grid', 'n_antimatter']);
T(12, 'n_limitless', 'Limitless energy', 'pw+g+bd', ['n_dyson_swarm', 'n_climate_restoration'], undefined, true);

// ---- Land warfare: attack, defence, reservists ----
B('land');
T(1, 'l_networked', 'Networked infantry', 'la+ld');
T(1, 'l_body_armor', 'Advanced body armor', 'ld+mp');
T(2, 'active_armor', 'Active protection', 'ld', ['l_body_armor']);
T(2, 'l_loitering', 'Loitering munitions', 'la', ['l_networked']);
T(3, 'l_exoskeletons', 'Military exoskeletons', 'la+mp', ['active_armor']);
T(3, 'l_counter_drone', 'Counter-drone lasers', 'ld', ['l_loitering']);
T(3, 'l_combat_ai', 'Battlefield AI', 'la', ['l_loitering', 'x_ai_labs']);
T(4, 'robotic_infantry', 'Robotic infantry', 'la+mp', ['l_exoskeletons']);
T(4, 'l_smart_forts', 'Smart fortifications', 'ld', ['l_counter_drone']);
T(5, 'l_railguns', 'Field railguns', 'la', ['robotic_infantry', 'l_combat_ai']);
T(5, 'l_adaptive_camo', 'Adaptive camouflage', 'ld', ['l_smart_forts']);
T(6, 'l_autonomous_armor', 'Autonomous tanks', 'la+ld', ['l_railguns']);
T(6, 'l_mobilisation', 'Rapid mobilisation', 'mp', ['robotic_infantry', 'logistics_ai']);
T(7, 'l_powered_armor', 'Powered armor', 'la+ld', ['l_autonomous_armor']);
T(7, 'l_nanomedics', 'Battlefield nanomedicine', 'mp+ld', ['l_mobilisation', 'c_longevity']);
T(8, 'l_ground_swarms', 'Ground swarms', 'la', ['l_powered_armor']);
T(8, 'l_plasma_shield', 'Plasma shielding', 'ld', ['l_powered_armor', 'n_superconductors']);
T(9, 'l_directed_energy', 'Directed-energy artillery', 'la', ['l_ground_swarms', 'n_compact_fusion']);
T(9, 'l_neural_command', 'Neural command link', 'la+mp', ['l_nanomedics', 'x_brain_interface']);
T(10, 'l_walking_forts', 'Walking fortresses', 'la+ld', ['l_directed_energy', 'l_plasma_shield']);
T(10, 'l_drone_reserves', 'Endless drone reserves', 'mp', ['l_neural_command']);
T(11, 'l_kinetic', 'Kinetic dominance', 'la', ['l_walking_forts']);
T(11, 'l_shield_lines', 'Layered shield lines', 'ld', ['l_walking_forts']);
T(12, 'l_total_ground', 'Total ground superiority', 'la+ld+mp', ['l_kinetic', 'l_shield_lines', 'l_drone_reserves'], undefined, true);

// ---- Naval warfare ----
B('sea');
T(1, 's_usv', 'Unmanned surface vessels', 'nv');
T(1, 's_sensor_nets', 'Seabed sensor nets', 'nv');
T(2, 's_aip', 'Air-independent submarines', 'nv', ['s_sensor_nets']);
T(2, 's_ship_lasers', 'Shipboard lasers', 'nv', ['s_usv']);
T(3, 's_arsenal', 'Arsenal ships', 'nv', ['s_ship_lasers']);
T(3, 's_drone_subs', 'Extra-large drone submarines', 'nv', ['s_aip']);
T(4, 's_railguns', 'Naval railguns', 'nv', ['s_arsenal']);
T(4, 's_seabed_war', 'Seabed warfare', 'nv', ['s_drone_subs']);
T(5, 's_combat_cloud', 'Fleet combat cloud', 'nv+ar', ['s_railguns', 'x_quantum_computing']);
T(5, 's_autonomous_subs', 'Autonomous submarines', 'nv', ['s_seabed_war']);
T(6, 's_wave_piercers', 'Wave-piercing warships', 'nv+bd', ['s_combat_cloud']);
T(6, 's_supercavitation', 'Supercavitating torpedoes', 'nv', ['s_autonomous_subs']);
T(7, 's_fusion_carriers', 'Fusion carriers', 'nv+ar', ['s_wave_piercers', 'fusion_grid']);
T(7, 's_ocean_mesh', 'Ocean surveillance mesh', 'nv+sp', ['s_supercavitation']);
T(8, 's_submersible_carriers', 'Submersible carriers', 'nv', ['s_fusion_carriers', 's_supercavitation']);
T(8, 's_hard_kill', 'Hard-kill ship shields', 'nv', ['s_fusion_carriers', 'n_superconductors']);
T(9, 's_sea_bases', 'Floating sea bases', 'nv+bd', ['s_submersible_carriers']);
T(9, 's_armadas', 'Drone armadas', 'nv', ['s_ocean_mesh', 's_submersible_carriers']);
T(10, 's_mhd_drives', 'Magnetohydrodynamic drives', 'nv', ['s_sea_bases', 'n_compact_fusion']);
T(10, 's_ocean_denial', 'Ocean denial', 'nv', ['s_armadas']);
T(11, 's_citadels', 'Ocean citadels', 'nv+ld', ['s_mhd_drives']);
T(11, 's_orbital_naval', 'Orbit-linked fleets', 'nv+ar', ['s_ocean_denial', 'o_space_command']);
T(12, 's_command_oceans', 'Command of the oceans', 'nv+bd', ['s_citadels', 's_orbital_naval'], undefined, true);

// ---- Air power ----
B('air');
T(1, 'drones', 'Battlefield drones', 'la', [], 'lets you build drone wings');
T(1, 'a_wingman', 'Loyal wingman', 'ar');
T(2, 'a_sixth_gen', 'Sixth-generation fighters', 'ar', ['a_wingman']);
T(2, 'a_drone_tankers', 'Drone tankers', 'ar', ['drones']);
T(3, 'stealth', 'Stealth airframes', 'ar', ['a_sixth_gen'], 'lets you build stealth bombers');
T(3, 'a_swarms', 'Drone swarms', 'ar+la', ['drones', 'a_drone_tankers']);
T(4, 'a_air_lasers', 'Airborne lasers', 'ar', ['stealth']);
T(4, 'a_battle_managers', 'AI air battle managers', 'ar', ['a_swarms', 'x_ai_labs']);
T(5, 'a_scramjets', 'Scramjet aircraft', 'ar', ['a_air_lasers', 'hypersonics']);
T(5, 'a_air_defense', 'Integrated air defense', 'ar+ld', ['a_battle_managers']);
T(6, 'a_morphing', 'Morphing wings', 'ar', ['a_scramjets', 'i_nanofab']);
T(6, 'a_drone_carriers', 'Flying drone carriers', 'ar+nv', ['a_battle_managers']);
T(7, 'a_suborbital', 'Suborbital bombers', 'ar', ['a_morphing']);
T(7, 'a_plasma_stealth', 'Plasma stealth', 'ar', ['a_morphing']);
T(8, 'a_fusion_aircraft', 'Fusion-powered aircraft', 'ar', ['a_suborbital', 'n_compact_fusion']);
T(8, 'a_hive_fleets', 'Hive air fleets', 'ar+la', ['a_drone_carriers', 'x_brain_interface']);
T(9, 'a_aerospace', 'Aerospace fighters', 'ar', ['a_fusion_aircraft']);
T(9, 'a_sky_shield', 'Sky shield', 'ar+ld', ['a_plasma_stealth', 'a_air_defense']);
T(10, 'a_perpetual', 'Perpetual air cover', 'ar', ['a_aerospace']);
T(10, 'a_hypersonic_swarms', 'Hypersonic swarms', 'ar+la', ['a_hive_fleets', 'a_aerospace']);
T(11, 'a_orbital_assault', 'Orbital air assault', 'ar+la', ['a_perpetual', 'o_orbital_habitats']);
T(12, 'a_supremacy', 'Absolute air supremacy', 'ar+la', ['a_orbital_assault', 'a_hypersonic_swarms', 'a_sky_shield'], undefined, true);

// ---- Space and strategic weapons ----
B('space');
T(1, 'o_reusable', 'Reusable rockets', 'rs');
T(1, 'o_constellation', 'Satellite internet', 'g+sp');
T(2, 'hypersonics', 'Hypersonic missiles', 'nv', ['o_reusable'], 'lets you buy cruise missiles and shoot down satellites');
T(2, 'o_smallsats', 'Smallsat swarms', 'sp', ['o_constellation']);
T(3, 'orbital_recon', 'Orbital reconnaissance', 'nv+ar', ['o_smallsats', 'o_reusable'], 'lets you launch spy satellites');
T(3, 'o_missile_shield', 'Missile shield', 'ld', ['hypersonics']);
T(4, 'o_lunar_base', 'Lunar outpost', 'rs', ['orbital_recon']);
T(4, 'o_glide', 'Hypersonic glide vehicles', 'la+nv', ['hypersonics', 'o_missile_shield']);
T(5, 'nuclear', 'Nuclear deterrent', '', ['o_glide'], 'lets you build nuclear warheads ($40bn each)');
T(5, 'o_space_tugs', 'Orbital tugs', 'bd', ['o_lunar_base']);
T(6, 'o_asteroid_mining', 'Asteroid mining', 'g+tr', ['o_space_tugs']);
T(6, 'o_orbital_lasers', 'Orbital laser platforms', 'ar+nv', ['orbital_recon', 'o_missile_shield', 'n_supergrid']);
T(7, 'o_mars', 'Mars settlement', 'st+rs', ['o_asteroid_mining']);
T(7, 'o_kinetic', 'Kinetic bombardment', 'la', ['o_orbital_lasers']);
T(8, 'o_fusion_rockets', 'Fusion rockets', 'rs', ['o_mars', 'n_compact_fusion']);
T(8, 'o_space_command', 'Orbital command', 'ar+nv+sp', ['o_kinetic']);
T(9, 'o_shipyards', 'Orbital shipyards', 'nv+bd', ['o_fusion_rockets']);
T(9, 'o_planetary_defense', 'Planetary defense grid', 'ld+ar', ['o_space_command']);
T(10, 'o_outer_planets', 'Outer planet outposts', 'rs+tr', ['o_shipyards']);
T(10, 'o_orbital_habitats', 'Orbital habitats', 'st+mp', ['o_shipyards', 'i_orbital_foundries']);
T(11, 'o_interplanetary', 'Interplanetary economy', 'g', ['o_outer_planets', 'o_orbital_habitats']);
T(11, 'o_starshot', 'Interstellar probes', 'rs', ['o_outer_planets', 'n_antimatter']);
T(12, 'o_spacefaring', 'Spacefaring civilisation', 'rs+g+nv+ar', ['o_interplanetary', 'o_starshot', 'o_planetary_defense'], undefined, true);

// ---- Society: stability, people, growth ----
B('society');
T(1, 'c_telehealth', 'Telemedicine', 'st');
T(1, 'c_online_edu', 'Online education', 'rs+g');
T(2, 'c_open_data', 'Open-data government', 'st', ['c_telehealth', 'digital_state']);
T(2, 'c_retraining', 'Lifelong retraining', 'g+mp', ['c_online_edu']);
T(3, 'healthcare', 'Universal genomics', 'st+mp', ['c_telehealth']);
T(3, 'c_smart_cities', 'Smart cities', 'g+st', ['c_open_data']);
T(4, 'social_cohesion', 'Civic renewal', 'st+g', ['c_open_data']);
T(4, 'c_longevity', 'Longevity drugs', 'mp+st', ['healthcare']);
T(5, 'c_ai_tutors', 'Personal AI tutors', 'rs+g', ['c_retraining', 'x_quantum_computing']);
T(5, 'c_deliberation', 'Digital deliberation', 'st', ['social_cohesion']);
T(6, 'c_ageing', 'Reversed ageing', 'mp+g', ['c_longevity']);
T(6, 'c_renaissance', 'Cultural renaissance', 'st', ['c_deliberation', 'c_smart_cities']);
T(7, 'c_neural_education', 'Neural education', 'rs', ['c_ai_tutors']);
T(7, 'c_post_work', 'Post-work society', 'st+g', ['e_dividend', 'c_renaissance']);
T(8, 'c_designer_immunity', 'Designer immunity', 'mp+st', ['c_ageing']);
T(8, 'c_translation', 'Universal translation', 'g+sp', ['c_neural_education']);
T(9, 'c_cognitive', 'Cognitive enhancement', 'rs+g', ['c_neural_education', 'x_brain_interface']);
T(9, 'c_consensus', 'Consensus politics', 'st', ['c_post_work']);
T(10, 'c_lifespans', 'Extended lifespans', 'mp+st', ['c_designer_immunity']);
T(10, 'c_soft_power', 'Soft power hegemony', 'st+sp', ['c_translation', 'c_consensus']);
T(11, 'c_digital_minds', 'Digital minds', 'rs+st', ['c_cognitive', 'x_exotic_matter']);
T(11, 'c_harmony', 'Social harmony', 'st', ['c_soft_power']);
T(12, 'c_golden_age', 'Golden age', 'st+g+mp', ['c_harmony', 'c_lifespans', 'c_digital_minds'], undefined, true);

// ---- Science and intelligence: research, espionage ----
B('science');
T(1, 'digital_state', 'Digital government', 'st+rs', [], 'lets your agents run cyber operations');
T(1, 'x_research_cloud', 'Research cloud', 'rs');
T(2, 'x_quantum_sensing', 'Quantum sensing', 'sp', ['x_research_cloud']);
T(2, 'x_ai_labs', 'AI research labs', 'rs', ['x_research_cloud']);
T(3, 'x_cyber', 'Offensive cyber', 'sp', ['digital_state', 'x_quantum_sensing']);
T(3, 'x_protein', 'Protein design', 'rs+fd', ['x_ai_labs']);
T(4, 'x_quantum_computing', 'Quantum computing', 'rs', ['x_ai_labs', 'x_quantum_sensing']);
T(4, 'x_sigint', 'Signals intelligence', 'sp+st', ['x_cyber']);
T(5, 'x_quantum_crypto', 'Quantum cryptography', 'sp', ['x_quantum_computing', 'x_sigint']);
T(5, 'x_general_ai', 'General AI', 'rs+g', ['x_quantum_computing']);
T(6, 'x_auto_science', 'Automated science', 'rs', ['x_general_ai']);
T(6, 'x_synthetic_media', 'Synthetic media operations', 'sp', ['x_quantum_crypto']);
T(7, 'x_brain_interface', 'Brain–computer interfaces', 'rs+mp', ['x_auto_science', 'x_protein']);
T(7, 'x_predictive_intel', 'Predictive intelligence', 'sp+ld', ['x_synthetic_media', 'x_general_ai']);
T(8, 'x_superintelligence', 'Superintelligence', 'rs+g', ['x_auto_science', 'x_brain_interface']);
T(8, 'x_ghost_networks', 'Ghost networks', 'sp', ['x_predictive_intel']);
T(9, 'x_unified_physics', 'Unified field physics', 'rs', ['x_superintelligence']);
T(9, 'x_total_awareness', 'Total awareness', 'sp', ['x_ghost_networks', 'o_space_command']);
T(10, 'x_exotic_matter', 'Exotic matter', 'rs+pw', ['x_unified_physics']);
T(10, 'x_cognitive_war', 'Cognitive warfare', 'sp+st', ['x_total_awareness']);
T(11, 'x_simulation', 'World simulation', 'rs+g', ['x_exotic_matter']);
T(11, 'x_secrets', 'Unbreakable state secrets', 'sp+ld', ['x_cognitive_war']);
T(12, 'x_singularity', 'Technological singularity', 'rs+g+sp', ['x_simulation', 'x_secrets'], undefined, true);

export const TECH_DEFS: readonly TechDef[] = defs;
