/**
 * Power-specific strategic guides for Diplomacy AI agents.
 *
 * Each power has tailored opening-phase guidance based on established
 * Diplomacy theory, including named openings, key early decisions,
 * and phase-specific priorities. These guides supplement the generic
 * strategy prompts with deep, power-specific knowledge.
 */

import type { Power } from '../engine/types';

/**
 * A power-specific strategic guide with opening theory and phase guidance.
 */
export interface PowerGuide {
  /** Named openings with move sequences */
  openings: OpeningVariation[];
  /** Early-game decision tree: what to decide and when */
  earlyDecisions: string;
  /** Phase-specific priorities for the opening (years 1901-1902) */
  openingPhasePriorities: string;
  /** Diplomatic posture guidance */
  diplomaticPosture: string;
  /** Common mistakes to avoid */
  pitfalls: string;
}

/**
 * A named opening variation with specific move orders.
 */
export interface OpeningVariation {
  name: string;
  description: string;
  springOrders: string[];
  followUp: string;
}

/**
 * Power-specific strategic guides keyed by power.
 */
export const POWER_GUIDES: Record<Power, PowerGuide> = {
  ENGLAND: {
    openings: [
      {
        name: 'The Churchill Opening (Northern)',
        description: 'Aggressive Scandinavian grab targeting Norway and potentially Sweden. Works best with French cooperation.',
        springOrders: [
          'F LON -> NTH',
          'F EDI -> NWG',
          'A LVP -> YOR',
        ],
        followUp: 'Fall: F NTH CONVOY A YOR -> NWY, F NWG SUPPORT A YOR -> NWY. Secures Norway and positions for Sweden.',
      },
      {
        name: 'The Churchill Opening (Channel Variant)',
        description: 'Pressures France via the English Channel while still contesting Scandinavia. Signals hostility toward France.',
        springOrders: [
          'F LON -> ENG',
          'F EDI -> NTH',
          'A LVP -> WAL',
        ],
        followUp: 'Fall: Use Channel for Belgium or Brest. Risky—France becomes an immediate enemy. Only choose if you distrust France.',
      },
      {
        name: 'The Yorkshire Opening',
        description: 'Flexible opening that delays the France/Scandinavia decision. Army to Yorkshire can convoy to Norway or shift south.',
        springOrders: [
          'F LON -> NTH',
          'F EDI -> NWG',
          'A LVP -> YOR',
        ],
        followUp: 'Decide in Fall: convoy to Norway (standard) or pivot to Belgium/Holland depending on diplomatic situation.',
      },
    ],
    earlyDecisions: `**The France Decision (Spring 1901):** Your most critical choice. Moving to the English Channel signals war with France; moving to the North Sea signals cooperation. This single move shapes your entire early game. Default to North Sea unless you have a firm German ally against France.

**The Scandinavia Question:** Norway is your natural first build. Sweden is contested with Russia. Decide early whether to fight Russia for Sweden or concede it in exchange for a northern alliance.

**Fleet vs Army Build (Winter 1901):** If you took Norway, build F LON or F EDI to dominate the seas. Only build an army if you're committed to a land campaign in Europe. England's power is naval—stay on the water.`,

    openingPhasePriorities: `**Spring 1901:** Secure the North Sea (critical control point). Move toward Norway. Signal intentions to France clearly.
**Fall 1901:** Take Norway. Decide on Belgium—if Germany is cooperative, let them have Holland while you take Belgium, or vice versa.
**1902 Goals:** Consolidate Scandinavia. Build a second fleet. Begin positioning against either France or Russia—not both.
**Key Principle:** England is slow to start but nearly unstoppable once it controls 5-6 supply centers. Patience is your greatest weapon. Never rush into a two-front war.`,

    diplomaticPosture: `**With France:** The Channel is everything. If you move there Spring 1901, explain why. If you don't, insist on a DMZ. France is either your best ally or your worst enemy—there is no middle ground.
**With Germany:** Natural partner against France. Propose: you take Norway and Belgium, Germany takes Holland and Denmark. The Anglo-German alliance is historically one of the strongest.
**With Russia:** Discuss Scandinavia early. A deal on Sweden (you get Norway, Russia gets Sweden) prevents a northern conflict that benefits neither of you.`,

    pitfalls: `- Moving to the Channel "just in case"—this makes France an enemy for no gain
- Fighting Russia over Sweden in 1901—it's not worth it when Norway is free
- Building armies instead of fleets—England wins through naval supremacy
- Ignoring Germany—a hostile Germany with France is a death sentence
- Expanding too slowly—if you only have 4 SCs by 1903, you're falling behind`,
  },

  FRANCE: {
    openings: [
      {
        name: 'The Maginot Opening',
        description: 'Defensive opening securing Iberia while watching England and Germany. The safest and most common French opening.',
        springOrders: [
          'A PAR -> BUR',
          'A MAR -> SPA',
          'F BRE -> MAO',
        ],
        followUp: 'Fall: F MAO -> POR (or SPA/SC), A SPA HOLD or -> POR. Army in Burgundy watches Germany. Guaranteed two builds.',
      },
      {
        name: 'The Northern Opening',
        description: 'Aggressive anti-English stance. Only use if you have a firm alliance with Germany.',
        springOrders: [
          'A PAR -> PIC',
          'A MAR -> BUR',
          'F BRE -> ENG',
        ],
        followUp: 'Fall: If Channel succeeds, attack London or Belgium. If bounced, reposition. Very risky without German support.',
      },
      {
        name: 'The Burgundy Gambit',
        description: 'Sends army to Burgundy to contest Munich or defend against German aggression, while securing Iberia.',
        springOrders: [
          'A PAR -> BUR',
          'A MAR -> SPA',
          'F BRE -> MAO',
        ],
        followUp: 'Fall: If Germany is hostile, A BUR defends. If cooperative, A BUR -> BEL or MUN with support.',
      },
    ],
    earlyDecisions: `**The Alliance Choice:** France must ally with either England or Germany early. Trying to be friends with both often means being betrayed by both. Pick one and commit. The traditional choice: ally with England against Germany, or with Germany against England.

**Burgundy Policy:** Army in Burgundy is both offensive (threatens Munich, Belgium) and defensive (blocks German aggression). Decide whether Burgundy is a staging ground or a defensive position based on your alliance.

**Mediterranean Ambitions:** After securing Iberia (Spain + Portugal), you face a choice: push toward Italy via Piedmont/Gulf of Lyon, or consolidate north. Going south too early leaves you vulnerable to England + Germany.`,

    openingPhasePriorities: `**Spring 1901:** Move to Iberia immediately—Spain and Portugal are uncontested. Get army to Burgundy for flexibility.
**Fall 1901:** Secure Spain and Portugal for two guaranteed builds. Use Burgundy army based on diplomatic situation.
**1902 Goals:** Build one fleet (for Channel defense or Mediterranean expansion) and one army. Push toward Belgium or Munich if your ally supports it.
**Key Principle:** France has the best corner position in the game. Secure Iberia, form one strong alliance, and expand methodically. France wins long games—don't gamble early.`,

    diplomaticPosture: `**With England:** Propose a Channel DMZ immediately. If England agrees, you have a reliable ally. If they move to the Channel, you know they're hostile. The Channel is France's litmus test.
**With Germany:** Propose a Burgundy arrangement—either a DMZ or a joint operation against England. A Franco-German alliance is devastating to England and opens Belgium/Holland for division.
**With Italy:** Keep Italy neutral. Propose mutual non-aggression in Piedmont. Italy moving to Piedmont in Spring 1901 is a red flag—respond firmly.`,

    pitfalls: `- Not taking Spain/Portugal in 1901—these are free supply centers, always grab them
- Fighting both England and Germany—this is a death sentence for France
- Ignoring the Channel—if England moves there, you must respond immediately
- Overextending south toward Italy before securing the north
- Being too passive—France can stall if it doesn't expand beyond 5 SCs by 1903`,
  },

  GERMANY: {
    openings: [
      {
        name: 'The Blitzkrieg Opening',
        description: 'Aggressive grab for Holland and Denmark while keeping options open against both France and Russia.',
        springOrders: [
          'F KIE -> DEN',
          'A BER -> KIE',
          'A MUN -> RUH',
        ],
        followUp: 'Fall: F DEN HOLD, A KIE -> HOL, A RUH -> BEL (or HOLD if contested). Two neutral SCs.',
      },
      {
        name: 'The Dutch Opening',
        description: 'Secures Holland quickly while fleet moves to Denmark. Standard and balanced.',
        springOrders: [
          'F KIE -> HOL',
          'A BER -> KIE',
          'A MUN -> RUH',
        ],
        followUp: 'Fall: A KIE -> DEN, A RUH -> BEL or MUN. Fleet in Holland can move to North Sea later for anti-English operations.',
      },
      {
        name: 'The Southern Opening',
        description: 'Anti-French stance with Munich army moving south or holding to defend against French Burgundy.',
        springOrders: [
          'F KIE -> DEN',
          'A BER -> KIE',
          'A MUN -> BUR',
        ],
        followUp: 'If Burgundy succeeds, you have crippled France. If bounced, fall back to Munich. Only use with English alliance.',
      },
    ],
    earlyDecisions: `**Survival First:** Germany's central position means you can be attacked from all sides. Your first priority is NOT expansion—it's ensuring you're not attacked from multiple directions simultaneously. Secure at least two non-aggression pacts before making any aggressive moves.

**The Russia Question:** Russia can be your best friend or your executioner. A Russo-German alliance secures your east and lets you focus on France/England. Hostility with Russia while also fighting in the west is historically fatal.

**Holland/Denmark vs Belgium:** Holland and Denmark are relatively safe grabs. Belgium is contested between France, England, and Germany. Don't fight for Belgium in 1901 unless you have clear support—take the safe neutrals first.`,

    openingPhasePriorities: `**Spring 1901:** Secure Denmark and position for Holland. Keep Munich army flexible—it's your most important defensive piece.
**Fall 1901:** Take Holland and Denmark. That's 5 SCs and 2 builds. Don't overextend trying for Belgium.
**1902 Goals:** Build armies (not fleets—your power is land-based). Decide your main expansion direction: west toward France/Belgium, or east toward Warsaw/Moscow.
**Key Principle:** Germany wins by being everyone's second-best friend. Never be the biggest threat on the board. Grow quietly while others fight, then strike decisively when the moment is right.`,

    diplomaticPosture: `**With France:** A Burgundy DMZ is standard. If France moves to Burgundy in Spring, it's not necessarily hostile—it's defensive. Don't overreact. Propose: you take Holland, France takes Belgium, DMZ in Burgundy.
**With England:** England is a natural ally against France, but also a potential threat if they build fleets toward the North Sea. Propose cooperation against France and a division of the Low Countries.
**With Russia:** Critical relationship. Propose a bounce in Sweden (if applicable) and mutual non-aggression on the eastern border. A stable east lets you focus west. The Russo-German alliance is Germany's path to victory.`,

    pitfalls: `- Fighting on two fronts—this has literally never worked for Germany in Diplomacy
- Antagonizing Russia early—Russia's armies can pour through Silesia and Prussia
- Building fleets—Germany needs armies; leave the seas to England
- Being too aggressive in 1901—taking Belgium against resistance creates enemies
- Ignoring the Munich army—it's your key defensive and offensive piece`,
  },

  ITALY: {
    openings: [
      {
        name: 'The Lepanto Opening',
        description: 'Classic Austro-Italian cooperation against Turkey. Fleet convoys army across the Mediterranean to attack Turkey from the south.',
        springOrders: [
          'F NAP -> ION',
          'A ROM -> APU',
          'A VEN HOLD',
        ],
        followUp: 'Fall: F ION CONVOY A APU -> TUN, A VEN HOLD. Winter: build F NAP. 1902: convoy army to Eastern Mediterranean for Smyrna/Syria.',
      },
      {
        name: 'The Tyrolia Attack',
        description: 'Aggressive anti-Austrian opening. Sends army to Tyrolia to threaten Vienna and Trieste.',
        springOrders: [
          'A VEN -> TYR',
          'A ROM -> VEN',
          'F NAP -> ION',
        ],
        followUp: 'Fall: A TYR -> VIE or TRI, A VEN SUPPORT. Cripples Austria early. Only works with Russian or Turkish cooperation.',
      },
      {
        name: 'The Key Lepanto (Obriani)',
        description: 'Variation of Lepanto where Venice moves to Piedmont to watch France while executing the eastern campaign.',
        springOrders: [
          'F NAP -> ION',
          'A ROM -> APU',
          'A VEN -> PIE',
        ],
        followUp: 'Fall: F ION CONVOY A APU -> TUN, A PIE watches France. Balances eastern aggression with western defense.',
      },
    ],
    earlyDecisions: `**The Austria Decision:** This is Italy's defining choice. Alliance with Austria (Lepanto) gives you a structured plan against Turkey. Attacking Austria is tempting but often leads to a drawn-out Balkan war that benefits Turkey and Russia. Default to Lepanto unless Austria is clearly hostile.

**Tunis Timing:** Tunis is Italy's free supply center. Take it Fall 1901 via Ionian Sea convoy. Never skip Tunis—it's guaranteed growth. The only question is what army to send (Apulia for Lepanto setup, Rome for flexibility).

**France vs East:** Italy often faces a dilemma between western expansion (France—slow but safe) and eastern expansion (Balkans—faster but contested). Commit to one direction by 1902.`,

    openingPhasePriorities: `**Spring 1901:** Get fleet to Ionian Sea (essential for Tunis and Eastern Mediterranean control). Position army for Fall convoy to Tunis. Decide on Venice's destination based on Austria relations.
**Fall 1901:** Take Tunis. This is non-negotiable—it's a free supply center.
**1902 Goals:** If Lepanto: convoy army to Eastern Med, target Smyrna or Greece. If anti-Austria: push on Trieste/Vienna. Build fleets for Mediterranean dominance.
**Key Principle:** Italy is the "jackal" of Diplomacy—patient, opportunistic, and deadly when the moment is right. Don't commit forces until you see weakness, then strike decisively. Italy's slow start is normal; panic expansion leads to disaster.`,

    diplomaticPosture: `**With Austria:** The single most important relationship in your game. A strong Austro-Italian alliance (Lepanto) is one of the most powerful combinations in Diplomacy. Propose it immediately and sincerely. If Austria is hostile, ally with Turkey against them.
**With France:** Propose mutual non-aggression across Piedmont and Gulf of Lyon. France is rarely an early threat if you leave them alone. A long-term Franco-Italian alliance is very strong.
**With Turkey:** If doing Lepanto, Turkey is your target—but don't reveal this too early. If Austria betrays you, Turkey becomes your natural eastern ally.`,

    pitfalls: `- Skipping Tunis in 1901—there's no excuse for missing a free supply center
- Attacking Austria without allies—this creates a Balkan quagmire that Turkey exploits
- Moving to Piedmont Spring 1901 without reason—this panics France for no gain
- Building armies instead of fleets—Italy's power is Mediterranean naval control
- Being passive—Italy with only 4 SCs in 1903 is failing; you need to expand`,
  },

  AUSTRIA: {
    openings: [
      {
        name: 'The Balkan Gambit',
        description: 'Standard Austrian opening securing Serbia and positioning against Turkey. The most common and safest Austrian play.',
        springOrders: [
          'A VIE -> GAL',
          'A BUD -> SER',
          'F TRI -> ALB',
        ],
        followUp: 'Fall: A SER HOLD, A GAL watches Russia, F ALB -> GRE. Two neutral SCs (Serbia + Greece) for strong builds.',
      },
      {
        name: 'The Hedgehog',
        description: 'Defensive formation that secures Serbia while keeping Vienna for defense. Works when surrounded by hostile neighbors.',
        springOrders: [
          'A VIE -> BUD',
          'A BUD -> SER',
          'F TRI -> ALB',
        ],
        followUp: 'Fall: A SER HOLD, A BUD HOLD or -> RUM, F ALB -> GRE. Conservative but safe. Good when you distrust Russia AND Italy.',
      },
      {
        name: 'The Southern Hedgehog',
        description: 'Anti-Italian defense while grabbing Serbia. Use when Italy shows hostility (Tyrolia move).',
        springOrders: [
          'A VIE -> TYR',
          'A BUD -> SER',
          'F TRI -> ADR',
        ],
        followUp: 'Fall: Depends on Italian response. If Italy backed off, A TYR -> VEN. If war, defend Trieste. Risky but necessary against aggressive Italy.',
      },
    ],
    earlyDecisions: `**The Russia Deal:** Austria lives or dies by its relationship with Russia. If Russia moves to Galicia Spring 1901, you are in immediate danger. Propose a Galicia bounce or DMZ BEFORE the game starts. A Russo-Austrian alliance (targeting Turkey) is Austria's strongest opening path.

**Serbia is Sacred:** Serbia is Austria's guaranteed first grab. Never miss Serbia in 1901. It's your only safe neutral supply center, and failing to take it is a catastrophic setback.

**The Italy Problem:** If Italy moves to Tyrolia in Spring 1901, you must respond. Propose a firm alliance or prepare to fight. Don't ignore an army in Tyrolia—it threatens Vienna directly.`,

    openingPhasePriorities: `**Spring 1901:** Take Serbia. Get to Galicia (to watch Russia) or Albania (to grab Greece). Every Austrian opening starts with Serbia.
**Fall 1901:** Secure Serbia and ideally grab Greece via Albania. If Galicia is contested, negotiate—don't fight Russia and Turkey simultaneously.
**1902 Goals:** Push into the Balkans (Greece, Bulgaria, Rumania). Build armies to defend your central position. Begin coordinated attack on Turkey with Russia (or on Russia with Turkey).
**Key Principle:** Austria is the hardest power to play. Survival through 1902 is itself an achievement. If you reach 6 SCs by 1903 with intact alliances, you're in strong position. Diplomacy is not optional for Austria—it's survival.`,

    diplomaticPosture: `**With Russia:** Your most important relationship. Propose immediately: DMZ Galicia, Russia takes Rumania, you take Serbia and Greece. The Russo-Austrian alliance against Turkey is Austria's best path. If Russia won't commit, you're in danger.
**With Italy:** Propose Lepanto (joint attack on Turkey). If Italy agrees sincerely, you've secured your western flank and have a coordinated campaign plan. If Italy moves to Tyrolia, treat it as a hostile act.
**With Turkey:** If not allied with Russia, consider a Turkish alliance against Russia. Turkey + Austria can divide the Balkans, but you're always vulnerable to a Turkish stab. Never fully trust Turkey if Russia is also hostile.`,

    pitfalls: `- Not taking Serbia in 1901—this is a fatal mistake for Austria
- Fighting both Russia and Italy simultaneously—this is how Austria dies in 1902
- Ignoring Galicia—if Russia takes Galicia unchallenged, Vienna is at risk
- Trusting everyone without verification—Austria needs allies but must verify actions
- Building fleets—Austria is a land power; fleets in the Adriatic are rarely useful early`,
  },

  RUSSIA: {
    openings: [
      {
        name: 'The Northern Opening (Octopus)',
        description: 'Focus on Scandinavia, targeting Sweden and Norway. Pairs well with a southern alliance with Turkey.',
        springOrders: [
          'F STP/SC -> BOT',
          'A MOS -> UKR',
          'A WAR -> GAL',
          'F SEV -> BLA',
        ],
        followUp: 'Fall: F BOT -> SWE, A UKR -> RUM (or SEV), A GAL bounce or hold, F BLA -> various. Sweden + Rumania for two builds.',
      },
      {
        name: 'The Southern Opening (Steamroller)',
        description: 'Aggressive southern push toward Turkey and the Balkans. Pair with English/German alliance in the north.',
        springOrders: [
          'F STP/SC -> BOT',
          'A MOS -> SEV',
          'A WAR -> UKR',
          'F SEV -> BLA',
        ],
        followUp: 'Fall: Mass forces for Turkey attack. F BLA -> CON or ANK. A UKR -> RUM. Maximum southern pressure.',
      },
      {
        name: 'The Squid Opening',
        description: 'Balanced opening that keeps options in both north and south. Maximum flexibility, minimum commitment.',
        springOrders: [
          'F STP/SC -> BOT',
          'A MOS -> UKR',
          'A WAR -> GAL',
          'F SEV -> BLA',
        ],
        followUp: 'Fall: Decide based on Spring results. F BOT -> SWE (if uncontested). South depends on Turkey/Austria dynamics.',
      },
    ],
    earlyDecisions: `**North vs South:** Russia starts with four units but is stretched across the entire map. You CANNOT fight effectively in both Scandinavia and the Black Sea simultaneously. Choose one front for aggression and play defensively on the other. The northern path (Sweden, Norway) is safer; the southern path (Turkey) is more rewarding but riskier.

**The Galicia Question:** Moving A WAR -> GAL Spring 1901 is defensive and signals distrust of Austria. If you've agreed to a DMZ with Austria, honor it—or bounce. Getting caught lying about Galicia destroys your credibility.

**Black Sea Policy:** Moving F SEV -> BLA is standard but provocative toward Turkey. Some players propose a Black Sea bounce or DMZ. Decide based on whether you want Turkey as an ally (Juggernaut) or target.`,

    openingPhasePriorities: `**Spring 1901:** Get fleet to Gulf of Bothnia (Sweden access). Position southern units based on your chosen focus. Decide Galicia policy with Austria.
**Fall 1901:** Take Sweden (nearly guaranteed). Take Rumania if possible (may be contested by Austria or Turkey). That's 6 SCs and 2 builds.
**1902 Goals:** If northern: push for Norway, build fleets in St. Petersburg. If southern: attack Turkey with Austrian support, push for Constantinople. Build armies for your chosen front.
**Key Principle:** Russia's size is both strength and weakness. You have more starting units than anyone, but they're far apart. Concentrate force on one front. A scattered Russia is a weak Russia.`,

    diplomaticPosture: `**With Turkey:** The Juggernaut (Russo-Turkish alliance) is the most feared alliance in Diplomacy. If you pursue it, commit fully—a half-hearted Juggernaut fails. If you're targeting Turkey, get Austria and ideally Italy as allies first.
**With Austria:** Propose a Galicia arrangement immediately. Russia-Austria alliance against Turkey is the mirror of Lepanto from the east. Divide the Balkans fairly: Russia gets Rumania and Bulgaria, Austria gets Serbia and Greece.
**With England:** England and Russia share no borders. A long-distance alliance (England takes France/Germany, Russia takes Turkey/Austria) is stable and powerful. Coordinate against Germany if needed.`,

    pitfalls: `- Fighting on both fronts—Russia with 4 units cannot attack Sweden AND Turkey simultaneously
- Lying about Galicia—if Austria catches you, you've made a permanent enemy
- Ignoring Sweden—it's your easiest neutral SC, always take it in 1901
- Building fleets in the south when you need armies (or vice versa)—match builds to your strategy
- Letting Turkey grow unchecked—a 6-SC Turkey in 1903 is extremely dangerous`,
  },

  TURKEY: {
    openings: [
      {
        name: 'The Constantinople Opening',
        description: 'Standard Turkish opening securing Bulgaria and Black Sea access. Safe and flexible.',
        springOrders: [
          'A CON -> BUL',
          'F ANK -> BLA',
          'A SMY -> CON',
        ],
        followUp: 'Fall: A BUL HOLD or -> GRE/SER, F BLA -> SEV or RUM (if Russia cooperates), A CON -> BUL or holds. Secure Bulgaria and one more SC.',
      },
      {
        name: 'The Russian Attack Opening',
        description: 'Aggressive anti-Russian play aiming for the Black Sea and Sevastopol. Use with Austrian alliance.',
        springOrders: [
          'A CON -> BUL',
          'F ANK -> BLA',
          'A SMY -> ARM',
        ],
        followUp: 'Fall: F BLA -> SEV (if uncontested), A ARM SUPPORT F BLA -> SEV, A BUL holds. Maximum pressure on Russia.',
      },
      {
        name: 'The Juggernaut Opening',
        description: 'Cooperative opening with Russia. Turkey takes Bulgaria and pushes west while Russia pushes south.',
        springOrders: [
          'A CON -> BUL',
          'F ANK -> CON',
          'A SMY -> CON',
        ],
        followUp: 'Fall: A BUL -> GRE, F CON -> AEG, A CON -> BUL. Western push through Greece and the Aegean. Russia takes Rumania.',
      },
    ],
    earlyDecisions: `**The Russia Relationship:** Turkey's game revolves around Russia. A Juggernaut alliance (Turkey + Russia) is the most powerful combination in the game but terrifies everyone else. An anti-Russian stance is safer diplomatically but harder to execute. Decide before the game starts.

**Bulgaria First:** Bulgaria is Turkey's Serbia—your guaranteed first grab. Never miss it. The question is what else you take in 1901: Greece (contested with Austria), or a Black Sea position for Sevastopol later.

**The Black Sea:** Moving to the Black Sea Spring 1901 is standard but provocative toward Russia. If you're doing Juggernaut, consider NOT moving there as a trust signal. If targeting Russia, the Black Sea is essential.`,

    openingPhasePriorities: `**Spring 1901:** Take Bulgaria (always). Get fleet to Black Sea (or Constantinople for western push). Position Smyrna army based on strategy.
**Fall 1901:** Secure Bulgaria. Grab Greece if uncontested (contest with Austria likely). Establish Black Sea control or negotiate it away for Juggernaut trust.
**1902 Goals:** If anti-Russia: push for Sevastopol and Rumania. If Juggernaut: push west through Greece, Serbia, and the Aegean. Build fleets for Mediterranean dominance.
**Key Principle:** Turkey's corner position is the safest in the game—you cannot be eliminated quickly. Use this security to build slowly and strike when opponents are weakened. Turkey wins by outlasting everyone. Patience is your superpower.`,

    diplomaticPosture: `**With Russia:** The defining relationship. If Juggernaut: propose it clearly and demonstrate trust (don't move to Black Sea, or propose a bounce). If targeting Russia: secretly coordinate with Austria and possibly Italy. A Juggernaut announcement terrifies the board—keep it secret if possible.
**With Austria:** If not doing Juggernaut, Austria is your natural ally against Russia. Propose: Turkey gets Bulgaria and Greece, Austria gets Serbia and Rumania, then jointly attack Russia. Watch for Austrian betrayal—they may side with Russia against you.
**With Italy:** Italy is rarely an early threat. If Italy proposes Lepanto (against you), coordinate with Russia for defense. If Italy is neutral, leave them alone—they're too far away to matter in 1901-1902.`,

    pitfalls: `- Missing Bulgaria in 1901—catastrophic, never let this happen
- Announcing Juggernaut publicly—this causes everyone to unite against you
- Overextending into the Mediterranean too early—secure your position first
- Ignoring Austria's Greek ambitions—if Austria takes Greece, you've lost expansion room
- Fighting Russia AND Austria simultaneously—pick one and commit`,
  },
};

/**
 * Get the full strategic guide for a power.
 */
export function getPowerGuide(power: Power): PowerGuide {
  return POWER_GUIDES[power];
}

/**
 * Format a power guide as markdown for inclusion in system prompts.
 */
export function formatPowerGuideMarkdown(power: Power): string {
  const guide = POWER_GUIDES[power];
  const sections: string[] = [];

  sections.push(`## ${power} Opening Guide`);
  sections.push('');

  // Named openings
  sections.push('### Named Openings');
  for (const opening of guide.openings) {
    sections.push(`**${opening.name}:** ${opening.description}`);
    sections.push('```');
    for (const order of opening.springOrders) {
      sections.push(order);
    }
    sections.push('```');
    sections.push(`*Follow-up:* ${opening.followUp}`);
    sections.push('');
  }

  // Early decisions
  sections.push('### Early Decisions');
  sections.push(guide.earlyDecisions);
  sections.push('');

  // Opening phase priorities
  sections.push('### Opening Phase Priorities');
  sections.push(guide.openingPhasePriorities);
  sections.push('');

  // Diplomatic posture
  sections.push('### Diplomatic Posture');
  sections.push(guide.diplomaticPosture);
  sections.push('');

  // Pitfalls
  sections.push('### Common Mistakes to Avoid');
  sections.push(guide.pitfalls);

  return sections.join('\n');
}

/**
 * Get a concise opening recommendation based on year and phase.
 * Returns targeted advice for the current game state.
 */
export function getOpeningAdvice(power: Power, year: number): string | null {
  if (year > 1902) return null;

  const guide = POWER_GUIDES[power];

  if (year === 1901) {
    return `**Opening Theory Reminder:** ${guide.openings[0].name} is the standard opening for ${power}. ${guide.openings[0].description}\n\n${guide.earlyDecisions}`;
  }

  if (year === 1902) {
    return guide.openingPhasePriorities;
  }

  return null;
}
