(function(){
"use strict";

/* ---------------- Constants ---------------- */
const STORAGE_KEY = "fortnight-wta-state-v1";
const ROUND_ORDER = ["R128","R64","R32","R16","QF","SF","F"];
const ROUND_LABELS = {R128:"R128", R64:"R64", R32:"R32", R16:"R16", QF:"QF", SF:"SF", F:"F", Q1:"Q1", Q2:"Q2", Q3:"Q3", BRONZE:"Bronze"};
const FRIENDLY_ROUND_NAMES = {R128:"Round of 128", R64:"Round of 64", R32:"Round of 32", R16:"Round of 16", QF:"Quarterfinals", SF:"Semifinals", F:"Final"};
const LEVEL_LABELS = {GRAND_SLAM:"Grand Slam", WTA1000:"WATP 1000", WTA500:"WATP 500", WTA250:"WATP 250", CHALLENGER125:"WATP Challenger 125", CHALLENGER100:"WATP Challenger 100", OLYMPICS:"Summer Olympics", FINALS:"WATP Finals"};
const LEVEL_TAG_CLASSES = {GRAND_SLAM:"level-grandslam", FINALS:"level-finals", WTA1000:"level-1000", WTA500:"level-500", WTA250:"level-250", CHALLENGER125:"level-challenger", CHALLENGER100:"level-challenger", OLYMPICS:"level-olympics"};
// Highest prestige first — used to order same-week tournaments on the
// calendar (Grand Slam/Finals at the top, Challengers at the bottom),
// rather than a plain alphabetical list where a 250 could sit above a Slam
// just because its name comes first in the alphabet.
const LEVEL_SORT_ORDER = ["GRAND_SLAM", "FINALS", "OLYMPICS", "WTA1000", "WTA500", "WTA250", "CHALLENGER125", "CHALLENGER100"];
function levelSortRank(level){
  const idx = LEVEL_SORT_ORDER.indexOf(level);
  return idx === -1 ? LEVEL_SORT_ORDER.length : idx;
}
// Default seed values for state.pointsConfig — real ATP/WTA point tables
// (singles rows), covering every draw size the app actually offers.
// Levels with only one bracket use a single 0-9999 range; levels that
// genuinely pay out differently by draw size (1000/500/250) get one
// bracket per real-world draw-size tier. This is only ever used to
// initialize state.pointsConfig the first time — after that, the editable
// copy in state is the source of truth, and this constant is never read
// directly again.
const DEFAULT_POINTS_CONFIG = {
  GRAND_SLAM: [
    {minDraw:0, maxDraw:9999, points:{R128:10, R64:45, R32:90, R16:180, QF:360, SF:720, F:1200, W:2000}, qual:{Q:25, Q2:8, Q1:0}}
  ],
  WTA1000: [
    {minDraw:80, maxDraw:9999, points:{R128:10, R64:25, R32:45, R16:90, QF:180, SF:360, F:600, W:1000}, qual:{Q:25, Q2:8, Q1:0}},
    {minDraw:0, maxDraw:79, points:{R64:10, R32:45, R16:90, QF:180, SF:360, F:600, W:1000}, qual:{Q:25, Q2:16, Q1:0}}
  ],
  WTA500: [
    {minDraw:40, maxDraw:9999, points:{R64:0, R32:20, R16:45, QF:90, SF:180, F:300, W:500}, qual:{Q:10, Q2:4, Q1:0}},
    {minDraw:0, maxDraw:39, points:{R32:0, R16:45, QF:90, SF:180, F:300, W:500}, qual:{Q:20, Q2:10, Q1:0}}
  ],
  WTA250: [
    {minDraw:40, maxDraw:9999, points:{R64:0, R32:10, R16:20, QF:45, SF:90, F:150, W:250}, qual:{Q:5, Q2:3, Q1:0}},
    {minDraw:0, maxDraw:39, points:{R32:0, R16:20, QF:45, SF:90, F:150, W:250}, qual:{Q:12, Q2:6, Q1:0}}
  ],
  CHALLENGER125: [
    {minDraw:0, maxDraw:9999, points:{R128:0, R64:0, R32:0, R16:10, QF:25, SF:45, F:75, W:125}, qual:{Q:3, Q2:0, Q1:0}}
  ],
  CHALLENGER100: [
    {minDraw:0, maxDraw:9999, points:{R128:0, R64:0, R32:0, R16:8, QF:18, SF:35, F:60, W:100}, qual:{Q:2, Q2:0, Q1:0}}
  ],
  // There's still a real bronze medal match between the two semifinal
  // losers — it's just not treated as worth more or less than an ordinary
  // semifinal loss for points/rankings purposes. Both losers simply earn
  // the plain SF value here, same as any other level. No qualifying,
  // per the reference table (an Olympic singles draw is straight into the
  // main 64-draw, no qualifying rounds).
  OLYMPICS: [
    {minDraw:0, maxDraw:9999, points:{R128:0, R64:5, R32:35, R16:70, QF:135, SF:305, F:450, W:750}, qual:{Q:0, Q2:0, Q1:0}}
  ]
};
function ensurePointsConfig(){
  if(!state.pointsConfig) state.pointsConfig = {};
  Object.keys(DEFAULT_POINTS_CONFIG).forEach(level => {
    if(!Array.isArray(state.pointsConfig[level]) || state.pointsConfig[level].length === 0){
      // Deep copy so edits to state never mutate the defaults.
      state.pointsConfig[level] = JSON.parse(JSON.stringify(DEFAULT_POINTS_CONFIG[level]));
      return;
    }
    // The level already has brackets saved — but the points editor's Save
    // Changes rebuilds a bracket entirely from whatever input fields exist
    // in the DOM, so any point key the editor doesn't currently know about
    // gets silently dropped the moment ANY save happens, even one
    // unrelated to that level. This backfills any point/qual key that's
    // genuinely missing (undefined) from an existing bracket, using the
    // matching default bracket for that draw-size range — without ever
    // touching a key that's already present, even if it's explicitly 0,
    // so it never overwrites a real customization.
    const defaultBrackets = DEFAULT_POINTS_CONFIG[level];
    state.pointsConfig[level].forEach(bracket => {
      const defaultBracket = defaultBrackets.find(db => db.minDraw === bracket.minDraw) || defaultBrackets[0];
      if(!bracket.points) bracket.points = {};
      if(!bracket.qual) bracket.qual = {};
      Object.keys(defaultBracket.points).forEach(key => {
        if(bracket.points[key] === undefined) bracket.points[key] = defaultBracket.points[key];
      });
      Object.keys(defaultBracket.qual).forEach(key => {
        if(bracket.qual[key] === undefined) bracket.qual[key] = defaultBracket.qual[key];
      });
    });
  });
}
// Finds the bracket whose draw-size range actually contains this
// tournament's draw size — falls back to the first defined bracket for
// that level if somehow nothing matches, so a lookup never silently
// returns nothing just because of an unusual draw size.
function getPointsBracket(level, drawSize){
  ensurePointsConfig();
  const brackets = state.pointsConfig[level];
  if(!brackets || brackets.length === 0) return null;
  return brackets.find(b => drawSize >= b.minDraw && drawSize <= b.maxDraw) || brackets[0];
}
// Points for coming through qualifying: 0 for early-round exits, a
// per-round consolation for losing in that specific qualifying round
// (Q1, Q2 — this app doesn't model a Q3 round), and a bonus for
// qualifying into the main draw outright (on top of whatever they then do
// there). Numbers come straight from state.pointsConfig, editable in-app.
// Challenger-level events aren't part of the WATP Tour proper — they still
// earn ranking points (just like real Challengers/125s do), but their
// matches are excluded everywhere a stat is specifically a "tour record"
// (career/season win-loss, surface splits, win streaks, Top 10 wins) the
// same way qualifying matches already are. Head-to-head and the plain
// match-history lists are deliberately left alone — those are meant to be
// a complete log of every match played, not a tour-level stat.
const CHALLENGER_LEVELS = new Set(["CHALLENGER125", "CHALLENGER100"]);
function isTourLevelMatch(m){
  if((m.bracket || "main") === "qual") return false;
  const t = tournamentById(m.tournamentId);
  if(t && CHALLENGER_LEVELS.has(t.level)) return false;
  return true;
}
const QUALIFIER_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const QUAL_ROUND_OPTIONS = [1, 2, 3];

// WATP Finals: 8 players, 2 groups of 4, round robin then a 4-player knockout.
// These points are BONUS points on top of the normal ranking system — they
// never take up one of a player's 18 counted results (see computeRankingsAsOf).
const RR_WIN_POINTS = {0:0, 1:200, 2:400, 3:600};
const FINALS_CHAMPION_BONUS = 500;
const FINALS_RUNNERUP_BONUS = 300;

// Common tennis-broadcast 3-letter codes -> ISO 3166-1 alpha-2 (for flag emoji).
// 2-letter codes are assumed to already be ISO alpha-2 and used directly.
const COUNTRY_CODE_MAP = {
  USA:"US", GBR:"GB", ESP:"ES", FRA:"FR", GER:"DE", ITA:"IT", RUS:"RU", CHN:"CN",
  JPN:"JP", AUS:"AU", CAN:"CA", BRA:"BR", ARG:"AR", MEX:"MX", POL:"PL", CZE:"CZ",
  SVK:"SK", SUI:"CH", SWE:"SE", NOR:"NO", DEN:"DK", FIN:"FI", NED:"NL", BEL:"BE",
  AUT:"AT", GRE:"GR", POR:"PT", ROU:"RO", SRB:"RS", CRO:"HR", UKR:"UA", BLR:"BY",
  KAZ:"KZ", IND:"IN", KOR:"KR", THA:"TH", INA:"ID", PHI:"PH", VIE:"VN", TPE:"TW",
  HKG:"HK", SGP:"SG", MAS:"MY", NZL:"NZ", RSA:"ZA", EGY:"EG", MAR:"MA", TUN:"TN",
  ALG:"DZ", NGR:"NG", KEN:"KE", ETH:"ET", GHA:"GH", ISR:"IL", TUR:"TR", UAE:"AE",
  KSA:"SA", QAT:"QA", IRI:"IR", PAK:"PK", BAN:"BD", SRI:"LK", COL:"CO", CHI:"CL",
  PER:"PE", VEN:"VE", ECU:"EC", URU:"UY", PAR:"PY", BOL:"BO", CUB:"CU", DOM:"DO",
  JAM:"JM", PUR:"PR", CRC:"CR", PAN:"PA", GUA:"GT", HON:"HN", ISL:"IS", IRL:"IE",
  LTU:"LT", LAT:"LV", LVA:"LV", EST:"EE", SLO:"SI", SVN:"SI", BUL:"BG", HUN:"HU",
  MDA:"MD", ARM:"AM", GEO:"GE", AZE:"AZ", UZB:"UZ", MGL:"MN", LUX:"LU", MON:"MC",
  AND:"AD", CYP:"CY", MLT:"MT", ALB:"AL", MKD:"MK", BIH:"BA", MNE:"ME", KOS:"XK"
};

function countryToISO2(code){
  if(!code) return null;
  const c = code.trim().toUpperCase();
  if(c.length === 2) return c;
  if(c.length === 3 && COUNTRY_CODE_MAP[c]) return COUNTRY_CODE_MAP[c];
  return null;
}
// Image-based flag instead of an emoji character — flag emoji rely on the OS
// having flag glyphs in its system font, and most Windows browsers don't
// (you just see the letter code or a blank box there). An actual image looks
// identical on every platform. flagcdn.com is free, keyless, and widely used.
function flagImgHTML(code){
  const iso2 = countryToISO2(code);
  if(!iso2) return "";
  return '<img class="flag-img" src="https://flagcdn.com/' + iso2.toLowerCase() + '.svg" alt="' + iso2 + '" loading="lazy" onerror="this.style.display=\'none\'">';
}
// Flag + code, for standalone country display (tables, cards).
function countryDisplayHTML(code){
  if(!code) return "—";
  return flagImgHTML(code) + escapeHtml(code.toUpperCase());
}
// Flag + name, for use in front of a player's name anywhere it appears.
function playerNameHTML(player){
  if(!player) return "";
  return flagImgHTML(player.country) + escapeHtml(player.name);
}
// Same, but wrapped so clicking it opens that player's profile anywhere it's used —
// works via the existing document-level [data-open-player] click delegation.
function playerLinkHTML(player){
  if(!player) return "";
  return '<span class="name-link" data-open-player="' + player.id + '">' + playerNameHTML(player) + '</span>';
}

/* ---------------- Storage ---------------- */
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return {players:[], tournaments:[], matches:[], byeWeeks:[]};
    const parsed = JSON.parse(raw);
    return {
      players: parsed.players || [],
      tournaments: parsed.tournaments || [],
      matches: parsed.matches || [],
      byeWeeks: parsed.byeWeeks || []
    };
  }catch(e){
    console.error("Failed to load state, starting fresh.", e);
    return {players:[], tournaments:[], matches:[], byeWeeks:[]};
  }
}
function saveState(){
  rankingsAsOfCache.clear();
  officialRanksAsOfCache.clear();
  tournamentResultsCache.clear();
  qualifyingResultsCache.clear();
  tournamentPointsContributionCache.clear();
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }catch(e){
    console.error("Failed to save state", e);
    alert("Couldn't save — your browser storage may be full or blocked.");
  }
}

// One-time migration: the manual Grand Slam entry editor briefly offered
// "1R"/"2R"/"3R"/"4R" codes instead of this app's actual round convention
// ("R128"/"R64"/"R32"/"R16"), which would have silently contributed 0-0 to
// win-loss instead of the correct record. Anyone who saved an entry during
// that window gets it corrected automatically the next time the app loads,
// rather than having to notice and re-enter it by hand. Must run after
// rankingsAsOfCache exists (saveState touches it), so this is called from
// DOMContentLoaded, not at top-level script scope.
function migrateLegacyGsRoundCodes(){
  const legacyMap = {"1R":"R128", "2R":"R64", "3R":"R32", "4R":"R16"};
  let changed = false;
  (state.players || []).forEach(p => {
    if(!Array.isArray(p.manualSlamResults)) return;
    p.manualSlamResults.forEach(entry => {
      if(legacyMap[entry.code]){
        entry.code = legacyMap[entry.code];
        changed = true;
      }
    });
  });
  if(changed) saveState();
}

// One-time migration: a tournament's season year used to be whatever
// calendar year its raw start date happened to fall on — so a tournament
// starting in the last few days of December but playing out mostly in
// January was filed under the wrong season. This recalculates every
// existing tournament's year using the same "majority of the week" rule
// newly-created and edited tournaments now use (computeTournamentSeasonYear,
// defined further down — safe to reference here since this only ever runs
// from DOMContentLoaded, well after the whole script has loaded), so
// tournaments that predate the fix don't stay silently misfiled.
function migrateTournamentSeasonYears(){
  let changed = false;
  (state.tournaments || []).forEach(t => {
    if(!t.startDate) return;
    const startDateMs = new Date(t.startDate + "T00:00:00").getTime();
    if(isNaN(startDateMs)) return;
    const correctYear = computeTournamentSeasonYear(startDateMs, t.twoWeeks ? 14 : 7);
    if(t.year !== correctYear){
      t.year = correctYear;
      changed = true;
    }
  });
  if(changed) saveState();
}

let state = loadState();

function uid(prefix){
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}

/* ---------------- Derived data helpers ---------------- */

function playerById(id){ return state.players.find(p => p.id === id); }
function tournamentById(id){ return state.tournaments.find(t => t.id === id); }
function matchesForTournament(tid){ return state.matches.filter(m => m.tournamentId === tid); }
function matchesForMainDraw(tid){ return state.matches.filter(m => m.tournamentId === tid && (m.bracket || "main") === "main"); }
function matchesForQualifying(tid){ return state.matches.filter(m => m.tournamentId === tid && m.bracket === "qual"); }
function matchesForPlayer(pid){ return state.matches.filter(m => m.playerAId === pid || m.playerBId === pid); }

// Furthest-round result per player for a tournament: 'W', or a round code meaning "lost in that round".
// Returns Map<playerId, {code, isChampion}>
// A tournament's own result classification (who reached what round) only
// ever depends on that tournament's own recorded matches — it's the same
// answer no matter which as-of date is asking. But computeRankingsAsOf
// re-derives it fresh for every tournament that falls inside each of the
// many different rolling windows it walks (once per snapshot date, and a
// given tournament typically stays "in window" for roughly a year's worth
// of consecutive weekly snapshots) — so the same tournament was getting
// recomputed dozens of times over. Caching by tournament id turns that
// into a one-time cost per tournament, cleared on every saveState() the
// same way the other ranking caches are.
let tournamentResultsCache = new Map();
function computeTournamentResults(tid){
  if(tournamentResultsCache.has(tid)) return tournamentResultsCache.get(tid);
  const matches = matchesForMainDraw(tid);
  const furthest = new Map(); // playerId -> {roundIdx, match}
  matches.forEach(m => {
    // The bronze medal match still happens and gets recorded, but it isn't
    // part of the normal round progression — skipping it here means it can
    // never accidentally register as someone's "furthest round" (it isn't
    // further along than the semifinal the way a real round is). Both
    // semifinal losers are scored as a plain semifinal loss, same as any
    // other level; the bronze match's own winner/loser still shows on the
    // bracket itself, it just doesn't change points or rankings.
    if(m.round === "BRONZE") return;
    const idx = ROUND_ORDER.indexOf(m.round);
    [m.playerAId, m.playerBId].forEach(pid => {
      const cur = furthest.get(pid);
      if(!cur || idx > cur.roundIdx){
        furthest.set(pid, {roundIdx: idx, match: m});
      }
    });
  });
  const results = new Map();
  furthest.forEach((info, pid) => {
    const m = info.match;
    const won = m.winnerId === pid;
    if(won && m.round === "F"){
      results.set(pid, {code: "W", label: "Champion"});
    } else if(!won){
      results.set(pid, {code: m.round, label: "Lost " + ROUND_LABELS[m.round]});
    }
    // won but not final -> still active, no result yet
  });
  tournamentResultsCache.set(tid, results);
  return results;
}

function pointsForResult(level, drawSize, code){
  const bracket = getPointsBracket(level, drawSize);
  if(!bracket) return 0;
  return bracket.points[code] || 0;
}

// --- Qualifying ---
function qualRoundNames(numRounds){
  const names = [];
  for(let i = 1; i <= numRounds; i++) names.push("Q" + i);
  return names;
}
function ensureQualifyingEntries(t){
  if(!t.qualifying) t.qualifying = {enabled:false, numQualifiers:8, numRounds:2, entrants:[], bracketEntries:[]};
  const q = t.qualifying;
  if(!QUALIFIER_OPTIONS.includes(q.numQualifiers)) q.numQualifiers = 8;
  if(!QUAL_ROUND_OPTIONS.includes(q.numRounds)) q.numRounds = 2;
  if(!Array.isArray(q.entrants)) q.entrants = [];
  const cap = q.numQualifiers * Math.pow(2, q.numRounds);
  if(!Array.isArray(q.bracketEntries) || q.bracketEntries.length !== cap){
    q.bracketEntries = new Array(cap).fill(0).map(() => ({type:"empty"}));
  }
}

function computeQualifyingBracket(t){
  ensureQualifyingEntries(t);
  const q = t.qualifying;
  const roundNames = qualRoundNames(q.numRounds);
  let currentSlots = q.bracketEntries.map(s => ({...s}));
  const rounds = [];
  for(let r = 0; r < roundNames.length; r++){
    const roundName = roundNames[r];
    const numMatches = currentSlots.length / 2;
    const matches = [];
    const nextSlots = [];
    for(let i = 0; i < numMatches; i++){
      const slotA = currentSlots[i*2], slotB = currentSlots[i*2+1];
      const existingMatch = state.matches.find(m => m.tournamentId === t.id && m.bracket === "qual" && m.round === roundName && m.slot === i);
      let status, winnerSlot = null;
      if(slotA.type === "empty" || slotB.type === "empty"){
        status = "incomplete";
      } else if(existingMatch){
        status = "played";
        winnerSlot = existingMatch.winnerId === slotA.playerId ? slotA : slotB;
      } else {
        status = "ready";
      }
      matches.push({round: roundName, slotIndex: i, slotA, slotB, existingMatch, status, winnerSlot});
      nextSlots.push(winnerSlot ? {type:"player", playerId: winnerSlot.playerId} : {type:"empty"});
    }
    rounds.push({round: roundName, matches});
    currentSlots = nextSlots;
  }
  return rounds;
}

function deleteQualCascade(t, roundIdx, matchIndex){
  const roundNames = qualRoundNames(t.qualifying.numRounds);
  if(roundIdx < 0 || roundIdx >= roundNames.length) return;
  const roundName = roundNames[roundIdx];
  const idx = state.matches.findIndex(m => m.tournamentId === t.id && m.bracket === "qual" && m.round === roundName && m.slot === matchIndex);
  if(idx !== -1){
    state.matches.splice(idx, 1);
    deleteQualCascade(t, roundIdx + 1, Math.floor(matchIndex / 2));
  }
}

function generateQualifyingDraw(t){
  ensureQualifyingEntries(t);
  const q = t.qualifying;
  const cap = q.numQualifiers * Math.pow(2, q.numRounds);
  const shuffled = shuffleArray(q.entrants || []);
  q.bracketEntries = new Array(cap).fill(0).map((_, i) =>
    i < shuffled.length ? {type:"player", playerId: shuffled[i]} : {type:"empty"}
  );
  state.matches = state.matches.filter(m => !(m.tournamentId === t.id && m.bracket === "qual"));
}

// Returns Map<playerId, {code, label}> — code is "Q1".."Qn" (eliminated in that
// round) or "QUALIFIED" (won the last qualifying round, advances to the main draw).
// Same reasoning as computeTournamentResults above — a tournament's
// qualifying results only ever depend on its own recorded qualifying
// matches, not on which as-of date is asking, so this is safe to cache
// per tournament the same way.
let qualifyingResultsCache = new Map();
function computeQualifyingResults(t){
  ensureQualifyingEntries(t);
  if(!t.qualifying.enabled) return new Map();
  if(qualifyingResultsCache.has(t.id)) return qualifyingResultsCache.get(t.id);
  const roundNames = qualRoundNames(t.qualifying.numRounds);
  const matches = matchesForQualifying(t.id);
  const furthest = new Map();
  matches.forEach(m => {
    const idx = roundNames.indexOf(m.round);
    [m.playerAId, m.playerBId].forEach(pid => {
      const cur = furthest.get(pid);
      if(!cur || idx > cur.roundIdx) furthest.set(pid, {roundIdx: idx, match: m});
    });
  });
  const results = new Map();
  furthest.forEach((info, pid) => {
    const m = info.match;
    const won = m.winnerId === pid;
    if(won && info.roundIdx === roundNames.length - 1){
      results.set(pid, {code: "QUALIFIED", label: "Qualified"});
    } else if(!won){
      results.set(pid, {code: m.round, label: "Lost " + m.round});
    }
  });
  qualifyingResultsCache.set(t.id, results);
  return results;
}

function qualifyingPointsForResult(level, drawSize, code){
  const bracket = getPointsBracket(level, drawSize);
  if(!bracket || !bracket.qual) return 0;
  if(code === "QUALIFIED") return bracket.qual.Q || 0;
  // code is "Q1", "Q2", etc. — a direct lookup. This app doesn't model a Q3
  // round, so "Q3" simply isn't a key in qual and naturally resolves to 0
  // rather than needing special-case handling.
  return bracket.qual[code] || 0;
}

/* ---------------- WATP Finals (round robin + knockout) ---------------- */
function ensureFinalsGroups(t){
  if(!Array.isArray(t.groups) || t.groups.length !== 2){
    t.groups = [{id:"A", name:"Group A", playerIds:[]}, {id:"B", name:"Group B", playerIds:[]}];
  }
  if(!Array.isArray(t.seeds) || t.seeds.length !== 8){
    const old = Array.isArray(t.seeds) ? t.seeds : [];
    t.seeds = new Array(8).fill(null).map((_, i) => old[i] || null);
  }
}

// The exact 3-day schedule used by the real tour finals: each entry is a
// pair of within-group positions (0 = that group's top seed, 3 = its lowest).
// 4v2, 1v3 / 2v1, 3v4 / 4v1, 2v3 — covers all 6 pairings exactly once.
const FINALS_DAY_SCHEDULE = [
  {label:"Day 1", pairs:[[3,1],[0,2]]},
  {label:"Day 2", pairs:[[1,0],[2,3]]},
  {label:"Day 3", pairs:[[3,0],[1,2]]}
];

// Orders a group's 4 players by seed rank (best first), falling back to name
// for anyone unseeded — this determines who's "position 1..4" for the day schedule.
function groupPositionOrder(t, group){
  const seedRankOf = (pid) => {
    const idx = (t.seeds || []).indexOf(pid);
    return idx === -1 ? 999 : idx + 1;
  };
  return group.playerIds.slice().sort((a, b) => {
    const ra = seedRankOf(a), rb = seedRankOf(b);
    if(ra !== rb) return ra - rb;
    const pa = playerById(a), pb = playerById(b);
    return (pa ? pa.name : "").localeCompare(pb ? pb.name : "");
  });
}

// All 6 pairings for a group, in the fixed Day 1/2/3 schedule order.
function finalsScheduledPairs(t, group){
  const ordered = groupPositionOrder(t, group);
  const pairs = [];
  FINALS_DAY_SCHEDULE.forEach(d => {
    d.pairs.forEach(([i, j]) => pairs.push([ordered[i], ordered[j]]));
  });
  return pairs;
}

// Seed 1 anchors Group A, seed 2 anchors Group B, then each remaining pot
// (3-4, 5-6, 7-8) splits one seed to each group at random.
function assignFinalsGroupsFromSeeds(t){
  const seeds = t.seeds || [];
  if(!seeds[0] || !seeds[1]){
    alert("Assign at least seed 1 and seed 2 first.");
    return false;
  }
  const groupA = [seeds[0]];
  const groupB = [seeds[1]];
  for(let potStart = 2; potStart < 8; potStart += 2){
    const pair = shuffleArray([seeds[potStart], seeds[potStart + 1]].filter(Boolean));
    if(pair[0]) groupA.push(pair[0]);
    if(pair[1]) groupB.push(pair[1]);
  }
  t.groups[0].playerIds = groupA;
  t.groups[1].playerIds = groupB;
  return true;
}

// All 6 unique pairings among a group's (up to 4) players — unordered, kept
// only as a fallback for anywhere pairing order genuinely doesn't matter.
function groupPairings(playerIds){
  const pairs = [];
  for(let i = 0; i < playerIds.length; i++){
    for(let j = i + 1; j < playerIds.length; j++){
      pairs.push([playerIds[i], playerIds[j]]);
    }
  }
  return pairs;
}

function finalsGroupMatches(t, groupId){
  return state.matches.filter(m => m.tournamentId === t.id && m.bracket === "rr" && m.group === groupId);
}

// Standings with the requested tiebreak order: wins, then head-to-head
// (only decisive for a clean 2-way tie), then set win%, then game win%.
function computeGroupStandings(t, group){
  const stats = new Map();
  group.playerIds.forEach(pid => stats.set(pid, {
    pid, wins:0, losses:0, setsWon:0, setsLost:0, gamesWon:0, gamesLost:0, beat: new Set()
  }));
  finalsGroupMatches(t, group.id).forEach(m => {
    const loserId = m.playerAId === m.winnerId ? m.playerBId : m.playerAId;
    const w = stats.get(m.winnerId), l = stats.get(loserId);
    if(w){ w.wins++; w.beat.add(loserId); }
    if(l) l.losses++;
    (m.sets || []).forEach(s => {
      const winnerIsA = m.playerAId === m.winnerId;
      const wGames = winnerIsA ? s.a : s.b, lGames = winnerIsA ? s.b : s.a;
      if(w){ w.gamesWon += wGames; w.gamesLost += lGames; if(wGames > lGames) w.setsWon++; else w.setsLost++; }
      if(l){ l.gamesWon += lGames; l.gamesLost += wGames; if(lGames > wGames) l.setsWon++; else l.setsLost++; }
    });
  });

  const rows = group.playerIds.map(pid => stats.get(pid));
  const pct = (won, lost) => (won + lost) > 0 ? won / (won + lost) : 0;

  rows.sort((a, b) => {
    if(b.wins !== a.wins) return b.wins - a.wins;
    // Head-to-head only breaks a clean 2-way tie — a 3+-way tie on wins
    // falls straight through to set% then game% instead.
    const tiedAtThisWinCount = rows.filter(r => r.wins === a.wins).length;
    if(tiedAtThisWinCount === 2){
      if(a.beat.has(b.pid)) return -1;
      if(b.beat.has(a.pid)) return 1;
    }
    const setPctDiff = pct(b.setsWon, b.setsLost) - pct(a.setsWon, a.setsLost);
    if(setPctDiff !== 0) return setPctDiff;
    return pct(b.gamesWon, b.gamesLost) - pct(a.gamesWon, a.gamesLost);
  });
  return rows;
}

function finalsGroupStageComplete(t){
  return t.groups.every(g => g.playerIds.length === 4 && finalsGroupMatches(t, g.id).length === 6);
}

// Cross-pairs the top 2 of each group (A1-v-B2, B1-v-A2) — standard so group
// winners don't immediately face the other group's best runner-up.
function getFinalsSemifinalPairing(t){
  if(!finalsGroupStageComplete(t)) return null;
  const standingsA = computeGroupStandings(t, t.groups[0]);
  const standingsB = computeGroupStandings(t, t.groups[1]);
  return [
    {a: standingsA[0].pid, b: standingsB[1].pid},
    {a: standingsB[0].pid, b: standingsA[1].pid}
  ];
}

// Bonus points only — never touches the 18-counted-results system.
function computeFinalsBonusPoints(t){
  const bonus = new Map();
  const winCounts = new Map();
  (t.groups || []).forEach(g => g.playerIds.forEach(pid => winCounts.set(pid, 0)));
  (t.groups || []).forEach(g => {
    finalsGroupMatches(t, g.id).forEach(m => {
      if(winCounts.has(m.winnerId)) winCounts.set(m.winnerId, winCounts.get(m.winnerId) + 1);
    });
  });
  winCounts.forEach((wins, pid) => bonus.set(pid, RR_WIN_POINTS[wins] || 0));

  const finalMatch = state.matches.find(m => m.tournamentId === t.id && (m.bracket||"main") === "main" && m.round === "F");
  if(finalMatch){
    const championId = finalMatch.winnerId;
    const runnerUpId = finalMatch.playerAId === championId ? finalMatch.playerBId : finalMatch.playerAId;
    bonus.set(championId, (bonus.get(championId) || 0) + FINALS_CHAMPION_BONUS);
    bonus.set(runnerUpId, (bonus.get(runnerUpId) || 0) + FINALS_RUNNERUP_BONUS);
  }
  return bonus;
}

// Rankings for a given year (or null = all-time)
function computeRankings(year){
  const totals = new Map(); // playerId -> {points, titles}
  state.players.forEach(p => totals.set(p.id, {points:0, titles:0}));
  state.tournaments.forEach(t => {
    if(year && t.year !== year) return;
    const results = computeTournamentResults(t.id);
    results.forEach((res, pid) => {
      const entry = totals.get(pid);
      if(!entry) return;
      entry.points += pointsForResult(t.level, t.drawSize, res.code); // 0 for FINALS — no bracket configured
      if(res.code === "W") entry.titles += 1;
    });
    if(t.level === "FINALS"){
      const bonus = computeFinalsBonusPoints(t);
      bonus.forEach((pts, pid) => {
        const entry = totals.get(pid);
        if(entry) entry.points += pts;
      });
    }
    if(t.qualifying && t.qualifying.enabled){
      const qresults = computeQualifyingResults(t);
      qresults.forEach((res, pid) => {
        const entry = totals.get(pid);
        if(!entry) return;
        entry.points += qualifyingPointsForResult(t.level, t.drawSize, res.code);
      });
    }
  });
  return totals;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function tournamentDateMs(t){
  if(t.startDate){
    const d = new Date(t.startDate + "T00:00:00");
    if(!isNaN(d.getTime())) return d.getTime();
  }
  return new Date(t.year || 2000, 0, 1).getTime();
}

// A tournament's "season" is whichever calendar year most of its week
// actually falls in — not just whatever year its start date happens to
// land on. A tournament starting Dec 30 plays out mostly in January, so it
// belongs to next year's season even though its own start date is still
// technically the tail end of December. Checks every day the tournament
// actually spans (7 days normally, 14 for a flagged 2-week event) and
// picks whichever year has the most of them.
function computeTournamentSeasonYear(startDateMs, spanDays){
  const counts = {};
  for(let i = 0; i < spanDays; i++){
    const y = new Date(startDateMs + i * MS_PER_DAY).getFullYear();
    counts[y] = (counts[y] || 0) + 1;
  }
  let bestYear = null, bestCount = -1;
  Object.keys(counts).forEach(y => {
    if(counts[y] > bestCount){ bestCount = counts[y]; bestYear = Number(y); }
  });
  return bestYear;
}

// Real tours only count a capped number of a player's best results toward
// their ranking, except the top-tier events, which count no matter what if
// the player entered them — this mirrors that rule.
const MAX_COUNTED_RESULTS = 18;
const MANDATORY_LEVELS = new Set(["GRAND_SLAM", "WTA1000"]);

// Real tours publish rankings weekly as a rolling 52-week points total.
// This mirrors that: sum results from tournaments whose date falls in the
// 364 days up to and including asOfMs, then apply the best-18-plus-mandatory
// counting rule per player.
// computeRankingsAsOf is pure given the current data + a date, and gets
// called repeatedly for the exact same dates across many pages (peak-rank
let rankingsAsOfCache = new Map();
// Same idea one layer up: a tournament's per-player POINTS contribution
// (combining main-draw and qualifying results into what each player
// actually earned there) is just as pure a function of the tournament
// itself as its raw round classification is — it only changes if the
// tournament's own results, level, draw size, or the points config
// change, never because a different as-of date is asking. But it was
// still being rebuilt from scratch (a fresh Set union, a fresh points
// lookup per player) every time this SAME tournament fell inside a
// different snapshot date's rolling window — and a tournament typically
// stays "in window" for roughly a year's worth of consecutive weekly
// snapshots. Caching it here means that work happens once per tournament
// instead of once per (tournament, snapshot date) pair.
let tournamentPointsContributionCache = new Map();
function computeTournamentPointsContribution(t){
  if(tournamentPointsContributionCache.has(t.id)) return tournamentPointsContributionCache.get(t.id);
  const results = computeTournamentResults(t.id);
  const qresults = (t.qualifying && t.qualifying.enabled) ? computeQualifyingResults(t) : new Map();
  const combinedPlayerIds = new Set([...results.keys(), ...qresults.keys()]);
  const contribution = new Map(); // playerId -> {points, isTitle}
  combinedPlayerIds.forEach(pid => {
    const mainRes = results.get(pid);
    const qRes = qresults.get(pid);
    let points = 0;
    let isTitle = false;
    if(mainRes){
      points += pointsForResult(t.level, t.drawSize, mainRes.code);
      if(mainRes.code === "W") isTitle = true;
    }
    if(qRes){
      points += qualifyingPointsForResult(t.level, t.drawSize, qRes.code);
    }
    // Anyone who actually played the main draw always gets an entry (even
    // worth 0 points, matching prior behavior). Someone who only played
    // qualifying and scored nothing there gets no entry at all — no point
    // wasting a slot on a result worth zero.
    if(mainRes || points > 0){
      contribution.set(pid, {points, isTitle});
    }
  });
  tournamentPointsContributionCache.set(t.id, contribution);
  return contribution;
}

function computeRankingsAsOf(asOfMs){
  if(rankingsAsOfCache.has(asOfMs)) return rankingsAsOfCache.get(asOfMs);
  const windowStart = asOfMs - 364 * MS_PER_DAY;
  const totals = new Map();
  const perPlayerResults = new Map(); // playerId -> [{points, mandatory}]
  const finalsBonus = new Map(); // playerId -> flat bonus, added after the 18-cap is applied
  state.players.forEach(p => {
    totals.set(p.id, {points:0, titles:0});
    perPlayerResults.set(p.id, []);
    finalsBonus.set(p.id, 0);
  });

  state.tournaments.forEach(t => {
    const d = tournamentDateMs(t);
    // Exclusive lower bound — a result exactly 364 days (52 weeks) old
    // belongs to the 53rd week back and should have just dropped off.
    // Without this, a tournament recurring on an exact 364-day cycle (like
    // the same week next year) never actually ages out, because the new
    // and old editions both land in-window on the one date that's exactly
    // a year-to-the-day apart.
    if(d > asOfMs || d <= windowStart) return;

    if(t.level === "FINALS"){
      // WATP Finals points are pure bonus — they still award a title for the
      // champion, but deliberately never enter perPlayerResults, so they can
      // never occupy (or get squeezed out of) one of a player's 18 counted
      // results the way a real ranked event would.
      const results = computeTournamentResults(t.id);
      results.forEach((res, pid) => {
        if(res.code === "W"){
          const entry = totals.get(pid);
          if(entry) entry.titles += 1;
        }
      });
      const bonus = computeFinalsBonusPoints(t);
      bonus.forEach((pts, pid) => {
        if(finalsBonus.has(pid)) finalsBonus.set(pid, finalsBonus.get(pid) + pts);
      });
      return;
    }

    const mandatory = MANDATORY_LEVELS.has(t.level);
    const contribution = computeTournamentPointsContribution(t);
    contribution.forEach((c, pid) => {
      const entry = totals.get(pid);
      if(!entry) return;
      if(c.isTitle) entry.titles += 1;
      perPlayerResults.get(pid).push({points: c.points, mandatory});
    });
  });

  perPlayerResults.forEach((results, pid) => {
    const entry = totals.get(pid);
    if(!entry) return;
    entry.points = sumCountedResults(results) + (finalsBonus.get(pid) || 0);
  });

  rankingsAsOfCache.set(asOfMs, totals);
  return totals;
}

// A real tournament seeds off the actual published rankings, and "weeks at
// No. 1" is a record of what was truly published — not a live feed. This is
// the official one-week-behind version of computeRankingsAsOf, for anywhere
// that needs the historically-accurate published ranking rather than a
// real-time snapshot.
function officialRankingsAsOf(mondayW){
  return computeRankingsAsOf(mondayW - 7 * MS_PER_DAY);
}

// Every feature that needs "the official rank of every player as of some
// week" should call this, not build the two pieces separately — retirement
// has to be excluded against the same effective (already-shifted) date the
// totals themselves were computed against, and forgetting that second half
// is exactly what caused every retired player to silently inflate everyone
// below them by one spot across Entry List, Seeding, Auto-Fill, Generate
// Field, and Finals auto-seed, while the main Rankings table (which always
// applied both halves together) stayed correct.
// officialRanksAsOf gets called repeatedly with the SAME mondayW from
// multiple places computing the same player's history (peak rank, the
// ranking-history chart, etc.) — each call would otherwise redo a full
// sort of every player, even though the underlying points totals
// (computeRankingsAsOf) are already cached. This caches the actual ranked
// result too, keyed by the week itself, so repeat lookups for the same
// week are an instant map read instead of a fresh sort every time.
let officialRanksAsOfCache = new Map();
function officialRanksAsOf(mondayW){
  if(officialRanksAsOfCache.has(mondayW)) return officialRanksAsOfCache.get(mondayW);
  const effectiveAsOf = mondayW - 7 * MS_PER_DAY;
  const result = ranksFromTotals(computeRankingsAsOf(effectiveAsOf), effectiveAsOf);
  officialRanksAsOfCache.set(mondayW, result);
  return result;
}

// The actual counting rule: every mandatory result counts no matter how
// many there are, then the best remaining (non-mandatory) results fill out
// the rest of the cap.
function sumCountedResults(results){
  const mandatory = results.filter(r => r.mandatory);
  const optional = results.filter(r => !r.mandatory).sort((a,b) => b.points - a.points);
  const mandatorySum = mandatory.reduce((s, r) => s + r.points, 0);
  const remainingSlots = Math.max(0, MAX_COUNTED_RESULTS - mandatory.length);
  const optionalSum = optional.slice(0, remainingSlots).reduce((s, r) => s + r.points, 0);
  return mandatorySum + optionalSum;
}

// The most recent date with any recorded result — stands in for "today" on the tour calendar.
function byeWeekDateMs(bw){
  const d = new Date(bw.date + "T00:00:00");
  return isNaN(d.getTime()) ? Date.now() : d.getTime();
}
function getLatestActiveDate(){
  let max = null;
  state.tournaments.forEach(t => {
    if(matchesForTournament(t.id).length > 0){
      const d = tournamentDateMs(t);
      if(max === null || d > max) max = d;
    }
  });
  // A bye week still marks a real point on the calendar even though nothing
  // was played — it should still be able to push "current" forward.
  (state.byeWeeks || []).forEach(bw => {
    const d = byeWeekDateMs(bw);
    if(max === null || d > max) max = d;
  });
  return max !== null ? max : Date.now();
}

// The "current season" shown on a player's profile needs to match the
// same majority-of-week rule a tournament's own season is filed under —
// not just the raw calendar year of the latest active date, which can sit
// on either side of a year boundary independent of which season most of
// that week actually belongs to. If the latest activity was an actual
// tournament, its own (already-correct) year is used directly rather than
// re-deriving it; a bye week has no tournament to check against, so the
// same rule is applied straight to its own date.
function getCurrentSeasonYear(){
  const latest = getLatestActiveDate();
  const latestTournament = state.tournaments.find(t =>
    matchesForTournament(t.id).length > 0 && tournamentDateMs(t) === latest
  );
  if(latestTournament) return latestTournament.year;
  return computeTournamentSeasonYear(latest, 7);
}

// Real tours publish rankings on Mondays. Snap any date to the Monday of its own week.
function mondayOf(dateMs){
  const d = new Date(dateMs);
  const day = d.getDay(); // 0 = Sun .. 6 = Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday.getTime();
}
function formatWeekDate(ms){
  return new Date(ms).toLocaleDateString(undefined, {year:"numeric", month:"short", day:"numeric"});
}

// Chronological list of distinct tournament dates with at least one result,
// used as the "weeks" for a player's ranking-history chart.
// If a date falls within some OTHER 2-week flagship tournament's second
// week, it doesn't get its own "new" published ranking in reality — the
// official list from the flagship's own first week is still current for
// the whole fortnight. This redirects any such date back to that
// flagship's own first week, so a smaller event running alongside a
// Slam's second week doesn't spuriously create an extra selectable
// "ranking week" that wouldn't actually have existed.
// If a date falls within some OTHER 2-week flagship tournament's second
// week, it doesn't get its own "new" published ranking in reality — the
// official list from the flagship's own first week is still current for
// the whole fortnight. This redirects any such date back to that
// flagship's own first week, so a smaller event running alongside a
// Slam's second week doesn't spuriously create an extra selectable
// "ranking week" that wouldn't actually have existed.
//
// The redirect map (which weeks need redirecting, and to where) only
// changes when a tournament is added, edited, or removed — so it's built
// once per call to getRankingSnapshotDates()/getRankingWeeks() rather than
// re-scanning every tournament on every single date being canonicalized.
// Doing that per-date used to make both functions O(tournaments²): calling
// canonicalRankingWeek once per tournament, and having it itself loop over
// every tournament each time, gets very slow as the tour's history grows.
function buildCanonicalWeekRedirectMap(){
  const map = new Map();
  state.tournaments.forEach(t => {
    if(!t.twoWeeks) return;
    const flagshipWeek1 = mondayOf(tournamentDateMs(t));
    const flagshipWeek2 = flagshipWeek1 + 7 * MS_PER_DAY;
    map.set(flagshipWeek2, flagshipWeek1);
  });
  return map;
}
function canonicalRankingWeek(dateMs, redirectMap){
  const naturalMonday = mondayOf(dateMs);
  const map = redirectMap || buildCanonicalWeekRedirectMap();
  return map.has(naturalMonday) ? map.get(naturalMonday) : naturalMonday;
}

function getRankingSnapshotDates(){
  const redirectMap = buildCanonicalWeekRedirectMap();
  const dates = new Set();
  state.tournaments.forEach(t => {
    if(matchesForTournament(t.id).length > 0) dates.add(canonicalRankingWeek(tournamentDateMs(t), redirectMap));
  });
  return Array.from(dates).sort((a,b) => a - b);
}

// Selectable ranking weeks (Mondays) for the Rankings page and seeding/entry
// pickers — one per tournament week that has results, PLUS any week
// explicitly marked as a bye week (rankings still "come out" that week —
// nothing new counts, but the rolling window still moves forward, and it's
// still a valid date to seed a future draw against).
function getRankingWeeks(){
  const redirectMap = buildCanonicalWeekRedirectMap();
  const weeks = new Set();
  state.tournaments.forEach(t => {
    if(matchesForTournament(t.id).length > 0) weeks.add(canonicalRankingWeek(tournamentDateMs(t), redirectMap));
  });
  (state.byeWeeks || []).forEach(bw => weeks.add(canonicalRankingWeek(byeWeekDateMs(bw), redirectMap)));
  weeks.add(canonicalRankingWeek(getLatestActiveDate(), redirectMap));
  return Array.from(weeks).sort((a,b) => b - a);
}


function ranksFromTotals(totals, excludeRetiredAsOf){
  const rows = state.players
    .filter(p => excludeRetiredAsOf === undefined || !isPlayerRetiredAsOf(p, excludeRetiredAsOf))
    .map(p => ({id: p.id, points: (totals.get(p.id) || {points:0}).points}))
    .filter(r => r.points > 0)
    .sort((a,b) => b.points - a.points);
  const map = {};
  rows.forEach((r, i) => { map[r.id] = i + 1; });
  return map;
}

function getSeasons(){
  const years = new Set(state.tournaments.map(t => t.year));
  return Array.from(years).sort((a,b) => b - a);
}

/* ---------------- DOM helpers ---------------- */
function $(sel, root){ return (root||document).querySelector(sel); }
function $all(sel, root){ return Array.from((root||document).querySelectorAll(sel)); }
function el(tag, attrs, children){
  const node = document.createElement(tag);
  if(attrs) Object.keys(attrs).forEach(k => {
    if(k === "class") node.className = attrs[k];
    else if(k === "html") node.innerHTML = attrs[k];
    else node.setAttribute(k, attrs[k]);
  });
  (children||[]).forEach(c => { if(c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
  return node;
}
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
// Strips accents/diacritics so "Safarova" matches "Šafářová".
function normalizeSearch(str){
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
function matchesSearch(name, query){
  if(!query || !query.trim()) return true;
  return normalizeSearch(name).includes(normalizeSearch(query));
}

/* ---------------- Scoreboard rendering ---------------- */
function renderScoreboardHTML(match){
  if(match.walkover){
    return '<div class="scoreboard walkover">W/O</div>';
  }
  const winnerIsA = match.winnerId === match.playerAId;
  const sets = match.sets || [];
  if(sets.length === 0) return '<div class="scoreboard walkover">—</div>';
  const cells = sets.map(s => {
    const top = winnerIsA ? s.a : s.b;
    const bottom = winnerIsA ? s.b : s.a;
    const tb = s.tb ? '<span class="sb-tb">' + escapeHtml(s.tb) + '</span>' : '';
    return '<div class="sb-set">' +
      '<span class="sb-num won">' + escapeHtml(top) + '</span>' +
      '<span class="sb-num">' + escapeHtml(bottom) + '</span>' +
      tb +
      '</div>';
  }).join("");
  return '<div class="scoreboard">' + cells + '</div>';
}

// Per-player inline score, attached directly to that player's own row in the
// bracket (rather than a shared winner-on-top chip) so the score always sits
// next to the name it belongs to, regardless of which slot they're drawn in.
function slotScoreHTML(match, playerId){
  if(!match) return "";
  if(match.walkover){
    return playerId === match.winnerId ? "" : '<span class="score-inline wo-tag">W/O</span>';
  }
  const sets = match.sets || [];
  if(sets.length === 0) return "";
  const cells = sets.map(s => {
    const mine = match.playerAId === playerId ? s.a : s.b;
    const opp = match.playerAId === playerId ? s.b : s.a;
    const tb = s.tb && mine < opp ? '<sup class="sb-tb-inline">' + escapeHtml(s.tb) + '</sup>' : "";
    return '<span class="set-num' + (mine > opp ? ' won' : '') + '">' + escapeHtml(mine) + tb + '</span>';
  }).join("");
  return '<span class="score-inline">' + cells + '</span>';
}

/* ---------------- Rankings view ---------------- */
function populateRankingsYearSelect(){
  const sel = $("#rankings-year");
  const current = sel.value;
  const seasons = getSeasons();
  const weeks = getRankingWeeks();
  const weekOptions = weeks.map((w,i) => '<option value="week:' + w + '">Week of ' + formatWeekDate(w) + (i===0 ? " (latest)" : "") + '</option>').join("");
  sel.innerHTML =
    '<option value="current">Current (Rolling 52-Week)</option>' +
    '<option value="all">All-time</option>' +
    (weeks.length ? '<optgroup label="By Week">' + weekOptions + '</optgroup>' : "") +
    (seasons.length ? '<optgroup label="By Season">' + seasons.map(y => '<option value="year:' + y + '">' + y + ' Season</option>').join("") + '</optgroup>' : "");
  const validWeek = current && current.startsWith("week:") && weeks.includes(Number(current.slice(5)));
  const validYear = current && current.startsWith("year:") && seasons.includes(Number(current.slice(5)));
  if(current === "current" || current === "all" || validWeek || validYear){
    sel.value = current;
  } else {
    sel.value = "current";
  }
}

// Which of a player's counted-window results actually count under the
// best-18-plus-mandatory rule, kept per-tournament so we can show a real
// breakdown (not just the final total).
function computePlayerResultBreakdown(playerId, asOfMs){
  const windowStart = asOfMs - 364 * MS_PER_DAY;
  const entries = [];
  state.tournaments.forEach(t => {
    const d = tournamentDateMs(t);
    // Exclusive lower bound — a result exactly 364 days old is one week
    // past the 52-week cutoff and should already be gone (see the matching
    // comment in computeRankingsAsOf for why this has to be <=, not <).
    if(d > asOfMs || d <= windowStart) return;

    if(t.level === "FINALS"){
      // WATP Finals is pure bonus (see computeRankingsAsOf) — shown here for
      // visibility only, always counted, and deliberately never enters the
      // mandatory/optional slot competition below.
      const mainRes = computeTournamentResults(t.id).get(playerId);
      const bonusPts = computeFinalsBonusPoints(t).get(playerId) || 0;
      if(!mainRes && bonusPts === 0) return;
      entries.push({
        tournamentId: t.id, tournamentName: t.name, level: t.level, date: d,
        code: mainRes ? mainRes.code : "RR", label: mainRes ? mainRes.label : "Round Robin",
        points: bonusPts, mandatory: false, isQualifying: false,
        hadQualifyingBonus: false, isFinalsBonus: true, counted: true
      });
      return;
    }

    const mandatory = MANDATORY_LEVELS.has(t.level);
    const mainRes = computeTournamentResults(t.id).get(playerId);
    const qRes = (t.qualifying && t.qualifying.enabled) ? computeQualifyingResults(t).get(playerId) : null;
    if(!mainRes && !qRes) return;

    let points = 0, code, label, isQualifying = false;
    if(mainRes){
      points += pointsForResult(t.level, t.drawSize, mainRes.code);
      code = mainRes.code; label = mainRes.label;
    }
    if(qRes){
      points += qualifyingPointsForResult(t.level, t.drawSize, qRes.code);
      if(!mainRes){ code = qRes.code; label = qRes.label; isQualifying = true; }
    }
    // A qualifying-only entry worth nothing shouldn't waste a slot — same rule as the ranking calc.
    if(!mainRes && points === 0) return;

    entries.push({
      tournamentId: t.id, tournamentName: t.name, level: t.level, date: d,
      code, label, points, mandatory, isQualifying,
      hadQualifyingBonus: !!mainRes && !!qRes, isFinalsBonus: false
    });
  });
  entries.sort((a,b) => a.date - b.date);

  const cappableEntries = entries.filter(e => !e.isFinalsBonus);
  const mandatoryEntries = cappableEntries.filter(e => e.mandatory);
  const optionalEntries = cappableEntries.filter(e => !e.mandatory);
  const optionalSortedDesc = optionalEntries.slice().sort((a,b) => b.points - a.points);
  const remainingSlots = Math.max(0, MAX_COUNTED_RESULTS - mandatoryEntries.length);
  const countedOptional = new Set(optionalSortedDesc.slice(0, remainingSlots));
  cappableEntries.forEach(e => { e.counted = e.mandatory || countedOptional.has(e); });

  const totalPoints = entries.filter(e => e.counted).reduce((s, e) => s + e.points, 0);
  return {entries, totalPoints, tournamentsPlayed: entries.length};
}

// "Palmwood Open" -> "PO", "Wimbledon" -> "WIM" — short column headers,
// same spirit as AO/FO/W/USO on a real ranking breakdown table.
function abbreviateTournamentName(name){
  const words = name.trim().split(/\s+/).filter(Boolean);
  if(words.length >= 2) return words.map(w => w[0]).join("").toUpperCase().slice(0, 4);
  return (words[0] || "").slice(0, 3).toUpperCase();
}

function resultColorClass(entry){
  if(entry.isFinalsBonus) return "res-finals";
  if(entry.isQualifying) return "res-qual";
  if(entry.code === "W") return "res-win";
  if(entry.code === "F") return "res-final";
  if(entry.code === "SF") return "res-semi";
  if(entry.code === "QF") return "res-quarter";
  return "res-early";
}

function renderBreakdownTableHTML(playerId, asOfMs){
  const {entries, totalPoints} = computePlayerResultBreakdown(playerId, asOfMs);
  if(entries.length === 0){
    return '<p class="picker-empty-note">No results in this window yet.</p>';
  }
  const levels = ["GRAND_SLAM", "OLYMPICS", "WTA1000", "WTA500", "WTA250", "CHALLENGER125", "CHALLENGER100", "FINALS"];
  const byLevel = {};
  levels.forEach(l => { byLevel[l] = entries.filter(e => e.level === l); });

  let headTop = "", headSub = "";
  levels.forEach(l => {
    const list = byLevel[l];
    if(list.length === 0) return;
    headTop += '<th colspan="' + list.length + '" class="breakdown-group-head">' + LEVEL_LABELS[l] + '</th>';
    list.forEach(e => {
      headSub += '<th title="' + escapeHtml(e.tournamentName) + '">' + escapeHtml(abbreviateTournamentName(e.tournamentName)) + '</th>';
    });
  });

  let bodyCells = "";
  levels.forEach(l => {
    byLevel[l].forEach(e => {
      const roundLabel = e.code === "W" ? "W" : e.code;
      const cls = "breakdown-cell " + resultColorClass(e) + (e.counted ? "" : " not-counted");
      const qTag = e.hadQualifyingBonus ? '<span class="breakdown-qtag" title="Includes a qualifying bonus">+Q</span>' : "";
      // Unit separator, not a plain "|" — a user-typed tournament name could
      // theoretically contain a pipe character and silently misalign the
      // split on the JS side; a control character never will.
      const tooltipText = e.tournamentName + "\u001F" + (e.code === "W" ? "Champion" : "Lost " + (ROUND_LABELS[e.code] || e.code)) +
        "\u001F" + e.points + " pts" + "\u001F" + (e.counted ? "Counts toward ranking" : "Didn't count \u2014 outside the best " + MAX_COUNTED_RESULTS);
      bodyCells += '<td class="' + cls + '" data-breakdown-tip="' + escapeHtml(tooltipText) + '" data-open-bracket="' + e.tournamentId + '">' + escapeHtml(roundLabel) + qTag + '<span class="breakdown-pts">' + e.points + '</span></td>';
    });
  });

  return '<div class="breakdown-scroll"><table class="breakdown-table"><thead>' +
    '<tr>' + headTop + '<th rowspan="2">Total</th><th rowspan="2">Tours</th></tr>' +
    '<tr>' + headSub + '</tr>' +
    '</thead><tbody><tr>' + bodyCells +
    '<td class="breakdown-total">' + totalPoints.toLocaleString() + '</td>' +
    '<td class="breakdown-total">' + entries.length + '</td>' +
    '</tr></tbody></table></div>';
}

let expandedRankingRow = null;
let rankingsMode = "live"; // "live" | "official"

function renderRankings(){
  populateRankingsYearSelect();
  const val = $("#rankings-year").value || "current";

  let totals, movement = null;
  const isRolling = val === "current" || val.startsWith("week:");
  let effectiveAsOf = null;
  if(isRolling){
    const nominalAsOf = val === "current" ? mondayOf(getLatestActiveDate()) : Number(val.slice(5));
    // Official rankings publish a week behind: a tournament played the week
    // of the 4th doesn't count until the 11th's rankings, so official mode
    // just evaluates everything one week earlier than the selected week.
    effectiveAsOf = rankingsMode === "official" ? nominalAsOf - 7 * MS_PER_DAY : nominalAsOf;
    totals = computeRankingsAsOf(effectiveAsOf);
    const prevAsOf = effectiveAsOf - 7 * MS_PER_DAY;
    const prevTotals = computeRankingsAsOf(prevAsOf);
    // Both weeks' rank numbering must exclude the same retired players the
    // current week's table excludes — otherwise a retired player sitting
    // above someone in last week's (unfiltered) numbers but absent from
    // this week's (filtered) numbers creates a phantom rank shift for
    // everyone below them, even though nothing about their results changed.
    movement = {cur: ranksFromTotals(totals, effectiveAsOf), prev: ranksFromTotals(prevTotals, prevAsOf)};
  } else if(val === "all"){
    totals = computeRankings(null);
  } else if(val.startsWith("year:")){
    totals = computeRankings(Number(val.slice(5)));
  } else {
    totals = computeRankings(null);
  }

  $all("[data-rankings-mode]").forEach(btn => btn.classList.toggle("active", btn.dataset.rankingsMode === rankingsMode));
  $("#rankings-mode-toggle").classList.toggle("hidden", !isRolling);

  $("#rankings-rule-note").textContent = isRolling
    ? (rankingsMode === "official"
        ? "Official rankings run a week behind — a tournament only counts once next Monday's rankings publish. Only a player's best " + MAX_COUNTED_RESULTS + " results count, except Grand Slam and WATP 1000 results, which always count if played."
        : "Live — reflects results as soon as they're entered, including tournaments still in progress this week. Only a player's best " + MAX_COUNTED_RESULTS + " results count, except Grand Slam and WATP 1000 results, which always count if played.")
    : "";

  const rows = state.players
    .filter(p => isRolling ? !isPlayerRetiredAsOf(p, effectiveAsOf) : true)
    .map(p => ({p, stats: totals.get(p.id) || {points:0, titles:0}}))
    .filter(r => r.stats.points > 0)
    .sort((a,b) => b.stats.points - a.stats.points || a.p.name.localeCompare(b.p.name))
    .map((r, i) => ({...r, rank: i + 1}));

  const body = $("#rankings-body");
  const table = $("#rankings-table");
  const empty = $("#rankings-empty");
  const searchEmpty = $("#rankings-search-empty");

  if(rows.length === 0){
    table.classList.add("hidden");
    searchEmpty.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  const query = $("#rankings-search").value;
  const displayRows = query.trim() ? rows.filter(r => matchesSearch(r.p.name, query)) : rows;

  if(displayRows.length === 0){
    table.classList.add("hidden");
    searchEmpty.classList.remove("hidden");
    return;
  }
  table.classList.remove("hidden");
  searchEmpty.classList.add("hidden");

  body.innerHTML = displayRows.map((r) => {
    const rank = r.rank;
    const rankClass = rank <= 3 ? "rank-num top3" : "rank-num";
    let moveCell = "<td></td>";
    if(movement){
      const prevRank = movement.prev[r.p.id];
      let moveHTML;
      if(prevRank === undefined){
        moveHTML = '<span class="rank-move new">NEW</span>';
      } else if(prevRank === rank){
        moveHTML = '<span class="rank-move flat">–</span>';
      } else if(prevRank > rank){
        moveHTML = '<span class="rank-move up">&#9650;' + (prevRank - rank) + '</span>';
      } else {
        moveHTML = '<span class="rank-move down">&#9660;' + (rank - prevRank) + '</span>';
      }
      moveCell = '<td>' + moveHTML + '</td>';
    }
    const isExpanded = isRolling && expandedRankingRow === r.p.id;
    const toggleBtn = isRolling
      ? '<button class="rank-toggle' + (isExpanded ? ' open' : '') + '" data-toggle-breakdown="' + r.p.id + '" title="Show results breakdown">&#9656;</button>'
      : "";
    let breakdownRow = "";
    if(isExpanded){
      breakdownRow = '<tr class="breakdown-row"><td colspan="6">' + renderBreakdownTableHTML(r.p.id, effectiveAsOf) + '</td></tr>';
    }
    return '<tr' + (isRolling ? ' class="rank-row-clickable" data-toggle-breakdown="' + r.p.id + '"' : '') + '>' +
      '<td class="rank-col">' + toggleBtn + '<span class="' + rankClass + '">' + rank + '</span></td>' +
      moveCell +
      '<td><button class="player-link" data-open-player="' + r.p.id + '">' + flagImgHTML(r.p.country) + escapeHtml(r.p.name) + '</button></td>' +
      '<td class="country-chip">' + (r.p.country ? escapeHtml(r.p.country.toUpperCase()) : "—") + '</td>' +
      '<td>' + r.stats.titles + '</td>' +
      '<td class="points-cell">' + r.stats.points.toLocaleString() + '</td>' +
      '</tr>' + breakdownRow;
  }).join("");
}

/* ---------------- Players view ---------------- */
function refreshAfterRetireChange(playerId){
  // If the profile popup for this player is open, refresh it in place so
  // the Retire/Unretire button immediately reflects the new state.
  if(!$("#player-modal-backdrop").classList.contains("hidden")){
    renderPlayerProfile(playerId);
  }
  renderPlayers();
  renderRankings();
}

function handleToggleRetire(playerId){
  const p = playerById(playerId);
  if(!p) return;
  if(p.retired){
    // Unretiring needs no date — just clear it.
    p.retired = false;
    p.retiredDate = null;
    saveState();
    refreshAfterRetireChange(playerId);
    return;
  }
  openRetirePlayerModal(playerId);
}

function openRetirePlayerModal(playerId){
  const p = playerById(playerId);
  if(!p) return;
  $("#rp-player-id").value = playerId;
  $("#rp-player-name").textContent = p.name;
  const defaultDate = new Date(getLatestActiveDate());
  $("#rp-date").value = defaultDate.toISOString().slice(0, 10);
  $("#retire-player-backdrop").classList.remove("hidden");
}
function closeRetirePlayerModal(){
  $("#retire-player-backdrop").classList.add("hidden");
  $("#retire-player-form").reset();
}
function handleRetirePlayerForm(ev){
  ev.preventDefault();
  const playerId = $("#rp-player-id").value;
  const p = playerById(playerId);
  const date = $("#rp-date").value;
  if(!p || !date) return;
  p.retired = true;
  p.retiredDate = date;
  saveState();
  closeRetirePlayerModal();
  refreshAfterRetireChange(playerId);
}

// A player only counts as retired for a given ranking date if their
// retirement date is on or before it — this is what keeps every week's
// rankings from before they retired historically accurate.
function isPlayerRetiredAsOf(p, asOfMs){
  if(!p.retired) return false;
  if(!p.retiredDate) return true;
  const retiredMs = new Date(p.retiredDate + "T00:00:00").getTime();
  return retiredMs <= asOfMs;
}

function renderPlayers(){
  const grid = $("#players-grid");
  const empty = $("#players-empty");
  const activePlayers = state.players.filter(p => !p.retired);
  if(state.players.length === 0){
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    renderRetiredPlayers();
    return;
  }
  empty.classList.add("hidden");
  const totals = computeRankingsAsOf(getLatestActiveDate());
  const sorted = [...activePlayers].sort((a,b) => a.name.localeCompare(b.name));
  grid.innerHTML = "";
  sorted.forEach(p => {
    const stats = totals.get(p.id) || {points:0, titles:0};
    const card = el("div", {class:"player-card", "data-open-player": p.id}, [
      el("div", {class:"pc-name", html: playerNameHTML(p)}),
      el("div", {class:"pc-meta"}, [
        el("span", {}, [(p.country ? p.country.toUpperCase() : "—")]),
        el("span", {}, [stats.points.toLocaleString() + " pts"])
      ]),
      el("button", {class:"btn btn-small btn-ghost pc-edit-btn", "data-edit-player": p.id}, ["Edit"])
    ]);
    grid.appendChild(card);
  });
  renderRetiredPlayers();
}

function renderRetiredPlayers(){
  const section = $("#retired-section");
  const grid = $("#retired-players-grid");
  const retired = state.players.filter(p => p.retired);
  if(retired.length === 0){
    section.classList.add("hidden");
    grid.innerHTML = "";
    return;
  }
  section.classList.remove("hidden");
  const careerTotals = computeRankings(null);
  const peakRanks = computeAllPlayersPeakRanks();
  const sorted = retired.slice().sort((a,b) => a.name.localeCompare(b.name));
  grid.innerHTML = "";
  sorted.forEach(p => {
    const peak = peakRanks.get(p.id) || null;
    const titles = (careerTotals.get(p.id) || {titles:0}).titles;
    const card = el("div", {class:"player-card retired-card", "data-open-player": p.id}, [
      el("div", {class:"pc-name", html: playerNameHTML(p)}),
      el("div", {class:"pc-badges"}, [
        el("span", {class:"pc-badge"}, [peak ? "Peak No. " + peak : "Unranked"]),
        el("span", {class:"pc-badge"}, [titles + " title" + (titles === 1 ? "" : "s")])
      ]),
      el("button", {class:"btn btn-small btn-primary pc-unretire-btn", "data-toggle-retire": p.id}, ["Unretire"])
    ]);
    grid.appendChild(card);
  });
}

// Every tournament this player reached the final of (won or lost), with the
// opponent from that specific final match — a quick "career highlights" list.
function getFinalResultsForPlayer(playerId){
  const results = [];
  state.tournaments.forEach(t => {
    // Challenger events aren't tour-level — they get their own dedicated
    // section on the profile instead of mixing into tour Final Results.
    if(CHALLENGER_LEVELS.has(t.level)) return;
    const tRes = computeTournamentResults(t.id).get(playerId);
    if(!tRes || (tRes.code !== "W" && tRes.code !== "F")) return;
    const finalMatch = state.matches.find(m =>
      m.tournamentId === t.id && (m.bracket || "main") === "main" && m.round === "F" &&
      (m.playerAId === playerId || m.playerBId === playerId)
    );
    if(!finalMatch) return;
    const opponentId = finalMatch.playerAId === playerId ? finalMatch.playerBId : finalMatch.playerAId;
    results.push({t, isChamp: tRes.code === "W", opponent: playerById(opponentId), match: finalMatch});
  });
  results.sort((a,b) => tournamentDateMs(b.t) - tournamentDateMs(a.t));
  return results;
}

// Same shape, scoped specifically to Challenger-level finals — shown in
// their own section on the profile, and only when it's actually non-empty.
function getChallengerFinalsForPlayer(playerId){
  const results = [];
  state.tournaments.forEach(t => {
    if(!CHALLENGER_LEVELS.has(t.level)) return;
    const tRes = computeTournamentResults(t.id).get(playerId);
    if(!tRes || (tRes.code !== "W" && tRes.code !== "F")) return;
    const finalMatch = state.matches.find(m =>
      m.tournamentId === t.id && (m.bracket || "main") === "main" && m.round === "F" &&
      (m.playerAId === playerId || m.playerBId === playerId)
    );
    if(!finalMatch) return;
    const opponentId = finalMatch.playerAId === playerId ? finalMatch.playerBId : finalMatch.playerAId;
    results.push({t, isChamp: tRes.code === "W", opponent: playerById(opponentId), match: finalMatch});
  });
  results.sort((a,b) => tournamentDateMs(b.t) - tournamentDateMs(a.t));
  return results;
}

/* ---------------- Finals History sortable table ---------------- */
const FINALS_HISTORY_COLUMNS = [
  ["result", "Result"], ["wl", "W\u2013L"], ["date", "Date"], ["tournament", "Tournament"],
  ["tier", "Tier"], ["surface", "Surface"], ["opponent", "Opponent"], ["score", "Score"]
];
let finalsHistorySort = {col:"date", dir:"desc"};
let finalsHistorySortPlayerId = null;

function finalsHistoryTableHTML(playerId){
  // Tally is always computed chronologically (oldest first) regardless of
  // how the table is currently sorted for display — it represents their
  // finals record AT that point in their career, not a display artifact.
  const chronological = getFinalResultsForPlayer(playerId).slice().sort((a,b) => tournamentDateMs(a.t) - tournamentDateMs(b.t));
  let w = 0, l = 0;
  const rows = chronological.map(r => {
    if(r.isChamp) w++; else l++;
    return {...r, wlLabel: w + "\u2013" + l, wlSortVal: w};
  });
  if(rows.length === 0) return null;

  const sortValue = (row, col) => {
    switch(col){
      case "result": return row.isChamp ? 1 : 0;
      case "wl": return row.wlSortVal;
      case "date": return tournamentDateMs(row.t);
      case "tournament": return row.t.name.toLowerCase();
      case "tier": return row.t.level;
      case "surface": return row.t.surface;
      case "opponent": return row.opponent ? row.opponent.name.toLowerCase() : "";
      default: return 0;
    }
  };

  const sorted = rows.slice().sort((a,b) => {
    const av = sortValue(a, finalsHistorySort.col), bv = sortValue(b, finalsHistorySort.col);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return finalsHistorySort.dir === "asc" ? cmp : -cmp;
  });

  let html = '<table class="data-table finals-history-table"><thead><tr>';
  FINALS_HISTORY_COLUMNS.forEach(([key, label]) => {
    const sortable = key !== "score";
    const isActive = finalsHistorySort.col === key;
    const arrow = isActive ? (finalsHistorySort.dir === "asc" ? " \u25b2" : " \u25bc") : (sortable ? ' <span class="sort-hint">\u21c5</span>' : "");
    html += '<th' + (sortable ? ' class="sortable-th" data-sort-col="' + key + '"' : '') + '>' + label + arrow + '</th>';
  });
  html += '</tr></thead><tbody>';

  sorted.forEach(row => {
    const {t, isChamp, opponent, match, wlLabel} = row;
    html += '<tr class="' + (isChamp ? "fh-row-win" : "fh-row-loss") + '">' +
      '<td><b>' + (isChamp ? "Win" : "Loss") + '</b></td>' +
      '<td>' + wlLabel + '</td>' +
      '<td>' + formatWeekDate(tournamentDateMs(t)) + '</td>' +
      '<td><button class="tourney-name-link" data-open-tourney-history="' + escapeHtml(t.name) + '">' + escapeHtml(t.name) + '</button>' + (t.location ? ", " + escapeHtml(t.location) : "") + '</td>' +
      '<td><span class="level-tag ' + (LEVEL_TAG_CLASSES[t.level] || "") + '">' + escapeHtml(LEVEL_LABELS[t.level] || t.level) + '</span></td>' +
      '<td><span class="surface-tag surface-' + t.surface + '">' + t.surface + '</span></td>' +
      '<td>' + (opponent ? playerLinkHTML(opponent) : "(unknown)") + '</td>' +
      '<td>' + renderScoreboardHTML(match) + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

// Every win over a Top 10 opponent — using the opponent's OFFICIAL ranking
// for the week that specific tournament was played, not their ranking
// today. Beating a since-retired former No. 3 still counts; beating
// someone who's since climbed into the Top 10 (but wasn't yet, that week)
// does not — same "was it true at the time" logic as the rank-history
// chart and peak rank elsewhere on this profile.
function getTop10WinsForPlayer(playerId){
  const wins = [];
  matchesForPlayer(playerId).forEach(m => {
    if(!isTourLevelMatch(m)) return;
    if(m.winnerId !== playerId) return;
    const opponentId = m.playerAId === playerId ? m.playerBId : m.playerAId;
    const t = tournamentById(m.tournamentId);
    if(!t) return;
    const weekMonday = mondayOf(tournamentDateMs(t));
    const rankMap = officialRanksAsOf(weekMonday);
    const opponentRank = rankMap[opponentId];
    if(!opponentRank || opponentRank > 10) return;
    const ownRankAtTime = rankMap[playerId] || null;
    wins.push({t, match: m, opponent: playerById(opponentId), opponentRank, ownRankAtTime});
  });
  wins.sort((a,b) => tournamentDateMs(b.t) - tournamentDateMs(a.t));
  return wins;
}

// Same "was it true at the time" rule as getTop10WinsForPlayer, but tallied
// for every player in one pass over the match list — one shared cache hit
// per tournament week (via computeRankingsAsOf's cache) instead of
// recomputing it once per player.
function computeTop10WinsCounts(){
  const counts = new Map();
  state.players.forEach(p => counts.set(p.id, 0));
  state.matches.forEach(m => {
    if(!isTourLevelMatch(m)) return;
    const winnerId = m.winnerId;
    if(!winnerId || !counts.has(winnerId)) return;
    const opponentId = m.playerAId === winnerId ? m.playerBId : m.playerAId;
    const t = tournamentById(m.tournamentId);
    if(!t) return;
    const weekMonday = mondayOf(tournamentDateMs(t));
    const rankMap = officialRanksAsOf(weekMonday);
    const opponentRank = rankMap[opponentId];
    if(opponentRank && opponentRank <= 10){
      counts.set(winnerId, counts.get(winnerId) + 1);
    }
  });
  return counts;
}

function gsCellClass(code){
  if(code === "W") return "gs-cell-w";
  if(code === "F") return "gs-cell-f";
  if(code === "SF") return "gs-cell-sf";
  if(code === "QF") return "gs-cell-qf";
  if(code && code !== "A") return "gs-cell-r"; // R128, R64, R32, R16
  return "gs-cell-a";
}

// Year-by-year Grand Slam grid for a player's profile, styled after the
// classic tour-site format: one row per major, one column per year, colored
// by round reached, with per-major and per-year win-loss summaries.
function computePlayerGrandSlamGrid(playerId){
  const slamTournaments = state.tournaments.filter(t => t.level === "GRAND_SLAM");
  const p = playerById(playerId);
  const manualEntries = (p && p.manualSlamResults) || [];
  if(slamTournaments.length === 0 && manualEntries.length === 0) return null;

  // Only show years within this player's own active career span — not
  // every year any Grand Slam has ever existed in the system, which could
  // stretch back well before this player even joined the tour. Manually
  // added pre-tracking years extend this range too, for players who were
  // already active before this tour started keeping records.
  const playerActiveYears = matchesForPlayer(playerId)
    .map(m => tournamentById(m.tournamentId))
    .filter(Boolean)
    .map(t => t.year);
  const manualYears = manualEntries.map(e => e.year);
  const allActiveYears = [...playerActiveYears, ...manualYears];
  if(allActiveYears.length === 0) return null;
  const careerStart = Math.min(...allActiveYears);
  const careerEnd = Math.max(...allActiveYears);

  const majorNames = sortMajorNamesByCalendarOrder(Array.from(new Set([
    ...slamTournaments.map(t => t.name),
    ...manualEntries.map(e => e.majorName)
  ])));
  const years = Array.from(new Set([...slamTournaments.map(t => t.year), ...manualYears]))
    .filter(y => y >= careerStart && y <= careerEnd)
    .sort((a,b) => a - b);
  if(years.length === 0) return null;

  function tourRecordAt(t){
    let w = 0, l = 0;
    matchesForTournament(t.id).forEach(m => {
      if((m.bracket || "main") === "qual") return;
      if(m.playerAId !== playerId && m.playerBId !== playerId) return;
      if(m.winnerId === playerId) w++; else l++;
    });
    return {w, l};
  }

  // A manual entry only ever carries a "furthest round reached" code, never
  // real match-by-match data — but a Grand Slam is always a standard
  // 128-draw, so the round code alone is enough to infer a reasonable
  // win-loss: reaching the semifinal, for instance, necessarily means
  // winning every round before it (R128 through QF) and then losing that
  // one match.
  function manualRoundWL(code){
    if(code === "W") return {w: ROUND_ORDER.length, l: 0};
    const idx = ROUND_ORDER.indexOf(code);
    if(idx < 0) return {w: 0, l: 0};
    return {w: idx, l: 1};
  }

  const grid = majorNames.map(name => {
    const editions = years.map(year => slamTournaments.find(tt => tt.name === name && tt.year === year));
    const cells = editions.map((t, yi) => {
      if(t){
        const mainRes = computeTournamentResults(t.id).get(playerId);
        if(mainRes) return {code: mainRes.code, label: mainRes.code, cls: gsCellClass(mainRes.code), manual: false};
        const qRes = (t.qualifying && t.qualifying.enabled) ? computeQualifyingResults(t).get(playerId) : null;
        if(qRes){
          const qLabel = qRes.code === "QUALIFIED" ? "Q" : qRes.code;
          return {code: "A", label: qLabel, cls: "gs-cell-a", manual: false};
        }
        return {code: "A", label: "A", cls: "gs-cell-a", manual: false};
      }
      // No real tournament recorded for this major+year — fall back to a
      // manually-entered result, if one exists (this is the whole point of
      // manual entries: filling in years before this tour tracked results).
      const manual = manualEntries.find(e => e.majorName === name && e.year === years[yi]);
      if(manual){
        // Same convention real qualifying-only results already use: the
        // LABEL shows exactly what happened (a qualifying round, or a
        // simple "A"), but the underlying CODE that feeds titles/appearances
        // is always "A" — losing in qualifying isn't a main-draw appearance,
        // and neither is confirming they just didn't play that year. An
        // actual round-progression code still gets its normal round color.
        const isQualOrAbsent = manual.code === "A" || manual.code === "Q1" || manual.code === "Q2" || manual.code === "Q3";
        return {
          code: isQualOrAbsent ? "A" : manual.code,
          label: manual.code,
          cls: isQualOrAbsent ? "gs-cell-a" : gsCellClass(manual.code),
          manual: true
        };
      }
      return {code: null, label: "—", cls: "", manual: false};
    });

    let titles = 0, appearances = 0, w = 0, l = 0;
    editions.forEach((t, i) => {
      if(cells[i].code === "W") titles++;
      if(cells[i].code && cells[i].code !== "A") appearances++;
      if(t){
        const r = tourRecordAt(t);
        w += r.w; l += r.l;
      } else if(cells[i].manual){
        const r = manualRoundWL(cells[i].code);
        w += r.w; l += r.l;
      }
    });
    return {name, editions, cells, titles, appearances, wins: w, losses: l, winPct: (w + l) > 0 ? Math.round((w / (w + l)) * 100) : 0};
  });

  const yearTotals = years.map((year, yi) => {
    let w = 0, l = 0;
    grid.forEach(row => {
      const t = row.editions[yi];
      const cell = row.cells[yi];
      if(t){
        const r = tourRecordAt(t);
        w += r.w; l += r.l;
      } else if(cell.manual){
        const r = manualRoundWL(cell.code);
        w += r.w; l += r.l;
      }
    });
    return {w, l};
  });

  const totalTitles = grid.reduce((s, r) => s + r.titles, 0);
  const totalAppearances = grid.reduce((s, r) => s + r.appearances, 0);
  const totalWins = grid.reduce((s, r) => s + r.wins, 0);
  const totalLosses = grid.reduce((s, r) => s + r.losses, 0);
  const totalWinPct = (totalWins + totalLosses) > 0 ? Math.round((totalWins / (totalWins + totalLosses)) * 100) : 0;

  return {majorNames, years, grid, yearTotals, totalTitles, totalAppearances, totalWins, totalLosses, totalWinPct};
}

function grandSlamGridHTML(playerId){
  const data = computePlayerGrandSlamGrid(playerId);
  if(!data) return null;

  let html = '<div class="gs-grid-scroll"><table class="gs-grid-table"><thead><tr><th>Tournament</th>';
  data.years.forEach(y => { html += '<th>' + y + '</th>'; });
  html += '<th>SR</th><th>W&ndash;L</th><th>Win %</th></tr></thead><tbody>';

  data.grid.forEach(row => {
    html += '<tr><td class="gs-major-name">' + escapeHtml(row.name) + '</td>';
    row.cells.forEach(c => {
      html += '<td class="gs-cell ' + c.cls + (c.manual ? ' gs-cell-manual' : '') + '" title="' + (c.manual ? "Manually added — before this tour tracked results" : "") + '">' + escapeHtml(c.label) + '</td>';
    });
    html += '<td>' + row.titles + ' / ' + row.appearances + '</td>';
    html += '<td>' + row.wins + '&ndash;' + row.losses + '</td>';
    html += '<td>' + row.winPct + '%</td>';
    html += '</tr>';
  });

  html += '<tr class="gs-totals-row"><td>Win&ndash;loss</td>';
  data.yearTotals.forEach(yt => { html += '<td>' + yt.w + '&ndash;' + yt.l + '</td>'; });
  html += '<td>' + data.totalTitles + ' / ' + data.totalAppearances + '</td>';
  html += '<td>' + data.totalWins + '&ndash;' + data.totalLosses + '</td>';
  html += '<td>' + data.totalWinPct + '%</td>';
  html += '</tr>';

  html += '</tbody></table></div>';
  return html;
}

/* ---------------- Manual Grand Slam grid entries (pre-tracking years) ---------------- */
let editGsGridPlayerId = null;

let editGsGridYear = null;

function openEditGsGrid(playerId){
  editGsGridPlayerId = playerId;
  editGsGridYear = null;
  renderEditGsGridModal();
  $("#edit-gs-grid-backdrop").classList.remove("hidden");
}
function closeEditGsGrid(){
  const playerId = editGsGridPlayerId;
  editGsGridPlayerId = null;
  editGsGridYear = null;
  $("#edit-gs-grid-backdrop").classList.add("hidden");
  // Refresh whatever's behind it so the grid reflects any changes just made.
  if(playerId && !$("#player-modal-backdrop").classList.contains("hidden")){
    renderPlayerProfile(playerId);
  }
}
function renderEditGsGridModal(){
  const p = playerById(editGsGridPlayerId);
  if(!p) return;
  if(!Array.isArray(p.manualSlamResults)) p.manualSlamResults = [];
  const majorNames = knownMajorNamesForDatalist();

  const modal = $("#edit-gs-grid-modal");
  modal.innerHTML = "";
  modal.appendChild(el("h3", {}, ["Grand Slam History \u2014 " + p.name]));
  modal.appendChild(el("p", {class:"modal-help"}, [
    "Fill in results from before this tour started tracking data \u2014 useful for players who were already active in earlier years. Pick a year, set a result for whichever majors apply, and save the whole year at once. An actual tracked result always takes priority over a manual one for the same major and year."
  ]));

  // Which years already have at least one manual entry — quick jump back
  // into any of them without having to remember the number.
  const yearsWithEntries = Array.from(new Set(p.manualSlamResults.map(e => e.year))).sort((a,b) => b - a);
  if(yearsWithEntries.length){
    const jumpRow = el("div", {class:"gs-year-jump-row"});
    jumpRow.appendChild(el("span", {class:"gs-year-jump-label"}, ["Edited years:"]));
    yearsWithEntries.forEach(y => {
      jumpRow.appendChild(el("button", {type:"button", class:"gs-year-jump-btn" + (editGsGridYear === y ? " active" : ""), "data-gs-jump-year": String(y)}, [String(y)]));
    });
    modal.appendChild(jumpRow);
  }

  const yearRow = el("div", {class:"field-row", style:"align-items:flex-end;"});
  const yearField = el("label", {style:"flex:1; max-width:140px;"}, ["Year"]);
  const yearInput = el("input", {type:"number", id:"gs-entry-year", min:"1877", max:"2100"});
  if(editGsGridYear) yearInput.value = String(editGsGridYear);
  yearField.appendChild(yearInput);
  yearRow.appendChild(yearField);
  yearRow.appendChild(el("button", {type:"button", class:"btn btn-ghost", id:"gs-load-year"}, ["Load Year"]));
  modal.appendChild(yearRow);
  modal.appendChild(el("span", {class:"form-msg", id:"gs-entry-msg"}, []));

  if(editGsGridYear){
    const year = editGsGridYear;
    const table = el("table", {class:"data-table", style:"margin-top:12px;"});
    table.innerHTML = "<thead><tr><th>Major</th><th>Result</th></tr></thead>";
    const tbody = el("tbody");
    table.appendChild(tbody);

    majorNames.forEach(name => {
      const realTournament = state.tournaments.find(t => t.level === "GRAND_SLAM" && t.name === name && t.year === year);
      const existing = p.manualSlamResults.find(e => e.majorName === name && e.year === year);
      const row = el("tr");
      row.appendChild(el("td", {}, [name]));
      const cell = el("td");
      if(realTournament){
        const realRes = computeTournamentResults(realTournament.id).get(p.id);
        cell.appendChild(el("span", {class:"gs-year-real-note"}, [
          "Already tracked here" + (realRes ? " (" + realRes.code + ")" : "") + " \u2014 a manual entry would be ignored"
        ]));
      } else {
        const select = el("select", {"data-gs-year-major": name});
        select.appendChild(el("option", {value:""}, ["\u2014 No entry \u2014"]));
        ["A","Q1","Q2","Q3","R128","R64","R32","R16","QF","SF","F","W"].forEach(c => select.appendChild(el("option", {value:c}, [c === "A" ? "A (didn't play)" : c])));
        select.value = existing ? existing.code : "";
        cell.appendChild(select);
      }
      row.appendChild(cell);
      tbody.appendChild(row);
    });
    modal.appendChild(table);
    modal.appendChild(el("div", {class:"form-actions", style:"margin-top:12px;"}, [
      el("button", {type:"button", class:"btn btn-primary", id:"gs-save-year"}, ["Save " + year])
    ]));
  }

  modal.appendChild(el("div", {class:"modal-close-row"}, [
    el("span", {}),
    el("button", {class:"btn btn-ghost", id:"edit-gs-grid-close"}, ["Done"])
  ]));
}
function handleLoadGsYear(){
  const year = Number($("#gs-entry-year").value);
  const msg = $("#gs-entry-msg");
  if(!year){
    msg.className = "form-msg err";
    msg.textContent = "Enter a year first.";
    return;
  }
  editGsGridYear = year;
  renderEditGsGridModal();
}
function handleSaveGsYear(){
  const p = playerById(editGsGridPlayerId);
  if(!p || !editGsGridYear) return;
  const year = editGsGridYear;
  if(!Array.isArray(p.manualSlamResults)) p.manualSlamResults = [];

  $all("[data-gs-year-major]").forEach(select => {
    const major = select.dataset.gsYearMajor;
    const code = select.value;
    // Clear whatever was there for this major+year first, then re-add only
    // if a real code was actually chosen — this way picking "— No entry —"
    // on something that used to have a value correctly removes it.
    p.manualSlamResults = p.manualSlamResults.filter(e => !(e.majorName === major && e.year === year));
    if(code) p.manualSlamResults.push({id: uid("gsm"), majorName: major, year, code});
  });

  saveState();
  const msg = $("#gs-entry-msg");
  msg.className = "form-msg ok";
  msg.textContent = "Saved " + year + ".";
  renderEditGsGridModal();
}
function handleRemoveGsEntry(entryId){
  const p = playerById(editGsGridPlayerId);
  if(!p) return;
  p.manualSlamResults = (p.manualSlamResults || []).filter(e => e.id !== entryId);
  saveState();
  renderEditGsGridModal();
}

/* ---------------- Points system editor ---------------- */
const POINTS_CONFIG_ROUND_KEYS = ["W","F","SF","QF","R16","R32","R64","R128"];
const POINTS_CONFIG_QUAL_KEYS = ["Q","Q2","Q1"];

function openPointsConfigEditor(){
  ensurePointsConfig();
  renderPointsConfigEditor();
  $("#points-config-backdrop").classList.remove("hidden");
}
function closePointsConfigEditor(){
  $("#points-config-backdrop").classList.add("hidden");
}
function renderPointsConfigEditor(){
  ensurePointsConfig();
  const modal = $("#points-config-modal");
  modal.innerHTML = "";
  modal.appendChild(el("h3", {}, ["Points System"]));
  modal.appendChild(el("p", {class:"modal-help"}, [
    "How many ranking points each round is worth, by level and draw size. Leave the max draw blank for \"and up.\" Adding or removing a bracket takes effect immediately; number edits need Save Changes below. Nothing recalculates retroactively — past results keep whatever they earned at the time."
  ]));

  const wrap = el("div", {class:"calendar-scroll"});
  let html = '<table class="data-table points-config-table"><thead><tr>' +
    '<th>Level</th><th>Draw size</th>' +
    POINTS_CONFIG_ROUND_KEYS.map(k => '<th>' + k + '</th>').join("") +
    POINTS_CONFIG_QUAL_KEYS.map(k => '<th>' + k + '</th>').join("") +
    '<th></th></tr></thead><tbody>';

  Object.keys(LEVEL_LABELS).forEach(level => {
    if(level === "FINALS") return; // Finals uses its own round-robin bonus system, not this table
    const brackets = state.pointsConfig[level] || [];
    brackets.forEach((b, idx) => {
      html += '<tr data-pc-level="' + level + '" data-pc-idx="' + idx + '">';
      html += '<td>' + (idx === 0 ? escapeHtml(LEVEL_LABELS[level]) : '') + '</td>';
      html += '<td class="pc-draw-cell">' +
        '<input type="number" class="pc-input" data-pc-field="minDraw" value="' + b.minDraw + '" min="0">' +
        ' \u2013 ' +
        '<input type="number" class="pc-input" data-pc-field="maxDraw" value="' + (b.maxDraw >= 9999 ? '' : b.maxDraw) + '" placeholder="max" min="0">' +
        '</td>';
      POINTS_CONFIG_ROUND_KEYS.forEach(k => {
        html += '<td><input type="number" class="pc-input pc-input-narrow" data-pc-field="points.' + k + '" value="' + (b.points[k] !== undefined ? b.points[k] : "") + '" min="0"></td>';
      });
      POINTS_CONFIG_QUAL_KEYS.forEach(k => {
        html += '<td><input type="number" class="pc-input pc-input-narrow" data-pc-field="qual.' + k + '" value="' + (b.qual && b.qual[k] !== undefined ? b.qual[k] : "") + '" min="0"></td>';
      });
      html += '<td>' + (brackets.length > 1 ? '<button type="button" class="btn btn-small btn-ghost" data-pc-remove-bracket="' + level + ':' + idx + '">\u00d7</button>' : '') + '</td>';
      html += '</tr>';
    });
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
  modal.appendChild(wrap);

  const addRow = el("div", {class:"field-row", style:"margin-top:12px; align-items:flex-end;"});
  const addField = el("label", {}, ["Add a bracket to"]);
  const addSelect = el("select", {id:"pc-add-level"});
  Object.keys(LEVEL_LABELS).forEach(level => {
    if(level === "FINALS") return;
    addSelect.appendChild(el("option", {value:level}, [LEVEL_LABELS[level]]));
  });
  addField.appendChild(addSelect);
  addRow.appendChild(addField);
  addRow.appendChild(el("button", {type:"button", class:"btn btn-ghost", id:"pc-add-bracket"}, ["+ Add Draw-Size Bracket"]));
  modal.appendChild(addRow);
  modal.appendChild(el("span", {class:"form-msg", id:"pc-msg"}, []));

  modal.appendChild(el("div", {class:"modal-close-row"}, [
    el("button", {type:"button", class:"btn btn-ghost", id:"pc-reset-defaults"}, ["Reset to Defaults"]),
    el("div", {style:"display:flex; gap:8px;"}, [
      el("button", {type:"button", class:"btn btn-ghost", id:"points-config-close"}, ["Close"]),
      el("button", {type:"button", class:"btn btn-primary", id:"pc-save"}, ["Save Changes"])
    ])
  ]));
}
function handleAddPointsBracket(){
  const level = $("#pc-add-level").value;
  if(!state.pointsConfig[level]) state.pointsConfig[level] = [];
  state.pointsConfig[level].push({
    minDraw: 0, maxDraw: 9999,
    points: {W:0, F:0, SF:0, QF:0, R16:0, R32:0, R64:0, R128:0},
    qual: {Q:0, Q2:0, Q1:0}
  });
  renderPointsConfigEditor();
}
function handleRemovePointsBracket(level, idx){
  if(!state.pointsConfig[level] || state.pointsConfig[level].length <= 1) return;
  state.pointsConfig[level].splice(idx, 1);
  renderPointsConfigEditor();
}
function handleSavePointsConfig(){
  const newConfig = {};
  $all("#points-config-modal tr[data-pc-level]").forEach(row => {
    const level = row.dataset.pcLevel;
    if(!newConfig[level]) newConfig[level] = [];
    const bracket = {points:{}, qual:{}};
    row.querySelectorAll(".pc-input").forEach(input => {
      const field = input.dataset.pcField;
      if(field === "minDraw"){
        bracket.minDraw = input.value === "" ? 0 : Number(input.value);
      } else if(field === "maxDraw"){
        bracket.maxDraw = input.value === "" ? 9999 : Number(input.value);
      } else if(field.indexOf("points.") === 0){
        bracket.points[field.slice(7)] = input.value === "" ? 0 : Number(input.value);
      } else if(field.indexOf("qual.") === 0){
        bracket.qual[field.slice(5)] = input.value === "" ? 0 : Number(input.value);
      }
    });
    newConfig[level].push(bracket);
  });
  // Largest draw-size threshold first, so a tournament's actual draw size
  // matches the most specific (highest) bracket it qualifies for.
  Object.keys(newConfig).forEach(level => newConfig[level].sort((a,b) => b.minDraw - a.minDraw));
  state.pointsConfig = newConfig;
  saveState();
  renderRankings();
  const msg = $("#pc-msg");
  msg.className = "form-msg ok";
  msg.textContent = "Saved.";
}
function handleResetPointsConfigDefaults(){
  if(!confirm("Reset every level's points back to the built-in defaults? This discards any custom values you've entered.")) return;
  state.pointsConfig = JSON.parse(JSON.stringify(DEFAULT_POINTS_CONFIG));
  saveState();
  renderPointsConfigEditor();
  renderRankings();
}

// Best (lowest-numbered) rank a player has ever held, across every recorded
// tour week — used on the profile (a single lookup, so this is fine there).
function computePlayerPeakRank(playerId){
  let peak = null;
  getRankingSnapshotDates().forEach(d => {
    const rankMap = officialRanksAsOf(d);
    const r = rankMap[playerId];
    if(r && (peak === null || r < peak)) peak = r;
  });
  return peak;
}

// Same peak-rank logic, but for EVERY player in one pass — walks each
// snapshot date only once and updates everyone's running peak from that
// single ranking snapshot, instead of recomputing (and re-sorting the full
// player list for) every date once per player. The retired-players list
// calls this once for the whole grid rather than calling
// computePlayerPeakRank in a loop, which used to mean redoing that full
// sort dozens of times per retired player, for every date, on every single
// render — and got slower the more retired players there were.
function computeAllPlayersPeakRanks(){
  const peaks = new Map();
  getRankingSnapshotDates().forEach(d => {
    const rankMap = officialRanksAsOf(d);
    Object.keys(rankMap).forEach(pid => {
      const r = rankMap[pid];
      const current = peaks.get(pid);
      if(current === undefined || r < current) peaks.set(pid, r);
    });
  });
  return peaks;
}

let profileYearFilterPlayerId = null;
let profileYearFilter = "recent";
let profileRecordYearFilterPlayerId = null;
let profileRecordYearFilter = "career";
function renderPlayerProfile(playerId){
  const p = playerById(playerId);
  if(!p) return;
  // Opening a *different* player's page resets the year filter back to the
  // default — re-rendering the SAME player (retire toggle, changing the
  // year dropdown itself) keeps whatever's currently selected.
  if(profileYearFilterPlayerId !== playerId){
    profileYearFilter = "recent";
    profileYearFilterPlayerId = playerId;
  }
  if(profileRecordYearFilterPlayerId !== playerId){
    profileRecordYearFilter = "career";
    profileRecordYearFilterPlayerId = playerId;
  }
  if(finalsHistorySortPlayerId !== playerId){
    finalsHistorySort = {col:"date", dir:"desc"};
    finalsHistorySortPlayerId = playerId;
  }
  const matches = matchesForPlayer(playerId).sort((a,b) => {
    const ta = tournamentById(a.tournamentId), tb = tournamentById(b.tournamentId);
    return (tb ? tournamentDateMs(tb) : 0) - (ta ? tournamentDateMs(ta) : 0) || ROUND_ORDER.indexOf(b.round) - ROUND_ORDER.indexOf(a.round);
  });
  // Career Win-Loss and surface records are "tour level" stats — qualifying
  // and Challenger-level matches are excluded, same as how the real tour
  // reports it. Recent Matches below still shows everything, for history.
  const tourMatches = matches.filter(isTourLevelMatch);
  const wins = tourMatches.filter(m => m.winnerId === playerId).length;
  const losses = tourMatches.length - wins;
  const latest = getLatestActiveDate();
  const currentYear = getCurrentSeasonYear();
  const yearMatches = tourMatches.filter(m => {
    const t = tournamentById(m.tournamentId);
    return t && t.year === currentYear;
  });
  const yearWins = yearMatches.filter(m => m.winnerId === playerId).length;
  const yearLosses = yearMatches.length - yearWins;
  const totals = computeRankingsAsOf(latest);
  const careerStats = computeRankings(null).get(playerId) || {points:0, titles:0};
  const seasonStats = computeRankings(currentYear).get(playerId) || {points:0, titles:0};
  const currentRank = ranksFromTotals(totals, latest)[playerId] || null;

  // surface breakdown (also tour-level only, excludes qualifying) — both career and this season
  const surfaceStats = {hard:{w:0,l:0}, clay:{w:0,l:0}, grass:{w:0,l:0}};
  const seasonSurfaceStats = {hard:{w:0,l:0}, clay:{w:0,l:0}, grass:{w:0,l:0}};
  tourMatches.forEach(m => {
    const t = tournamentById(m.tournamentId);
    if(!t || !surfaceStats[t.surface]) return;
    if(m.winnerId === playerId) surfaceStats[t.surface].w++; else surfaceStats[t.surface].l++;
    if(t.year === currentYear){
      if(m.winnerId === playerId) seasonSurfaceStats[t.surface].w++; else seasonSurfaceStats[t.surface].l++;
    }
  });

  // rank history across every recorded tour "week"
  const snapshotDates = getRankingSnapshotDates();
  const history = [];
  snapshotDates.forEach(d => {
    const rankMap = officialRanksAsOf(d);
    if(rankMap[playerId]) history.push({date: d, rank: rankMap[playerId]});
  });
  const peakRank = history.length ? Math.min(...history.map(h => h.rank)) : null;

  // tournament results (bracket history)
  const tResults = state.tournaments
    .filter(t => matchesForTournament(t.id).some(m => m.playerAId === playerId || m.playerBId === playerId))
    .sort((a,b) => tournamentDateMs(b) - tournamentDateMs(a))
    .map(t => {
      const res = computeTournamentResults(t.id).get(playerId);
      return {t, res};
    });

  const modal = $("#player-modal");
  modal.innerHTML = "";
  const nameHistory = (p.history || []).filter(h => h.type === "name");
  const countryHistory = (p.history || []).filter(h => h.type === "country");
  const formerNames = nameHistory.map(h => h.from);
  modal.appendChild(el("div", {class:"profile-head"}, [
    el("div", {}, [
      el("div", {class:"profile-name", html: playerNameHTML(p)}),
      el("div", {class:"profile-meta"}, [
        (p.country ? p.country.toUpperCase() : "—") + " · " + (p.hand === "L" ? "Left-handed" : "Right-handed") +
        (formerNames.length ? " · formerly " + formerNames.map(escapeHtml).join(", ") : "")
      ])
    ]),
    el("button", {class:"btn btn-small btn-ghost", "data-edit-player": p.id}, ["Edit"])
  ]));

  const bioItems = [];
  if(currentRank) bioItems.push(["Current Rank", "No. " + currentRank]);
  if(peakRank) bioItems.push(["Peak Rank", "No. " + peakRank]);
  if(p.turnedPro) bioItems.push(["Turned Pro", String(p.turnedPro)]);
  if(p.height) bioItems.push(["Height", p.height + " cm"]);
  if(bioItems.length){
    modal.appendChild(el("div", {class:"bio-grid"}, bioItems.map(([label, value]) =>
      el("div", {class:"bio-item"}, [
        el("div", {class:"bio-label"}, [label]),
        el("div", {class:"bio-value"}, [value])
      ])
    )));
  }

  if(nameHistory.length || countryHistory.length){
    modal.appendChild(el("div", {class:"profile-section-title"}, ["Name & Country History"]));
    const combined = [...nameHistory, ...countryHistory].sort((a,b) => new Date(a.date) - new Date(b.date));
    combined.forEach(h => {
      const line = h.type === "name"
        ? "Name changed from " + escapeHtml(h.from) + " to " + escapeHtml(h.to)
        : "Country changed from " + (h.from ? flagImgHTML(h.from) + escapeHtml(h.from.toUpperCase()) : "—") + " to " + (h.to ? flagImgHTML(h.to) + escapeHtml(h.to.toUpperCase()) : "—");
      modal.appendChild(el("div", {class:"history-log-row", html:
        '<span class="history-log-date">' + formatWeekDate(new Date(h.date).getTime()) + '</span>' +
        '<span>' + line + '</span>'
      }));
    });
  }

  const statsBox = el("div", {class:"profile-stats"}, [
    el("div", {class:"stat-box"}, [el("div", {class:"stat-num"}, [String(seasonStats.points.toLocaleString())]), el("div", {class:"stat-label"}, [String(currentYear) + " Points"])]),
    el("div", {class:"stat-box"}, [el("div", {class:"stat-num"}, [String(seasonStats.titles)]), el("div", {class:"stat-label"}, [String(currentYear) + " Titles"])]),
    el("div", {class:"stat-box"}, [el("div", {class:"stat-num"}, [yearWins + "-" + yearLosses]), el("div", {class:"stat-label"}, [String(currentYear) + " Win-Loss"])])
  ]);
  modal.appendChild(statsBox);

  const surfaceRow = el("div", {class:"profile-stats"}, ["hard","clay","grass"].map(s =>
    el("div", {class:"stat-box"}, [
      el("div", {class:"stat-num"}, [seasonSurfaceStats[s].w + "-" + seasonSurfaceStats[s].l]),
      el("div", {class:"stat-label"}, [s])
    ])
  ));
  modal.appendChild(surfaceRow);

  const gsGrid = grandSlamGridHTML(playerId);
  const gsHeader = el("div", {class:"profile-section-title", style:"display:flex; justify-content:space-between; align-items:center;"});
  gsHeader.appendChild(document.createTextNode("Grand Slam History"));
  gsHeader.appendChild(el("button", {class:"btn btn-small btn-ghost", "data-edit-gs-grid": playerId}, ["Edit"]));
  modal.appendChild(gsHeader);
  if(gsGrid){
    modal.appendChild(el("div", {html: gsGrid}));
  } else {
    modal.appendChild(el("p", {}, ["No Grand Slam results yet — use Edit to add results from before this tour tracked data."]));
  }

  const tourneyYears = Array.from(new Set(tResults.map(r => r.t.year))).sort((a,b) => b - a);
  const tourneyHeader = el("div", {class:"profile-section-title", style:"display:flex; justify-content:space-between; align-items:center;"});
  tourneyHeader.appendChild(document.createTextNode("Tournament Results"));
  if(tourneyYears.length > 0){
    const yearSelect = el("select", {id:"profile-year-filter", style:"font-size:11px;"});
    yearSelect.appendChild(el("option", {value:"recent"}, ["Recent (10)"]));
    tourneyYears.forEach(y => yearSelect.appendChild(el("option", {value:String(y)}, [String(y)])));
    yearSelect.value = profileYearFilter;
    yearSelect.addEventListener("change", (e) => {
      profileYearFilter = e.target.value;
      renderPlayerProfile(playerId);
    });
    tourneyHeader.appendChild(yearSelect);
  }
  modal.appendChild(tourneyHeader);
  const tourneyRowsToShow = profileYearFilter === "recent"
    ? tResults.slice(0, 10)
    : tResults.filter(r => String(r.t.year) === profileYearFilter);
  if(tResults.length === 0){
    modal.appendChild(el("p", {}, ["No tournaments played yet."]));
  } else {
    tourneyRowsToShow.forEach(({t, res}) => {
      const bracketBtn = el("button", {class:"btn btn-small btn-ghost", "data-open-bracket": t.id}, ["Bracket"]);
      const row = el("div", {class:"tourney-row"}, [
        el("span", {class:"level-tag " + (LEVEL_TAG_CLASSES[t.level] || "")}, [LEVEL_LABELS[t.level] || t.level]),
        el("span", {class:"surface-tag surface-" + t.surface}, [t.surface]),
        el("span", {class:"tourney-name"}, [t.name + " '" + String(t.year).slice(-2)]),
        el("span", {class:"tourney-champ"}, [res ? res.label : "In progress"]),
        bracketBtn
      ]);
      modal.appendChild(row);
    });
  }

  modal.appendChild(el("div", {class:"profile-section-title"}, ["Recent Matches"]));
  if(matches.length === 0){
    modal.appendChild(el("p", {}, ["No matches recorded yet."]));
  } else {
    matches.slice(0, 8).forEach(m => {
      const t = tournamentById(m.tournamentId);
      const a = playerById(m.playerAId), b = playerById(m.playerBId);
      const row = el("div", {class:"match-row"}, [
        el("span", {class:"match-round"}, [ROUND_LABELS[m.round]]),
        el("span", {class:"match-players", html:
          (m.winnerId === a.id ? '<span class="winner">' + playerLinkHTML(a) + '</span>' : playerLinkHTML(a)) +
          ' def. ' +
          (m.winnerId === b.id ? '<span class="winner">' + playerLinkHTML(b) + '</span>' : playerLinkHTML(b))
        }),
        el("span", {html: renderScoreboardHTML(m)}),
        el("span", {class:"match-tourney"}, [t ? (t.name + " '" + String(t.year).slice(-2)) : ""])
      ]);
      modal.appendChild(row);
    });
  }

  const recordHeader = el("div", {class:"profile-section-title", style:"display:flex; justify-content:space-between; align-items:center;"});
  recordHeader.appendChild(document.createTextNode("Career Record"));
  if(tourneyYears.length > 0){
    const recordYearSelect = el("select", {id:"profile-record-year-filter", style:"font-size:11px;"});
    recordYearSelect.appendChild(el("option", {value:"career"}, ["Career"]));
    tourneyYears.forEach(y => recordYearSelect.appendChild(el("option", {value:String(y)}, [String(y)])));
    recordYearSelect.value = profileRecordYearFilter;
    recordYearSelect.addEventListener("change", (e) => {
      profileRecordYearFilter = e.target.value;
      renderPlayerProfile(playerId);
    });
    recordHeader.appendChild(recordYearSelect);
  }
  modal.appendChild(recordHeader);

  // "Career" shows the same totals as always; picking a specific year
  // re-derives points/titles from computeRankings and win-loss/surface
  // straight from that year's own tour-level matches, the same way the
  // "current season" stat boxes above already do for currentYear alone —
  // just generalized to whatever year the person actually picks.
  let displayedStats, displayedWins, displayedLosses, displayedSurfaceStats, recordLabel;
  if(profileRecordYearFilter === "career"){
    displayedStats = careerStats;
    displayedWins = wins;
    displayedLosses = losses;
    displayedSurfaceStats = surfaceStats;
    recordLabel = "Career";
  } else {
    const selectedYear = Number(profileRecordYearFilter);
    displayedStats = computeRankings(selectedYear).get(playerId) || {points:0, titles:0};
    const selectedYearMatches = tourMatches.filter(m => {
      const t = tournamentById(m.tournamentId);
      return t && t.year === selectedYear;
    });
    displayedWins = selectedYearMatches.filter(m => m.winnerId === playerId).length;
    displayedLosses = selectedYearMatches.length - displayedWins;
    displayedSurfaceStats = {hard:{w:0,l:0}, clay:{w:0,l:0}, grass:{w:0,l:0}};
    selectedYearMatches.forEach(m => {
      const t = tournamentById(m.tournamentId);
      if(!t || !displayedSurfaceStats[t.surface]) return;
      if(m.winnerId === playerId) displayedSurfaceStats[t.surface].w++; else displayedSurfaceStats[t.surface].l++;
    });
    recordLabel = profileRecordYearFilter;
  }

  const careerStatsBox = el("div", {class:"profile-stats"}, [
    el("div", {class:"stat-box"}, [el("div", {class:"stat-num"}, [String(displayedStats.points.toLocaleString())]), el("div", {class:"stat-label"}, [recordLabel + " Points"])]),
    el("div", {class:"stat-box"}, [el("div", {class:"stat-num"}, [String(displayedStats.titles)]), el("div", {class:"stat-label"}, [recordLabel + " Titles"])]),
    el("div", {class:"stat-box"}, [el("div", {class:"stat-num"}, [displayedWins + "-" + displayedLosses]), el("div", {class:"stat-label"}, [recordLabel + " Win-Loss"])])
  ]);
  modal.appendChild(careerStatsBox);
  const careerSurfaceRow = el("div", {class:"profile-stats"}, ["hard","clay","grass"].map(s =>
    el("div", {class:"stat-box"}, [
      el("div", {class:"stat-num"}, [displayedSurfaceStats[s].w + "-" + displayedSurfaceStats[s].l]),
      el("div", {class:"stat-label"}, [s])
    ])
  ));
  modal.appendChild(careerSurfaceRow);

  modal.appendChild(el("div", {class:"profile-section-title"}, ["Final Results"]));
  const finalsTableHTML = finalsHistoryTableHTML(playerId);
  if(!finalsTableHTML){
    modal.appendChild(el("p", {}, ["No finals reached yet."]));
  } else {
    modal.appendChild(el("div", {class:"calendar-scroll", html: finalsTableHTML}));
  }

  const challengerFinals = getChallengerFinalsForPlayer(playerId);
  if(challengerFinals.length > 0){
    modal.appendChild(el("div", {class:"profile-section-title"}, ["Challenger Finals"]));
    challengerFinals.forEach(({t, isChamp, opponent, match}) => {
      const bracketBtn = el("button", {class:"btn btn-small btn-ghost", "data-open-bracket": t.id}, ["Bracket"]);
      const row = el("div", {class:"tourney-row"}, [
        el("span", {class:"level-tag " + (LEVEL_TAG_CLASSES[t.level] || "")}, [LEVEL_LABELS[t.level] || t.level]),
        el("span", {class:"surface-tag surface-" + t.surface}, [t.surface]),
        el("span", {class:"tourney-name"}, [t.name + " '" + String(t.year).slice(-2)]),
        el("span", {class:"tourney-champ", html:
          '<b class="' + (isChamp ? "final-champ" : "final-runnerup") + '">' + (isChamp ? "Champion" : "Runner-up") + '</b>' +
          ' — ' + (isChamp ? "def. " : "lost to ") + (opponent ? playerLinkHTML(opponent) : "(unknown)")
        }),
        el("span", {html: renderScoreboardHTML(match)}),
        bracketBtn
      ]);
      modal.appendChild(row);
    });
  }

  const top10Wins = getTop10WinsForPlayer(playerId);
  const top10Header = el("div", {class:"profile-section-title"}, ["Top 10 Wins" + (top10Wins.length > 0 ? " (" + top10Wins.length + ")" : "")]);
  modal.appendChild(top10Header);
  if(top10Wins.length === 0){
    modal.appendChild(el("p", {}, ["No wins over a Top 10 opponent yet."]));
  } else {
    top10Wins.forEach(({t, match, opponent, opponentRank, ownRankAtTime}) => {
      const bracketBtn = el("button", {class:"btn btn-small btn-ghost", "data-open-bracket": t.id}, ["Bracket"]);
      const row = el("div", {class:"tourney-row"}, [
        el("span", {class:"level-tag " + (LEVEL_TAG_CLASSES[t.level] || "")}, [LEVEL_LABELS[t.level] || t.level]),
        el("span", {class:"round-tag", title:"Round"}, [ROUND_LABELS[match.round] || match.round]),
        el("span", {class:"tourney-name"}, [t.name + " '" + String(t.year).slice(-2)]),
        el("span", {class:"tourney-champ", html:
          (ownRankAtTime ? '(No. ' + ownRankAtTime + ') ' : '') + 'def. ' +
          '<b class="final-champ">No. ' + opponentRank + '</b> ' + (opponent ? playerLinkHTML(opponent) : "(unknown)")
        }),
        el("span", {html: renderScoreboardHTML(match)}),
        bracketBtn
      ]);
      modal.appendChild(row);
    });
  }

  modal.appendChild(el("div", {class:"profile-section-title"}, ["Ranking History"]));
  if(history.length < 2){
    modal.appendChild(el("p", {}, ["Not enough tournaments played yet to chart a trend."]));
  } else {
    modal.appendChild(el("div", {class:"rank-chart", html: renderRankHistorySVG(history)}));
  }

  modal.appendChild(el("div", {class:"modal-close-row"}, [
    el("button", {class:"btn btn-small " + (p.retired ? "btn-primary" : "btn-danger"), "data-toggle-retire": p.id}, [p.retired ? "Unretire" : "Retire"]),
    el("button", {class:"btn btn-ghost", id:"profile-close"}, ["Close"])
  ]));

  $("#player-modal-backdrop").classList.remove("hidden");
  $("#profile-close").addEventListener("click", closePlayerModal);
}



// Small inline SVG line chart: rank on the y-axis (inverted — No.1 at top), chronological on x.
function renderRankHistorySVG(history){
  const w = 560, h = 150, padL = 34, padR = 12, padT = 12, padB = 20;
  const maxRank = Math.max(...history.map(h => h.rank), 5);
  const minRank = 1;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const baseline = h - padB;
  const xFor = (i) => padL + (history.length === 1 ? innerW / 2 : (i / (history.length - 1)) * innerW);
  const yFor = (rank) => padT + ((rank - minRank) / Math.max(1, (maxRank - minRank))) * innerH;

  const points = history.map((pt, i) => xFor(i) + "," + yFor(pt.rank)).join(" ");

  // Soft gradient fill under the line — purely decorative, gives the chart
  // some visual weight instead of reading as a bare line.
  const areaPoints = points + " " + xFor(history.length - 1) + "," + baseline + " " + xFor(0) + "," + baseline;
  const gradientId = "rankFill" + Math.random().toString(36).slice(2, 8);
  const areaFill = '<defs><linearGradient id="' + gradientId + '" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="var(--ball)" stop-opacity="0.22"></stop>' +
    '<stop offset="100%" stop-color="var(--ball)" stop-opacity="0"></stop>' +
    '</linearGradient></defs>' +
    '<polygon points="' + areaPoints + '" fill="url(#' + gradientId + ')"></polygon>';

  // The single best (lowest-numbered) week gets a gold ring, and the most
  // recent week gets a highlighted blue dot — two quick visual landmarks
  // instead of a flat, undifferentiated row of identical dots.
  const peakIdx = history.reduce((best, pt, i) => pt.rank < history[best].rank ? i : best, 0);
  const lastIdx = history.length - 1;

  // A slightly larger hit-area sits behind each visible dot so the tooltip
  // and click target are easy to hit, not just the tiny 3px point. It needs
  // pointer-events="all" explicitly — an SVG shape with a transparent fill
  // doesn't register hover/pointer events by default, only a painted one
  // would, so without this nothing would ever fire.
  const dots = history.map((pt, i) => {
    const prevRank = i > 0 ? history[i-1].rank : null;
    const delta = prevRank === null ? "" : prevRank === pt.rank ? "No change" : prevRank > pt.rank ? "\u25b2 Up " + (prevRank - pt.rank) : "\u25bc Down " + (pt.rank - prevRank);
    const isPeak = i === peakIdx;
    const isLast = i === lastIdx;
    const visibleR = isLast ? 5 : isPeak ? 4 : 3;
    const visibleFill = isLast ? "var(--ball)" : isPeak ? "#D4A017" : "var(--ink)";
    return '<circle class="rank-chart-hit" cx="' + xFor(i) + '" cy="' + yFor(pt.rank) + '" r="9" fill="transparent" pointer-events="all" ' +
        'data-chart-week="' + pt.date + '" data-chart-rank="' + pt.rank + '" data-chart-delta="' + escapeHtml(delta) + '"></circle>' +
      '<circle class="rank-chart-dot" cx="' + xFor(i) + '" cy="' + yFor(pt.rank) + '" r="' + visibleR + '" fill="' + visibleFill + '" pointer-events="none"></circle>' +
      (isPeak ? '<circle cx="' + xFor(i) + '" cy="' + yFor(pt.rank) + '" r="6.5" fill="none" stroke="#D4A017" stroke-width="1.5" pointer-events="none"></circle>' : "");
  }).join("");

  const gridLines = [minRank, Math.round((minRank+maxRank)/2), maxRank].map(r =>
    '<line x1="' + padL + '" y1="' + yFor(r) + '" x2="' + (w-padR) + '" y2="' + yFor(r) + '" stroke="var(--line)" stroke-width="1"></line>' +
    '<text x="2" y="' + (yFor(r)+4) + '" font-family="JetBrains Mono, monospace" font-size="10" fill="var(--ink-soft)">' + r + '</text>'
  ).join("");

  // A subtle vertical marker (and year label) wherever the calendar year
  // actually changes — not every date, just the boundaries, so it stays
  // readable no matter how many weeks of history there are.
  const yearMarkers = [];
  history.forEach((pt, i) => {
    const year = new Date(pt.date).getFullYear();
    if(i === 0 || new Date(history[i-1].date).getFullYear() !== year){
      yearMarkers.push({x: xFor(i), year});
    }
  });
  const yearMarkersHTML = yearMarkers.map(({x, year}) =>
    '<line x1="' + x + '" y1="' + padT + '" x2="' + x + '" y2="' + (h - padB) + '" stroke="var(--line)" stroke-width="1" stroke-dasharray="2,2"></line>' +
    '<text x="' + x + '" y="' + (h - 6) + '" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10" fill="var(--ink-soft)">' + year + '</text>'
  ).join("");

  return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' +
    areaFill +
    gridLines +
    yearMarkersHTML +
    '<polyline points="' + points + '" fill="none" stroke="var(--ink)" stroke-width="2"></polyline>' +
    dots +
    '</svg>';
}

/* ---------------- Global search ---------------- */
function handleGlobalSearchInput(e){
  const query = e.target.value;
  const suggestionsEl = $("#global-search-suggestions");
  if(!query.trim()){ suggestionsEl.classList.add("hidden"); suggestionsEl.innerHTML = ""; return; }

  const playerResults = state.players.filter(p => matchesSearch(p.name, query)).slice(0, 6);
  const tourneyNames = Array.from(new Set(state.tournaments.map(t => t.name)))
    .filter(name => matchesSearch(name, query))
    .slice(0, 6);

  let html = "";
  if(playerResults.length){
    html += '<div class="search-group-label">Players</div>';
    html += playerResults.map(p => '<button type="button" class="picker-option" data-search-open-player="' + p.id + '">' + playerNameHTML(p) + (p.retired ? ' <span class="hist-marker">(retired)</span>' : "") + '</button>').join("");
  }
  if(tourneyNames.length){
    html += '<div class="search-group-label">Tournaments</div>';
    html += tourneyNames.map(name => {
      const editionCount = state.tournaments.filter(t => t.name === name).length;
      return '<button type="button" class="picker-option" data-search-open-tourney-history="' + escapeHtml(name) + '">' + escapeHtml(name) +
        ' <span class="hist-marker">(' + editionCount + ' edition' + (editionCount === 1 ? "" : "s") + ')</span></button>';
    }).join("");
  }
  suggestionsEl.innerHTML = html || '<div class="picker-empty">No match</div>';
  suggestionsEl.classList.remove("hidden");
}

function handleGlobalSearchClick(e){
  const playerBtn = e.target.closest("[data-search-open-player]");
  if(playerBtn){
    renderPlayerProfile(playerBtn.dataset.searchOpenPlayer);
    $("#global-search-input").value = "";
    $("#global-search-suggestions").classList.add("hidden");
    return;
  }
  const tourneyBtn = e.target.closest("[data-search-open-tourney-history]");
  if(tourneyBtn){
    openTournamentHistory(tourneyBtn.dataset.searchOpenTourneyHistory);
    $("#global-search-input").value = "";
    $("#global-search-suggestions").classList.add("hidden");
  }
}

function closePlayerModal(){
  $("#player-modal-backdrop").classList.add("hidden");
}

/* ---------------- Tournaments view ---------------- */
// Groups a tournament's results into who reached each stage — used by the
// season calendar view (champion / runner-up / semifinalists / quarterfinalists).
// Whoever won this exact tournament name last year, regardless of their
// current status (retired, no longer entered, etc.) — a defending champion
// is a historical fact about the previous edition, not a claim about who's
// still active.
function getDefendingChampion(t){
  const prevEdition = state.tournaments.find(t2 => t2.name === t.name && t2.year === t.year - 1);
  if(!prevEdition) return null;
  const results = computeTournamentResults(prevEdition.id);
  for(const [pid, res] of results){
    if(res.code === "W") return {player: playerById(pid), edition: prevEdition};
  }
  return null;
}

function getTournamentResultsByRound(t){
  const results = computeTournamentResults(t.id);
  const champion = [], runnerUp = [], semifinalists = [], quarterfinalists = [];
  results.forEach((res, pid) => {
    const p = playerById(pid);
    if(!p) return;
    if(res.code === "W") champion.push(p);
    else if(res.code === "F") runnerUp.push(p);
    else if(res.code === "SF") semifinalists.push(p);
    else if(res.code === "QF") quarterfinalists.push(p);
  });
  return {champion, runnerUp, semifinalists, quarterfinalists};
}

function playersListHTML(players){
  if(!players || players.length === 0) return "—";
  return players.map(p => '<div class="cal-player">' + playerLinkHTML(p) + '</div>').join("");
}

function tournamentCellHTML(t){
  return '<div class="cal-tourney-name"><button class="tourney-name-link" data-open-tourney-history="' + escapeHtml(t.name) + '">' + escapeHtml(t.name) + '</button></div>' +
    (t.location ? '<div class="cal-tourney-location">' + escapeHtml(t.location) + '</div>' : "") +
    '<div class="cal-tourney-tags">' +
      '<span class="level-tag ' + (LEVEL_TAG_CLASSES[t.level] || "") + '">' + escapeHtml(LEVEL_LABELS[t.level] || t.level) + '</span>' +
      '<span class="surface-tag surface-' + t.surface + '">' + t.surface + '</span>' +
    '</div>' +
    '<div class="cal-tourney-meta">Draw of ' + t.drawSize + '</div>' +
    '<div class="cal-tourney-actions">' +
      '<button class="btn btn-small btn-primary" data-open-bracket="' + t.id + '">Bracket</button>' +
      '<button class="btn btn-small btn-ghost" data-edit-tournament="' + t.id + '">Edit</button>' +
      '<button class="btn btn-small btn-danger" data-delete-tournament="' + t.id + '">Delete</button>' +
    '</div>';
}

function populateTournamentsYearFilter(){
  const years = new Set();
  state.tournaments.forEach(t => years.add(t.year));
  (state.byeWeeks || []).forEach(bw => years.add(new Date(bw.date + "T00:00:00").getFullYear()));
  const sorted = Array.from(years).sort((a,b) => b - a);
  const sel = $("#tournaments-year-filter");
  const prev = sel.value;
  sel.innerHTML = '<option value="all">All Years</option>' + sorted.map(y => '<option value="' + y + '">' + y + '</option>').join("");
  if(prev && (prev === "all" || sorted.some(y => String(y) === prev))) sel.value = prev;
}

function renderTournaments(){
  populateTournamentsYearFilter();
  const yearFilter = $("#tournaments-year-filter").value || "all";

  const list = $("#tournaments-list");
  const empty = $("#tournaments-empty");
  const allByeWeeks = state.byeWeeks || [];

  if(state.tournaments.length === 0 && allByeWeeks.length === 0){
    list.innerHTML = "";
    empty.classList.remove("hidden");
    empty.querySelector("p").textContent = "No events scheduled.";
    empty.querySelector(".empty-sub").textContent = "Add a tournament, then log results for it.";
    return;
  }

  const byeWeeks = yearFilter === "all" ? allByeWeeks : allByeWeeks.filter(bw => String(new Date(bw.date + "T00:00:00").getFullYear()) === yearFilter);
  const tournaments = yearFilter === "all" ? state.tournaments : state.tournaments.filter(t => String(t.year) === yearFilter);

  if(tournaments.length === 0 && byeWeeks.length === 0){
    list.innerHTML = "";
    empty.classList.remove("hidden");
    empty.querySelector("p").textContent = "No events in " + yearFilter + ".";
    empty.querySelector(".empty-sub").textContent = "Try a different year, or switch back to All Years.";
    return;
  }
  empty.classList.add("hidden");

  const byWeek = new Map();
  tournaments.forEach(t => {
    const wk = mondayOf(tournamentDateMs(t));
    if(!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk).push({kind:"tournament", data:t});
  });
  byeWeeks.forEach(bw => {
    const wk = mondayOf(byeWeekDateMs(bw));
    if(!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk).push({kind:"bye", data:bw});
  });
  const weeks = Array.from(byWeek.keys()).sort((a,b) => b - a);

  let html = '<div class="calendar-scroll"><table class="calendar-table"><thead><tr>' +
    '<th>Week</th><th>Tournament</th><th>Champion</th><th>Runner-up</th><th>Semifinalists</th><th>Quarterfinalists</th>' +
    '</tr></thead><tbody>';

  weeks.forEach(wk => {
    const items = byWeek.get(wk).sort((a,b) => {
      if(a.kind !== b.kind) return a.kind === "bye" ? 1 : -1;
      if(a.kind === "tournament" && b.kind === "tournament"){
        const tierDiff = levelSortRank(a.data.level) - levelSortRank(b.data.level);
        if(tierDiff !== 0) return tierDiff;
      }
      const nameA = a.kind === "tournament" ? a.data.name : "";
      const nameB = b.kind === "tournament" ? b.data.name : "";
      return nameA.localeCompare(nameB);
    });
    items.forEach((item, idx) => {
      html += '<tr class="' + (idx === 0 ? "cal-week-start" : "") + '">';
      if(idx === 0){
        html += '<td class="cal-week" rowspan="' + items.length + '">' + formatWeekDate(wk) + '</td>';
      }
      if(item.kind === "bye"){
        const bw = item.data;
        html += '<td class="cal-tourney-cell">' +
          '<div class="cal-tourney-name cal-bye-name">Bye Week</div>' +
          (bw.note ? '<div class="cal-tourney-location">' + escapeHtml(bw.note) + '</div>' : "") +
          '<div class="cal-tourney-actions">' +
            '<button class="btn btn-small btn-danger" data-delete-byeweek="' + bw.id + '">Delete</button>' +
          '</div>' +
        '</td>';
        html += '<td colspan="4"><span class="cal-inprogress">No tournament this week</span></td>';
      } else {
        const t = item.data;
        const {champion, runnerUp, semifinalists, quarterfinalists} = getTournamentResultsByRound(t);
        const played = matchesForTournament(t.id).length > 0;
        html += '<td class="cal-tourney-cell">' + tournamentCellHTML(t) + '</td>';
        html += '<td>' + (champion.length ? playersListHTML(champion) : (played ? '<span class="cal-inprogress">In progress</span>' : "—")) + '</td>';
        html += '<td>' + playersListHTML(runnerUp) + '</td>';
        html += '<td>' + playersListHTML(semifinalists) + '</td>';
        html += '<td>' + playersListHTML(quarterfinalists) + '</td>';
      }
      html += '</tr>';
    });
  });

  html += '</tbody></table></div>';
  list.innerHTML = html;
}

/* ---------------- Bracket engine ---------------- */
const ROUND_NAME_BY_SIZE = {128:"R128", 64:"R64", 32:"R32", 16:"R16", 8:"QF", 4:"SF"};
const DRAW_SIZE_OPTIONS = [28, 30, 32, 48, 56, 64, 96, 128];
let currentBracketTournamentId = null;

function nextPowerOf2(n){
  let p = 1;
  while(p < n) p *= 2;
  return p;
}
// The actual number of physical bracket slots — always a power of 2.
// A 28-player draw plays inside a 32-slot bracket with 4 byes, etc.
function capacityOf(drawSize){ return nextPowerOf2(drawSize); }
function numByesFor(drawSize){ return capacityOf(drawSize) - drawSize; }
// Standard tour convention: seeds = capacity / 4 (8 seeds in a 32 draw, 16 in a 64, 32 in a 128).
function numSeedsFor(drawSize){ return Math.max(2, capacityOf(drawSize) / 4); }

function bracketRoundNames(capacity){
  const names = [];
  let s = capacity;
  while(s >= 2){
    names.push(s === 2 ? "F" : ROUND_NAME_BY_SIZE[s]);
    s = s / 2;
  }
  return names;
}

function ensureBracketEntries(t){
  if(!t.drawSize || !DRAW_SIZE_OPTIONS.includes(t.drawSize)) t.drawSize = 32;
  const cap = capacityOf(t.drawSize);
  if(!Array.isArray(t.bracketEntries) || t.bracketEntries.length !== cap){
    t.bracketEntries = new Array(cap).fill(0).map(() => ({type:"empty"}));
  }
  const nSeeds = numSeedsFor(t.drawSize);
  if(!Array.isArray(t.seeds) || t.seeds.length !== nSeeds){
    const old = Array.isArray(t.seeds) ? t.seeds : [];
    t.seeds = new Array(nSeeds).fill(null).map((_, i) => old[i] || null);
  }
  if(!Array.isArray(t.unseededEntrants)) t.unseededEntrants = [];
  if(!Array.isArray(t.qualifierIds)) t.qualifierIds = [];
  if(!Array.isArray(t.entryList)) t.entryList = [];
  if(!Array.isArray(t.luckyLoserIds)) t.luckyLoserIds = [];
}

// Seed number (1-indexed) for a player in this tournament's main draw, or null.
function seedNumberForPlayer(t, playerId){
  const idx = (t.seeds || []).indexOf(playerId);
  return idx >= 0 ? idx + 1 : null;
}
function isMainDrawQualifier(t, playerId){
  return (t.qualifierIds || []).includes(playerId);
}
function isLuckyLoser(t, playerId){
  return (t.luckyLoserIds || []).includes(playerId);
}
// Real tour rule: a Lucky Loser comes from whoever lost in the LAST round
// of qualifying — the players who came closest to qualifying outright, so
// they get first call on any main-draw withdrawal. Excludes anyone already
// placed somewhere in the main draw and anyone retired.
function getLuckyLoserCandidates(t){
  if(!t.qualifying || !t.qualifying.enabled) return [];
  const finalQualRound = "Q" + t.qualifying.numRounds;
  const qualMatches = state.matches.filter(m => m.tournamentId === t.id && m.bracket === "qual" && m.round === finalQualRound);
  const loserIds = new Set();
  qualMatches.forEach(m => {
    if(!m.winnerId) return;
    const loserId = m.playerAId === m.winnerId ? m.playerBId : m.playerAId;
    if(loserId) loserIds.add(loserId);
  });
  const alreadyInMainDraw = new Set((t.bracketEntries || []).filter(e => e.type === "player").map(e => e.playerId));
  return Array.from(loserIds)
    .filter(pid => !alreadyInMainDraw.has(pid))
    .map(pid => playerById(pid))
    .filter(p => p && !p.retired);
}

/* ---------------- Lucky Loser picker ---------------- */
let llWithdrawnContext = null; // {tournamentId, withdrawnPlayerId}

function openLuckyLoserPicker(t, withdrawnPlayerId){
  llWithdrawnContext = {tournamentId: t.id, withdrawnPlayerId};
  renderLuckyLoserPicker();
  $("#ll-modal-backdrop").classList.remove("hidden");
}
function closeLuckyLoserPicker(){
  llWithdrawnContext = null;
  $("#ll-modal-backdrop").classList.add("hidden");
}
function renderLuckyLoserPicker(){
  if(!llWithdrawnContext) return;
  const t = tournamentById(llWithdrawnContext.tournamentId);
  const withdrawnPlayer = playerById(llWithdrawnContext.withdrawnPlayerId);
  if(!t || !withdrawnPlayer){ closeLuckyLoserPicker(); return; }

  const seedDateEl = $("#bracket-seed-date");
  const seedDate = seedDateEl ? rankingDateFromSelectValue(seedDateEl.value) : mondayOf(getLatestActiveDate());
  const ranks = officialRanksAsOf(seedDate);
  const candidates = getLuckyLoserCandidates(t).sort((a,b) => (ranks[a.id] || 99999) - (ranks[b.id] || 99999));

  const modal = $("#ll-modal");
  modal.innerHTML = "";
  modal.appendChild(el("h3", {}, ["Replace " + withdrawnPlayer.name]));
  modal.appendChild(el("p", {class:"modal-help"}, ["Choose a Lucky Loser to fill the vacated spot — candidates are whoever lost in the last round of qualifying, ranked by the seeding date above the draw."]));

  if(candidates.length === 0){
    modal.appendChild(el("p", {}, ["No eligible Lucky Losers right now — either no one has lost in the final qualifying round yet, or qualifying isn't enabled for this tournament."]));
  } else {
    const list = el("div", {style:"display:flex; flex-direction:column; gap:6px; max-height:340px; overflow-y:auto;"});
    candidates.forEach(p => {
      const btn = el("button", {type:"button", class:"picker-option", "data-select-ll": p.id, html:
        (ranks[p.id] ? '<span class="ll-pick-rank">No. ' + ranks[p.id] + '</span> ' : "") + playerNameHTML(p)
      });
      list.appendChild(btn);
    });
    modal.appendChild(list);
  }

  modal.appendChild(el("div", {class:"modal-close-row"}, [
    el("span", {}),
    el("button", {class:"btn btn-ghost", id:"ll-modal-close"}, ["Cancel"])
  ]));
}
function handleSelectLuckyLoser(replacementId){
  if(!llWithdrawnContext) return;
  const t = tournamentById(llWithdrawnContext.tournamentId);
  const withdrawnPlayerId = llWithdrawnContext.withdrawnPlayerId;
  const withdrawnPlayer = playerById(withdrawnPlayerId);
  const replacementPlayer = playerById(replacementId);
  if(!t || !replacementPlayer) return;
  if(!confirm("Replace " + (withdrawnPlayer ? withdrawnPlayer.name : "this player") + " with " + replacementPlayer.name + " as a Lucky Loser?")) return;

  const entryIdx = (t.bracketEntries || []).findIndex(e => e.type === "player" && e.playerId === withdrawnPlayerId);
  if(entryIdx === -1){ closeLuckyLoserPicker(); return; }
  t.bracketEntries[entryIdx] = {type:"player", playerId: replacementId};

  // A Lucky Loser is always unseeded, even when replacing a seeded player —
  // the seed just disappears rather than transferring.
  const seedIdx = (t.seeds || []).indexOf(withdrawnPlayerId);
  if(seedIdx >= 0) t.seeds[seedIdx] = null;

  // Bookkeeping for the unseeded-entrants list, so other displays (like the
  // Entry List) stay consistent with who's actually in the draw now.
  const unseededIdx = (t.unseededEntrants || []).indexOf(withdrawnPlayerId);
  if(unseededIdx >= 0) t.unseededEntrants[unseededIdx] = replacementId;
  else if(!t.unseededEntrants.includes(replacementId)) t.unseededEntrants.push(replacementId);

  if(!Array.isArray(t.luckyLoserIds)) t.luckyLoserIds = [];
  t.luckyLoserIds.push(replacementId);

  saveState();
  closeLuckyLoserPicker();
  renderBracketPage();
}

// Wild-card status comes from the entry list, independent of where the
// player actually ended up (seeded or not) — real draws can and do have a
// seeded wild card, so this always stacks alongside a seed badge rather than
// replacing it.
function isMainDrawWildCard(t, playerId){
  return (t.entryList || []).some(e => e.playerId === playerId && e.wildcard === "main");
}
function isQualifyingWildCard(t, playerId){
  return (t.entryList || []).some(e => e.playerId === playerId && e.wildcard === "qual");
}
function isMainDrawProtectedRanking(t, playerId){
  return (t.entryList || []).some(e => e.playerId === playerId && e.wildcard === "pr");
}
function isQualifyingProtectedRanking(t, playerId){
  return (t.entryList || []).some(e => e.playerId === playerId && e.wildcard === "qpr");
}

function shuffleArray(arr){
  const a = arr.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Rebuilding a bracket round can shrink or grow the page a lot (a tall
// score-entry card collapses to a compact result once saved). Without this,
// the browser clamps scroll position when the document shrinks, which reads
// as the page "jumping to the top" even though nothing actually navigated.
function withScrollPreserved(fn){
  const y = window.scrollY;
  fn();
  window.scrollTo(0, y);
}

// Single save path for both the main draw and qualifying, used by both the
// auto-detected-from-score flow and the click-to-award-walkover flow.
function persistMatchResult(t, m, winnerPlayerId, sets, walkover, bracketType){
  state.matches.push({
    id: uid("m"),
    tournamentId: t.id,
    bracket: bracketType,
    round: m.round,
    slot: m.slotIndex,
    playerAId: m.slotA.playerId,
    playerBId: m.slotB.playerId,
    winnerId: winnerPlayerId,
    walkover,
    sets,
    createdAt: Date.now()
  });
  saveState();
  withScrollPreserved(() => {
    if(bracketType === "qual") renderQualBracketRounds(t);
    else renderBracketRounds(t);
  });
  renderRankings();
}

// Classic single-elimination seeding order: result[i] is the seed rank that
// structurally belongs in slot i, guaranteeing seed 1 and 2 can only meet in
// the final, seeds 1-4 can't meet before the semis, and so on.
// Real draw sheets anchor seeds at recursive boundary points: seed 1 at the
// very top, seed 2 at the very bottom, seeds 3-4 straddling the halfway
// line, seeds 5-8 straddling the quarter lines, seeds 9-16 the eighth
// lines, and so on — verified against a real published draw sheet.
// Returns {potIndex: [1-indexed positions in that pot]}.
function seedBoundaryPots(cap, nSeeds){
  const pots = {0:[1], 1:[cap]};
  let assigned = 2, level = 1;
  while(assigned < nSeeds){
    const denom = Math.pow(2, level);
    const positions = [];
    for(let k = 1; k < denom; k += 2){
      const b = cap * k / denom;
      positions.push(b, b + 1);
    }
    pots[level + 1] = positions;
    assigned += positions.length;
    level++;
  }
  return pots;
}

// Pot groupings: seed 1 alone, seed 2 alone, seeds 3-4, seeds 5-8, seeds 9-16, seeds 17-32...
function potIndexForRank(rank){
  return rank === 1 ? 0 : Math.ceil(Math.log2(rank));
}

// Runs an actual seeded draw: places seed 1 and 2 at opposite ends, randomly
// distributes the rest of each pot among its structural slots, hands byes to
// the top seeds, and randomly scatters unseeded entrants into what's left.
function generateDraw(t){
  ensureBracketEntries(t);
  const cap = capacityOf(t.drawSize);
  const nSeeds = numSeedsFor(t.drawSize);
  const nByes = numByesFor(t.drawSize);
  const slots = new Array(cap).fill(null);
  const rankToSlot = {};

  const potGroups = seedBoundaryPots(cap, nSeeds);
  Object.keys(potGroups).forEach(pot => {
    const slotIdxs = shuffleArray(potGroups[pot].map(p => p - 1)); // 1-indexed -> 0-indexed
    const ranksInPot = [];
    for(let r = 1; r <= nSeeds; r++){ if(potIndexForRank(r) === Number(pot)) ranksInPot.push(r); }
    ranksInPot.forEach((r, i) => {
      const slotIdx = slotIdxs[i];
      rankToSlot[r] = slotIdx;
      const playerId = t.seeds[r-1];
      slots[slotIdx] = playerId ? {type:"player", playerId} : {type:"empty"};
    });
  });

  // Byes go to the sibling slot of the top-ranked seeds first.
  const byeSlots = new Set();
  for(let r = 1; r <= nSeeds && byeSlots.size < nByes; r++){
    const slotIdx = rankToSlot[r];
    if(slotIdx === undefined) continue;
    const sibling = slotIdx % 2 === 0 ? slotIdx + 1 : slotIdx - 1;
    if(slots[sibling] === null){
      slots[sibling] = {type:"bye"};
      byeSlots.add(sibling);
    }
  }
  let remainingByes = nByes - byeSlots.size;
  if(remainingByes > 0){
    for(let i = 0; i < cap && remainingByes > 0; i++){
      if(slots[i] === null){ slots[i] = {type:"bye"}; remainingByes--; }
    }
  }

  // Everything left over is filled by a blind draw of the unseeded entrants.
  const unseeded = shuffleArray(t.unseededEntrants || []);
  let ui = 0;
  for(let i = 0; i < cap; i++){
    if(slots[i] === null){
      slots[i] = ui < unseeded.length ? {type:"player", playerId: unseeded[ui++]} : {type:"empty"};
    }
  }

  t.bracketEntries = slots;
  // Clear old MAIN DRAW results only — they referred to the previous draw's
  // slots. Qualifying results are a separate bracket and must not be touched
  // by regenerating the main draw.
  state.matches = state.matches.filter(m => !(m.tournamentId === t.id && (m.bracket || "main") === "main"));
}

// Resolves the full bracket: which player occupies every slot in every round,
// whether that slot's match has been played, and who advances.
function computeBracket(t){
  ensureBracketEntries(t);
  const roundNames = bracketRoundNames(capacityOf(t.drawSize));
  let currentSlots = t.bracketEntries.map(s => ({...s}));
  const rounds = [];
  for(let r = 0; r < roundNames.length; r++){
    const roundName = roundNames[r];
    const numMatches = currentSlots.length / 2;
    const matches = [];
    const nextSlots = [];
    for(let i = 0; i < numMatches; i++){
      const slotA = currentSlots[i*2];
      const slotB = currentSlots[i*2+1];
      const existingMatch = state.matches.find(m => m.tournamentId === t.id && (m.bracket||"main") === "main" && m.round === roundName && m.slot === i);
      let status, winnerSlot = null;
      if(slotA.type === "empty" || slotB.type === "empty"){
        status = "incomplete";
      } else if(slotA.type === "bye" && slotB.type === "bye"){
        status = "double-bye";
      } else if(slotA.type === "bye"){
        status = "bye"; winnerSlot = slotB;
      } else if(slotB.type === "bye"){
        status = "bye"; winnerSlot = slotA;
      } else if(existingMatch){
        status = "played";
        winnerSlot = existingMatch.winnerId === slotA.playerId ? slotA : slotB;
      } else {
        status = "ready";
      }
      matches.push({round: roundName, slotIndex: i, slotA, slotB, existingMatch, status, winnerSlot});
      nextSlots.push(winnerSlot ? {type:"player", playerId: winnerSlot.playerId} : {type:"empty"});
    }
    rounds.push({round: roundName, matches});
    currentSlots = nextSlots;
  }
  return rounds;
}

// The bronze medal match — only relevant for Olympics-level tournaments.
// Both semifinals have to be decided first (that's where the two
// participants come from: the SF losers, not the winners), and it's stored
// as its own real match record (round: "BRONZE") the same way any other
// bracket result is, just outside the normal R64→F progression. Returns
// null whenever there's nothing to show yet — wrong level, semis not both
// played, or a semifinal ended in a walkover/bye with no real loser to
// place into it.
function computeBronzeMatch(t){
  if(t.level !== "OLYMPICS") return null;
  const rounds = computeBracket(t);
  const sfRound = rounds.find(r => r.round === "SF");
  if(!sfRound || sfRound.matches.length !== 2) return null;
  const losers = [];
  for(const m of sfRound.matches){
    if(m.status !== "played" || !m.winnerSlot) return null;
    const loserSlot = (m.slotA.type === "player" && m.winnerSlot.playerId === m.slotA.playerId) ? m.slotB : m.slotA;
    if(loserSlot.type !== "player") return null;
    losers.push(loserSlot);
  }
  const existingMatch = state.matches.find(mm => mm.tournamentId === t.id && (mm.bracket || "main") === "main" && mm.round === "BRONZE");
  let status = "ready", winnerSlot = null;
  if(existingMatch){
    status = "played";
    winnerSlot = existingMatch.winnerId === losers[0].playerId ? losers[0] : losers[1];
  }
  return {round: "BRONZE", slotIndex: 0, slotA: losers[0], slotB: losers[1], existingMatch, status, winnerSlot};
}

// Deletes the recorded match at (roundIdx, matchIndex) and cascades forward,
// since anything downstream was built on a result that no longer holds.
function deleteCascade(t, roundIdx, matchIndex){
  const roundNames = bracketRoundNames(capacityOf(t.drawSize));
  if(roundIdx < 0 || roundIdx >= roundNames.length) return;
  const roundName = roundNames[roundIdx];
  const idx = state.matches.findIndex(m => m.tournamentId === t.id && (m.bracket||"main") === "main" && m.round === roundName && m.slot === matchIndex);
  if(idx !== -1){
    state.matches.splice(idx, 1);
    deleteCascade(t, roundIdx + 1, Math.floor(matchIndex / 2));
  }
}

function openBracket(tournamentId){
  currentBracketTournamentId = tournamentId;
  closePlayerModal();
  $all(".tab").forEach(tab => tab.classList.remove("active"));
  $all(".view").forEach(v => v.classList.add("hidden"));
  $("#view-bracket").classList.remove("hidden");
  switchBracketSubTab("draw");
  renderBracketPage();
}
function closeBracket(){
  currentBracketTournamentId = null;
  switchView("tournaments");
}

/* ---------------- Tournament History (all editions of one name) ---------------- */
let currentTourneyHistoryName = null;
function openTournamentHistory(name){
  closePlayerModal();
  currentTourneyHistoryName = name;
  $all(".tab").forEach(tab => tab.classList.remove("active"));
  $all(".view").forEach(v => v.classList.add("hidden"));
  $("#view-tourney-history").classList.remove("hidden");
  renderTournamentHistoryPage(name);
}
function closeTournamentHistory(){
  currentTourneyHistoryName = null;
  switchView("tournaments");
}

function renderTournamentHistoryPage(name){
  const editions = state.tournaments
    .filter(t => t.name === name)
    .sort((a,b) => tournamentDateMs(b) - tournamentDateMs(a));
  if(editions.length === 0){ closeTournamentHistory(); return; }

  const years = editions.map(t => t.year);
  const firstYear = Math.min(...years), lastYear = Math.max(...years);
  const latest = editions[0];

  const head = $("#tourney-history-head");
  head.innerHTML = "";
  head.appendChild(el("div", {}, [
    el("h2", {}, [name]),
    el("div", {class:"profile-meta"}, [
      (firstYear === lastYear ? String(firstYear) : firstYear + "\u2013" + lastYear) +
      " \u00b7 " + editions.length + " edition" + (editions.length === 1 ? "" : "s") +
      " \u00b7 most recently " + (LEVEL_LABELS[latest.level] || latest.level) + " on " + latest.surface
    ])
  ]));

  const body = $("#tourney-history-body");
  body.innerHTML = "";

  // Most titles at this specific event — its own little leaderboard.
  const titleCounts = new Map();
  editions.forEach(t => {
    const champion = getTournamentResultsByRound(t).champion;
    champion.forEach(p => titleCounts.set(p.id, (titleCounts.get(p.id) || 0) + 1));
  });
  if(titleCounts.size > 0){
    body.appendChild(el("div", {class:"bracket-section-title"}, [el("h3", {}, ["Most Titles Here"])]));
    const list = el("div", {class:"record-list"});
    body.appendChild(list);
    renderRecordListInto(list, titleCounts, "titles");
  }

  body.appendChild(el("div", {class:"bracket-section-title"}, [el("h3", {}, ["Year by Year"])]));
  const table = el("table", {class:"data-table"});
  table.innerHTML = "<thead><tr><th>Year</th><th>Tier</th><th>Surface</th><th>Champion</th><th>Runner-up</th><th>Score</th><th></th></tr></thead>";
  const tbody = el("tbody");
  table.appendChild(tbody);
  body.appendChild(table);

  editions.forEach(t => {
    const {champion, runnerUp} = getTournamentResultsByRound(t);
    const finalMatch = state.matches.find(m => m.tournamentId === t.id && (m.bracket || "main") === "main" && m.round === "F");
    const played = matchesForTournament(t.id).length > 0;
    const row = el("tr", {}, [
      el("td", {}, [String(t.year)]),
      el("td", {}, [el("span", {class:"level-tag " + (LEVEL_TAG_CLASSES[t.level] || "")}, [LEVEL_LABELS[t.level] || t.level])]),
      el("td", {}, [el("span", {class:"surface-tag surface-" + t.surface}, [t.surface])]),
      el("td", {html: champion.length ? playersListHTML(champion) : (played ? '<span class="cal-inprogress">In progress</span>' : "—")}),
      el("td", {html: playersListHTML(runnerUp)}),
      el("td", {html: finalMatch ? renderScoreboardHTML(finalMatch) : "—"}),
      el("td", {}, [el("button", {class:"btn btn-small btn-primary", "data-open-bracket": t.id}, ["Bracket"])])
    ]);
    tbody.appendChild(row);
  });
}

let bracketSubTab = "draw";
function switchBracketSubTab(tab){
  bracketSubTab = tab;
  $all(".subtab").forEach(btn => btn.classList.toggle("active", btn.dataset.bracketTab === tab));
  $all(".bracket-subpage").forEach(page => page.classList.toggle("hidden", page.id !== "bracket-subpage-" + tab));

  // Bracket layout measures each card's real rendered height to position
  // everything — that only works while its page is actually visible (a
  // hidden/display:none subtree always measures 0px). Any render that
  // happened while this page was hidden (e.g. generating the draw from the
  // Entry List tab) needs a fresh pass now that it's on-screen.
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  if(tab === "draw"){
    renderBracketRounds(t);
  } else if(tab === "qual" && t.qualifying && t.qualifying.enabled){
    renderQualBracketRounds(t);
  }
}

/* ---------------- WATP Finals UI ---------------- */
function renderFinalsBracketPage(t){
  ensureFinalsGroups(t);

  const head = $("#bracket-head");
  head.innerHTML = "";
  head.appendChild(el("div", {}, [
    el("h2", {}, [t.name]),
    el("div", {class:"profile-meta"}, [
      (t.location ? t.location + " · " : "") + "WATP Finals · " + t.surface + " · " + (t.startDate || t.year) +
      " · 8 players, round robin + knockout"
    ])
  ]));
  const clearBtn = el("button", {class:"btn btn-small btn-danger"}, ["Clear All Results"]);
  clearBtn.addEventListener("click", () => {
    const count = matchesForTournament(t.id).length;
    if(count === 0) return;
    if(confirm("Clear all " + count + " recorded result" + (count===1?"":"s") + " for " + t.name + "? Groups stay intact. This can't be undone.")){
      state.matches = state.matches.filter(m => m.tournamentId !== t.id);
      saveState();
      renderFinalsDraw(t);
      renderRankings();
    }
  });
  head.appendChild(el("div", {class:"controls"}, [clearBtn]));

  $("#normal-draw-heading").classList.add("hidden");
  $("#bracket-draw-container").classList.add("hidden");
  $("#finals-draw-container").classList.remove("hidden");
  $("#normal-entry-content").classList.add("hidden");
  $("#finals-entry-container").classList.remove("hidden");
  $("#bracket-subnav-qual").classList.add("hidden");
  if(bracketSubTab === "qual") switchBracketSubTab("draw");

  renderFinalsGroupSetup(t);
  renderFinalsDraw(t);
}

function renderFinalsGroupSetup(t){
  const container = $("#finals-entry-container");
  container.innerHTML = "";

  // --- Seeding ---
  container.appendChild(el("div", {class:"bracket-section-title"}, [el("h3", {}, ["Seeding"])]));
  container.appendChild(el("p", {class:"modal-help"}, ["Assign seeds 1 through 8, or auto-seed empty slots from a ranking week. Seed 1 anchors Group A, seed 2 anchors Group B, and each remaining pot (3-4, 5-6, 7-8) splits one seed to each group at random."]));

  const weeks = getRankingWeeks();
  const dateOptionsHTML = '<option value="current">Current (Rolling 52-Week)</option>' +
    weeks.map(w => '<option value="' + w + '">Week of ' + formatWeekDate(w) + '</option>').join("");
  const dateRow = el("div", {class:"field-row"});
  const dateLabel = el("label", {}, ["Seed as of"]);
  const dateSelect = el("select", {id:"finals-seed-date", html: dateOptionsHTML});
  dateLabel.appendChild(dateSelect);
  dateRow.appendChild(dateLabel);
  container.appendChild(dateRow);

  const seedActions = el("div", {class:"form-actions"});
  const autoSeedBtn = el("button", {type:"button", class:"btn btn-primary"}, ["Auto-Seed Empty Slots"]);
  const autoGroupBtn = el("button", {type:"button", class:"btn btn-ghost"}, ["Assign Groups from Seeds"]);
  const seedMsg = el("span", {class:"form-msg"}, []);
  autoSeedBtn.addEventListener("click", () => {
    const asOf = rankingDateFromSelectValue(dateSelect.value);
    const ranks = officialRanksAsOf(asOf);
    const used = new Set((t.seeds || []).filter(Boolean));
    const committedElsewhere = playersCommittedInWeek(mondayOf(tournamentDateMs(t)), t.id);
    const candidates = state.players
      .filter(p => !p.retired && !used.has(p.id) && !committedElsewhere.has(p.id))
      .sort((a,b) => (ranks[a.id] || 999999) - (ranks[b.id] || 999999) || a.name.localeCompare(b.name));
    let ci = 0, filled = 0;
    for(let i = 0; i < 8; i++){
      if(!t.seeds[i] && ci < candidates.length){
        t.seeds[i] = candidates[ci].id;
        ci++; filled++;
      }
    }
    saveState();
    seedMsg.textContent = filled > 0 ? "Filled " + filled + " open seed slot" + (filled===1?"":"s") + "." : "All 8 seed slots are already filled.";
    seedMsg.className = "form-msg ok";
    renderFinalsGroupSetup(t);
  });
  autoGroupBtn.addEventListener("click", () => {
    const hasResults = matchesForTournament(t.id).length > 0;
    if(hasResults && !confirm("This re-splits the groups from the current seeds. Since results already exist, they'll be cleared. Continue?")){
      return;
    }
    if(assignFinalsGroupsFromSeeds(t)){
      if(hasResults) state.matches = state.matches.filter(m => m.tournamentId !== t.id);
      saveState();
      renderFinalsGroupSetup(t);
      renderFinalsDraw(t);
      renderRankings();
    }
  });
  seedActions.appendChild(autoSeedBtn);
  seedActions.appendChild(autoGroupBtn);
  seedActions.appendChild(seedMsg);
  container.appendChild(seedActions);

  const seedGrid = el("div", {class:"bracket-seed-grid", style:"margin-top:14px;"});
  for(let i = 0; i < 8; i++){
    const assignedPlayer = t.seeds[i] ? playerById(t.seeds[i]) : null;
    const wrap = el("div", {class:"bracket-seed-slot"});
    wrap.appendChild(el("span", {class:"slot-num"}, ["#" + (i + 1)]));
    const pickerWrap = el("div", {class:"picker-wrap"});
    const input = el("input", {type:"text", class:"picker-input", autocomplete:"off", placeholder:"Search player…", "data-finals-seed-rank": i});
    input.value = assignedPlayer ? assignedPlayer.name : "";
    pickerWrap.appendChild(input);
    if(assignedPlayer){
      pickerWrap.appendChild(el("button", {type:"button", class:"picker-clear", "data-finals-seed-clear": i}, ["\u00d7"]));
    }
    pickerWrap.appendChild(el("div", {class:"picker-suggestions hidden", "data-finals-seed-suggestions": i}));
    wrap.appendChild(pickerWrap);
    seedGrid.appendChild(wrap);
  }
  container.appendChild(seedGrid);

  // --- Groups ---
  container.appendChild(el("div", {class:"bracket-section-title"}, [el("h3", {}, ["Groups"])]));
  container.appendChild(el("p", {class:"modal-help"}, ["Assign exactly 4 players to each group by hand, or use \"Assign Groups from Seeds\" above. Once both are full, switch to the Draw tab to enter round robin results — the semifinals and final unlock automatically once the group stage finishes."]));

  t.groups.forEach(g => {
    const section = el("div", {class:"bracket-section"});
    section.appendChild(el("div", {class:"bracket-section-title"}, [el("h3", {}, [g.name + " (" + g.playerIds.length + "/4)"])]));

    const pickerWrap = el("div", {class:"picker-wrap"});
    const full = g.playerIds.length >= 4;
    const input = el("input", {type:"text", class:"picker-input", autocomplete:"off", placeholder: full ? "Group full" : "Search player to add…", "data-finals-group-search": g.id});
    if(full) input.disabled = true;
    pickerWrap.appendChild(input);
    pickerWrap.appendChild(el("div", {class:"picker-suggestions hidden", "data-finals-group-suggestions": g.id}));
    section.appendChild(pickerWrap);

    const chipsWrap = el("div", {class:"entrant-chips"});
    const players = g.playerIds.map(pid => playerById(pid)).filter(Boolean);
    if(players.length === 0){
      chipsWrap.appendChild(el("p", {class:"picker-empty-note"}, ["No players added yet."]));
    } else {
      players.forEach(p => {
        const chip = el("span", {class:"entrant-chip", html: playerNameHTML(p)});
        chip.appendChild(el("button", {type:"button", class:"entrant-chip-remove", "data-finals-group-remove": g.id + "|" + p.id}, ["\u00d7"]));
        chipsWrap.appendChild(chip);
      });
    }
    section.appendChild(chipsWrap);
    container.appendChild(section);
  });
}

function handleFinalsGroupSearchInput(e){
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;

  const seedRank = e.target.dataset.finalsSeedRank;
  if(seedRank !== undefined){
    const query = e.target.value;
    const suggestionsEl = document.querySelector('[data-finals-seed-suggestions="' + seedRank + '"]');
    if(!query.trim()){ suggestionsEl.classList.add("hidden"); suggestionsEl.innerHTML = ""; return; }
    const committedElsewhere = playersCommittedInWeek(mondayOf(tournamentDateMs(t)), t.id);
    const usedElsewhere = new Set((t.seeds || []).filter((id, idx) => id && String(idx) !== seedRank));
    const results = state.players.filter(p => !p.retired && !usedElsewhere.has(p.id) && !committedElsewhere.has(p.id)).filter(p => matchesSearch(p.name, query)).slice(0, 8);
    suggestionsEl.innerHTML = results.length
      ? results.map(p => '<button type="button" class="picker-option" data-finals-seed-pick="' + seedRank + '|' + p.id + '">' + playerNameHTML(p) + '</button>').join("")
      : '<div class="picker-empty">No match</div>';
    suggestionsEl.classList.remove("hidden");
    return;
  }

  const groupId = e.target.dataset.finalsGroupSearch;
  if(!groupId) return;
  const query = e.target.value;
  const suggestionsEl = document.querySelector('[data-finals-group-suggestions="' + groupId + '"]');
  if(!query.trim()){ suggestionsEl.classList.add("hidden"); suggestionsEl.innerHTML = ""; return; }
  const committedElsewhereGroup = playersCommittedInWeek(mondayOf(tournamentDateMs(t)), t.id);
  const usedIds = new Set(t.groups.flatMap(g => g.playerIds));
  const results = state.players.filter(p => !p.retired && !usedIds.has(p.id) && !committedElsewhereGroup.has(p.id)).filter(p => matchesSearch(p.name, query)).slice(0, 8);
  suggestionsEl.innerHTML = results.length
    ? results.map(p => '<button type="button" class="picker-option" data-finals-group-pick="' + groupId + '|' + p.id + '">' + playerNameHTML(p) + '</button>').join("")
    : '<div class="picker-empty">No match</div>';
  suggestionsEl.classList.remove("hidden");
}

function handleFinalsEntryClick(e){
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;

  const seedPickBtn = e.target.closest("[data-finals-seed-pick]");
  if(seedPickBtn){
    const [rankStr, pid] = seedPickBtn.dataset.finalsSeedPick.split("|");
    t.seeds[Number(rankStr)] = pid;
    saveState();
    renderFinalsGroupSetup(t);
    return;
  }
  const seedClearBtn = e.target.closest("[data-finals-seed-clear]");
  if(seedClearBtn){
    t.seeds[Number(seedClearBtn.dataset.finalsSeedClear)] = null;
    saveState();
    renderFinalsGroupSetup(t);
    return;
  }

  const pickBtn = e.target.closest("[data-finals-group-pick]");
  if(pickBtn){
    const [groupId, pid] = pickBtn.dataset.finalsGroupPick.split("|");
    const group = t.groups.find(g => g.id === groupId);
    if(group && group.playerIds.length < 4 && !group.playerIds.includes(pid)){
      group.playerIds.push(pid);
      saveState();
      renderFinalsGroupSetup(t);
      renderFinalsDraw(t);
    }
    return;
  }
  const rmBtn = e.target.closest("[data-finals-group-remove]");
  if(rmBtn){
    const [groupId, pid] = rmBtn.dataset.finalsGroupRemove.split("|");
    const group = t.groups.find(g => g.id === groupId);
    if(group){
      group.playerIds = group.playerIds.filter(id => id !== pid);
      state.matches = state.matches.filter(m => !(m.tournamentId === t.id && (m.playerAId === pid || m.playerBId === pid)));
      saveState();
      renderFinalsGroupSetup(t);
      renderFinalsDraw(t);
      renderRankings();
    }
  }
}

function groupStandingsHTML(t, g){
  const rows = computeGroupStandings(t, g);
  let html = '<table class="data-table rr-standings"><thead><tr><th>Player</th><th>W</th><th>L</th><th>Sets</th><th>Games</th></tr></thead><tbody>';
  rows.forEach((r, i) => {
    const p = playerById(r.pid);
    html += '<tr' + (i < 2 ? ' class="rr-advancing"' : '') + '>' +
      '<td>' + (p ? playerLinkHTML(p) : "?") + '</td>' +
      '<td>' + r.wins + '</td>' + '<td>' + r.losses + '</td>' +
      '<td>' + r.setsWon + '-' + r.setsLost + '</td>' +
      '<td>' + r.gamesWon + '-' + r.gamesLost + '</td>' +
      '</tr>';
  });
  html += '</tbody></table>';
  return html;
}

function buildFinalsScoreForm(onSave){
  const form = el("div", {class:"bracket-match-form"});
  const setRow = el("div", {class:"bracket-sets-row"});
  const setInputs = [];
  for(let i = 1; i <= 3; i++){
    const box = el("div", {class:"set-box"});
    box.appendChild(el("span", {}, ["S" + i]));
    const inner = el("div", {style:"display:flex;gap:2px;"});
    const a = el("input", {type:"number", min:"0", max:"30"});
    const b = el("input", {type:"number", min:"0", max:"30"});
    inner.appendChild(a); inner.appendChild(b);
    box.appendChild(inner);
    setRow.appendChild(box);
    setInputs.push({a, b});
  }
  form.appendChild(setRow);
  const errMsg = el("div", {class:"form-msg"}, []);
  form.appendChild(errMsg);
  function evaluateAndMaybeSave(){
    errMsg.textContent = "";
    let sets = [];
    for(const pair of setInputs){
      const av = pair.a.value, bv = pair.b.value;
      if(av === "" && bv === "") continue;
      if(av === "" || bv === "") return;
      const an = Number(av), bn = Number(bv);
      if(an === bn){ errMsg.textContent = "A set can't end in a tie."; return; }
      sets.push({a: an, b: bn});
    }
    if(sets.length === 0) return;
    let aSets = 0, bSets = 0;
    sets.forEach(s => { if(s.a > s.b) aSets++; else bSets++; });
    if(aSets < 2 && bSets < 2) return;
    onSave(aSets > bSets, sets);
  }
  setInputs.forEach(pair => {
    pair.a.addEventListener("input", evaluateAndMaybeSave);
    pair.b.addEventListener("input", evaluateAndMaybeSave);
  });
  return form;
}

function buildRRMatchCard(t, g, slotIdx, pair){
  const existingMatch = state.matches.find(m => m.tournamentId === t.id && m.bracket === "rr" && m.group === g.id && m.slot === slotIdx);
  const pA = playerById(pair[0]), pB = playerById(pair[1]);
  const card = el("div", {class:"bracket-match status-" + (existingMatch ? "played" : "ready")});
  const body = el("div", {class:"bracket-match-body"});
  const names = el("div", {class:"bracket-match-names"});
  [[pA, pair[0]], [pB, pair[1]]].forEach(([p, pid]) => {
    const isWinner = existingMatch && existingMatch.winnerId === pid;
    const seedNum = seedNumberForPlayer(t, pid);
    const badge = seedNum ? '<span class="seed-badge">' + seedNum + '</span>' : "";
    const row = el("div", {class:"bracket-slot" + (isWinner ? " slot-winner" : "")});
    row.appendChild(el("span", {class:"slot-name", html: badge + (p ? playerLinkHTML(p) : "?")}));
    names.appendChild(row);
  });
  body.appendChild(names);
  if(existingMatch) body.appendChild(el("div", {class:"bracket-match-score", html: renderScoreboardHTML(existingMatch)}));
  card.appendChild(body);

  if(!existingMatch && pair[0] && pair[1]){
    const h2hBtn = el("button", {type:"button", class:"h2h-inline-badge", title:"View head-to-head record"}, ["H2H"]);
    h2hBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openH2HPopup(pair[0], pair[1]);
    });
    card.appendChild(h2hBtn);
  }

  if(existingMatch){
    const clearX = el("button", {type:"button", class:"clear-x", title:"Clear result"}, ["\u00d7"]);
    clearX.addEventListener("click", (e) => {
      e.stopPropagation();
      if(confirm("Clear this result?")){
        state.matches = state.matches.filter(m => m.id !== existingMatch.id);
        saveState();
        renderFinalsDraw(t);
        renderRankings();
      }
    });
    card.appendChild(clearX);
  } else {
    card.appendChild(buildFinalsScoreForm((aWon, sets) => {
      state.matches.push({
        id: uid("m"), tournamentId: t.id, bracket:"rr", group: g.id, round:"RR", slot: slotIdx,
        playerAId: pair[0], playerBId: pair[1], winnerId: aWon ? pair[0] : pair[1],
        walkover:false, sets, createdAt: Date.now()
      });
      saveState();
      renderFinalsDraw(t);
      renderRankings();
    }));
  }
  return card;
}

function buildKnockoutMatchCard(t, round, slot, pidA, pidB){
  const existingMatch = state.matches.find(m => m.tournamentId === t.id && (m.bracket||"main") === "main" && m.round === round && m.slot === slot);
  const pA = pidA ? playerById(pidA) : null, pB = pidB ? playerById(pidB) : null;
  const card = el("div", {class:"bracket-match status-" + (existingMatch ? "played" : "ready")});
  const body = el("div", {class:"bracket-match-body"});
  const names = el("div", {class:"bracket-match-names"});
  [[pA, pidA], [pB, pidB]].forEach(([p, pid]) => {
    const isWinner = existingMatch && existingMatch.winnerId === pid;
    const seedNum = pid ? seedNumberForPlayer(t, pid) : null;
    const badge = seedNum ? '<span class="seed-badge">' + seedNum + '</span>' : "";
    const row = el("div", {class:"bracket-slot" + (isWinner ? " slot-winner" : "")});
    row.appendChild(el("span", {class:"slot-name", html: p ? (badge + playerLinkHTML(p)) : "TBD"}));
    names.appendChild(row);
  });
  body.appendChild(names);
  if(existingMatch) body.appendChild(el("div", {class:"bracket-match-score", html: renderScoreboardHTML(existingMatch)}));
  card.appendChild(body);

  if(!existingMatch && pidA && pidB){
    const h2hBtn = el("button", {type:"button", class:"h2h-inline-badge", title:"View head-to-head record"}, ["H2H"]);
    h2hBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openH2HPopup(pidA, pidB);
    });
    card.appendChild(h2hBtn);
  }

  if(existingMatch){
    const clearX = el("button", {type:"button", class:"clear-x", title:"Clear result"}, ["\u00d7"]);
    clearX.addEventListener("click", (e) => {
      e.stopPropagation();
      if(confirm("Clear this result?" + (round === "SF" ? " The Final will be cleared too." : ""))){
        state.matches = state.matches.filter(m => !(m.tournamentId === t.id && (m.bracket||"main") === "main" && m.round === round && m.slot === slot));
        if(round === "SF"){
          state.matches = state.matches.filter(m => !(m.tournamentId === t.id && (m.bracket||"main") === "main" && m.round === "F"));
        }
        saveState();
        renderFinalsDraw(t);
        renderRankings();
      }
    });
    card.appendChild(clearX);
  } else if(pA && pB){
    card.appendChild(buildFinalsScoreForm((aWon, sets) => {
      state.matches.push({
        id: uid("m"), tournamentId: t.id, bracket:"main", round, slot,
        playerAId: pidA, playerBId: pidB, winnerId: aWon ? pidA : pidB,
        walkover:false, sets, createdAt: Date.now()
      });
      saveState();
      renderFinalsDraw(t);
      renderRankings();
    }));
  } else {
    card.appendChild(el("p", {class:"picker-empty-note", style:"padding:8px 10px;"}, ["Waiting on the group stage."]));
  }
  return card;
}

function renderFinalsDraw(t){
  const container = $("#finals-draw-container");
  container.innerHTML = "";

  if(t.groups[0].playerIds.length < 4 || t.groups[1].playerIds.length < 4){
    container.appendChild(el("p", {class:"picker-empty-note"}, ["Add 4 players to each group (Entry List tab) to begin."]));
    return;
  }

  t.groups.forEach(g => {
    container.appendChild(el("div", {class:"bracket-section-title"}, [el("h3", {}, [g.name])]));
    container.appendChild(el("div", {html: groupStandingsHTML(t, g)}));

    const pairs = finalsScheduledPairs(t, g);
    FINALS_DAY_SCHEDULE.forEach((d, dayIdx) => {
      container.appendChild(el("div", {class:"rr-day-heading"}, [d.label]));
      const matchGrid = el("div", {class:"rr-matches-grid"});
      d.pairs.forEach((_, i) => {
        const slotIdx = dayIdx * 2 + i;
        matchGrid.appendChild(buildRRMatchCard(t, g, slotIdx, pairs[slotIdx]));
      });
      container.appendChild(matchGrid);
    });
  });

  container.appendChild(el("div", {class:"bracket-section-title"}, [el("h3", {}, ["Knockout"])]));
  const pairing = getFinalsSemifinalPairing(t);
  if(!pairing){
    container.appendChild(el("p", {class:"picker-empty-note"}, ["Finish all 12 round robin matches (6 per group) to set the semifinals."]));
    return;
  }
  const knockout = el("div", {class:"finals-knockout"});
  const sfCol = el("div", {class:"finals-knockout-col"});
  sfCol.appendChild(el("div", {class:"bracket-round-title"}, ["Semifinals"]));
  const sfWinners = [];
  pairing.forEach((pair, idx) => {
    sfCol.appendChild(buildKnockoutMatchCard(t, "SF", idx, pair.a, pair.b));
    const sfMatch = state.matches.find(m => m.tournamentId === t.id && (m.bracket||"main") === "main" && m.round === "SF" && m.slot === idx);
    if(sfMatch) sfWinners.push(sfMatch.winnerId);
  });
  knockout.appendChild(sfCol);

  const fCol = el("div", {class:"finals-knockout-col"});
  fCol.appendChild(el("div", {class:"bracket-round-title"}, ["Final"]));
  fCol.appendChild(buildKnockoutMatchCard(t, "F", 0, sfWinners[0] || null, sfWinners[1] || null));
  knockout.appendChild(fCol);

  container.appendChild(knockout);
}

function renderBracketPage(){
  const t = tournamentById(currentBracketTournamentId);
  if(!t){ closeBracket(); return; }

  if(t.level === "FINALS"){
    renderFinalsBracketPage(t);
    return;
  }

  $("#normal-draw-heading").classList.remove("hidden");
  $("#bracket-draw-container").classList.remove("hidden");
  $("#finals-draw-container").classList.add("hidden");
  $("#normal-entry-content").classList.remove("hidden");
  $("#finals-entry-container").classList.add("hidden");

  ensureBracketEntries(t);
  ensureQualifyingEntries(t);
  const cap = capacityOf(t.drawSize);
  const nByes = numByesFor(t.drawSize);

  const head = $("#bracket-head");
  head.innerHTML = "";
  const defChamp = getDefendingChampion(t);
  head.appendChild(el("div", {}, [
    el("h2", {}, [t.name]),
    el("div", {class:"profile-meta"}, [
      (t.location ? t.location + " · " : "") +
      (LEVEL_LABELS[t.level] || t.level) + " · " + t.surface + " · " + (t.startDate || t.year) +
      " · Draw of " + t.drawSize + (nByes ? " (" + cap + "-slot bracket, " + nByes + " bye" + (nByes===1?"":"s") + ")" : "")
    ]),
    defChamp && defChamp.player ? el("div", {class:"defending-champ-line", html:
      '\uD83C\uDFC6 Defending Champion: ' + playerLinkHTML(defChamp.player) + ' (' + defChamp.edition.year + ')'
    }) : null
  ].filter(Boolean)));
  const controls = el("div", {class:"controls"});
  const sizeLabel = el("label", {}, ["Draw size"]);
  const sizeSelect = el("select");
  DRAW_SIZE_OPTIONS.forEach(n => {
    const opt = el("option", {value:n}, [String(n)]);
    if(n === t.drawSize) opt.setAttribute("selected", "selected");
    sizeSelect.appendChild(opt);
  });
  sizeSelect.addEventListener("change", () => {
    const newSize = Number(sizeSelect.value);
    if(newSize === t.drawSize) return;
    if(!confirm("Changing draw size clears this tournament's main-draw seeds, entrants, and results. Qualifying is untouched. Continue?")){
      sizeSelect.value = String(t.drawSize);
      return;
    }
    t.drawSize = newSize;
    t.bracketEntries = new Array(capacityOf(newSize)).fill(0).map(() => ({type:"empty"}));
    t.seeds = new Array(numSeedsFor(newSize)).fill(null);
    t.unseededEntrants = [];
    state.matches = state.matches.filter(m => !(m.tournamentId === t.id && (m.bracket || "main") === "main"));
    saveState();
    renderBracketPage();
    renderRankings();
  });
  sizeLabel.appendChild(sizeSelect);
  controls.appendChild(sizeLabel);

  const clearBtn = el("button", {class:"btn btn-small btn-danger"}, ["Clear All Results"]);
  clearBtn.addEventListener("click", () => {
    const count = matchesForTournament(t.id).length;
    if(count === 0) return;
    if(confirm("Clear all " + count + " recorded result" + (count===1?"":"s") + " for " + t.name + " (main draw and qualifying)? The seeded draws stay intact. This can't be undone.")){
      state.matches = state.matches.filter(m => m.tournamentId !== t.id);
      saveState();
      withScrollPreserved(() => {
        renderBracketRounds(t);
        renderQualBracketRounds(t);
      });
      renderRankings();
    }
  });
  controls.appendChild(clearBtn);
  head.appendChild(controls);

  populateBracketDateSelects(t);
  renderQualifyingConfig(t);
  renderEntryListBody(t);

  $("#bracket-numseeds-label").textContent = numSeedsFor(t.drawSize);
  renderBracketSeedsList(t);
  renderBracketUnseededList(t);
  renderBracketSeedGrid(t);
  renderBracketRounds(t);
}

function populateBracketDateSelects(t){
  const weeks = getRankingWeeks();
  const optionsHTML = '<option value="current">Current (Rolling 52-Week)</option>' +
    weeks.map(w => '<option value="' + w + '">Week of ' + formatWeekDate(w) + '</option>').join("");
  ["#bracket-entry-date", "#bracket-seed-date"].forEach(sel => {
    const el2 = $(sel);
    const prev = el2.value;
    el2.innerHTML = optionsHTML;
    if(prev && (prev === "current" || weeks.includes(Number(prev)))) el2.value = prev;
  });
}
function rankingDateFromSelectValue(val){
  return val === "current" ? mondayOf(getLatestActiveDate()) : Number(val);
}

function renderQualifyingConfig(t){
  const q = t.qualifying;
  $("#qual-enabled").checked = q.enabled;
  $("#qual-numqualifiers").value = String(q.numQualifiers);
  $("#qual-numrounds").value = String(q.numRounds);
  $("#qual-body").classList.toggle("hidden", !q.enabled);
  $("#bracket-subnav-qual").classList.toggle("hidden", !q.enabled);
  // If qualifying just got disabled while its sub-tab was open, fall back to the Draw tab.
  if(!q.enabled && bracketSubTab === "qual") switchBracketSubTab("draw");
  if(q.enabled){
    renderQualEntrantsList(t);
    renderQualBracketRounds(t);
  }
}

function renderBracketSeedsList(t){
  const list = $("#bracket-seeds-list");
  list.innerHTML = "";
  const nSeeds = numSeedsFor(t.drawSize);
  for(let i = 0; i < nSeeds; i++){
    const assignedPlayer = t.seeds[i] ? playerById(t.seeds[i]) : null;
    const wrap = el("div", {class:"bracket-seed-slot"});
    wrap.appendChild(el("span", {class:"slot-num"}, ["#" + (i+1)]));
    const pickerWrap = el("div", {class:"picker-wrap"});
    const input = el("input", {type:"text", class:"picker-input", "data-seed-rank": i, autocomplete:"off", placeholder:"Search player…"});
    input.value = assignedPlayer ? assignedPlayer.name : "";
    pickerWrap.appendChild(input);
    if(assignedPlayer){
      pickerWrap.appendChild(el("button", {type:"button", class:"picker-clear", "data-seed-clear-rank": i}, ["\u00d7"]));
    }
    pickerWrap.appendChild(el("div", {class:"picker-suggestions hidden", "data-seed-suggestions": i}));
    wrap.appendChild(pickerWrap);
    list.appendChild(wrap);
  }
  updateBracketFillStatus(t);
}

function handleSeedSearchInput(e){
  if(!e.target.matches(".picker-input[data-seed-rank]")) return;
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  const rank = Number(e.target.dataset.seedRank);
  const query = e.target.value;
  const suggestionsEl = $('.picker-suggestions[data-seed-suggestions="' + rank + '"]');
  if(!query.trim()){ suggestionsEl.classList.add("hidden"); suggestionsEl.innerHTML = ""; return; }
  const usedElsewhere = new Set((t.seeds || []).filter((id, idx) => id && idx !== rank));
  const committedElsewhere = playersCommittedInWeek(mondayOf(tournamentDateMs(t)), t.id);
  const results = state.players
    .filter(p => !p.retired && !usedElsewhere.has(p.id) && !committedElsewhere.has(p.id))
    .filter(p => matchesSearch(p.name, query))
    .slice(0, 8);
  suggestionsEl.innerHTML = results.length
    ? results.map(p => '<button type="button" class="picker-option" data-seed-pick="' + rank + '" data-player-id="' + p.id + '">' + playerNameHTML(p) + '</button>').join("")
    : '<div class="picker-empty">No match</div>';
  suggestionsEl.classList.remove("hidden");
}

function handleSeedsListClick(e){
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  const pickBtn = e.target.closest("[data-seed-pick]");
  if(pickBtn){
    const rank = Number(pickBtn.dataset.seedPick);
    const pid = pickBtn.dataset.playerId;
    t.seeds[rank] = pid;
    t.unseededEntrants = (t.unseededEntrants || []).filter(id => id !== pid);
    saveState();
    renderBracketSeedsList(t);
    renderBracketUnseededList(t);
    return;
  }
  const clearBtn = e.target.closest("[data-seed-clear-rank]");
  if(clearBtn){
    const rank = Number(clearBtn.dataset.seedClearRank);
    t.seeds[rank] = null;
    saveState();
    renderBracketSeedsList(t);
    renderBracketUnseededList(t);
  }
}

function renderBracketUnseededList(t){
  const container = $("#bracket-unseeded-list");
  container.innerHTML = "";
  const pickerWrap = el("div", {class:"picker-wrap"});
  pickerWrap.appendChild(el("input", {type:"text", class:"picker-input", "data-entrant-search":"1", autocomplete:"off", placeholder:"Search player to add…"}));
  pickerWrap.appendChild(el("div", {class:"picker-suggestions hidden", "data-entrant-suggestions":"1"}));
  container.appendChild(pickerWrap);

  const chipsWrap = el("div", {class:"entrant-chips"});
  const entrants = (t.unseededEntrants || []).map(id => playerById(id)).filter(Boolean).sort((a,b) => a.name.localeCompare(b.name));
  if(entrants.length === 0){
    chipsWrap.appendChild(el("p", {class:"picker-empty-note"}, ["No unseeded entrants added yet — search above to add them."]));
  } else {
    entrants.forEach(p => {
      const chip = el("span", {class:"entrant-chip", html: playerNameHTML(p)});
      chip.appendChild(el("button", {type:"button", class:"entrant-chip-remove", "data-entrant-remove": p.id}, ["\u00d7"]));
      chipsWrap.appendChild(chip);
    });
  }
  container.appendChild(chipsWrap);
  updateBracketFillStatus(t);
}

// "X / Y in the main draw field" — Y accounts for slots reserved for qualifiers.
function updateBracketFillStatus(t){
  const statusEl = $("#bracket-fill-status");
  if(!statusEl) return;
  const directSlots = Math.max(0, t.drawSize - (t.qualifying && t.qualifying.enabled ? t.qualifying.numQualifiers : 0));
  const filled = t.seeds.filter(Boolean).length + (t.unseededEntrants || []).length;
  const complete = filled >= directSlots;
  statusEl.textContent = filled + " / " + directSlots + " in the main draw field" +
    (complete ? " — field complete" : " — " + (directSlots - filled) + " more needed");
  statusEl.classList.toggle("complete", complete);
}

function handleEntrantSearchInput(e){
  if(!e.target.matches("[data-entrant-search]")) return;
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  const query = e.target.value;
  const suggestionsEl = $('[data-entrant-suggestions]');
  if(!query.trim()){ suggestionsEl.classList.add("hidden"); suggestionsEl.innerHTML = ""; return; }
  const seededIds = new Set((t.seeds || []).filter(Boolean));
  const existingIds = new Set(t.unseededEntrants || []);
  const committedElsewhere = playersCommittedInWeek(mondayOf(tournamentDateMs(t)), t.id);
  const results = state.players
    .filter(p => !p.retired && !seededIds.has(p.id) && !existingIds.has(p.id) && !committedElsewhere.has(p.id))
    .filter(p => matchesSearch(p.name, query))
    .slice(0, 8);
  suggestionsEl.innerHTML = results.length
    ? results.map(p => '<button type="button" class="picker-option" data-entrant-pick="' + p.id + '">' + playerNameHTML(p) + '</button>').join("")
    : '<div class="picker-empty">No match</div>';
  suggestionsEl.classList.remove("hidden");
}

function handleUnseededListClick(e){
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  const pickBtn = e.target.closest("[data-entrant-pick]");
  if(pickBtn){
    const pid = pickBtn.dataset.entrantPick;
    const set = new Set(t.unseededEntrants || []);
    set.add(pid);
    t.unseededEntrants = Array.from(set);
    saveState();
    renderBracketUnseededList(t);
    return;
  }
  const rmBtn = e.target.closest("[data-entrant-remove]");
  if(rmBtn){
    const pid = rmBtn.dataset.entrantRemove;
    t.unseededEntrants = (t.unseededEntrants || []).filter(id => id !== pid);
    t.qualifierIds = (t.qualifierIds || []).filter(id => id !== pid);
    saveState();
    renderBracketUnseededList(t);
  }
}

function handleGenerateDraw(){
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  const msg = $("#bracket-generate-msg");
  const filledSeeds = t.seeds.filter(Boolean).length;
  const totalEntrants = filledSeeds + (t.unseededEntrants || []).length;
  if(totalEntrants === 0){
    msg.textContent = "Assign at least a few seeds or entrants first.";
    msg.className = "form-msg";
    return;
  }
  if(state.matches.some(m => m.tournamentId === t.id && (m.bracket||"main")==="main") &&
     !confirm("This tournament already has recorded results. Generating a new draw clears them. Continue?")){
    return;
  }
  generateDraw(t);
  saveState();
  msg.textContent = "Draw generated.";
  msg.className = "form-msg ok";
  renderBracketSeedGrid(t);
  renderBracketRounds(t);
  renderRankings();
}

/* ---------------- Qualifying UI ---------------- */
function renderQualEntrantsList(t){
  const container = $("#qual-entrants-list");
  container.innerHTML = "";
  const pickerWrap = el("div", {class:"picker-wrap"});
  pickerWrap.appendChild(el("input", {type:"text", class:"picker-input", "data-qual-entrant-search":"1", autocomplete:"off", placeholder:"Search player to add…"}));
  pickerWrap.appendChild(el("div", {class:"picker-suggestions hidden", "data-qual-entrant-suggestions":"1"}));
  container.appendChild(pickerWrap);

  const chipsWrap = el("div", {class:"entrant-chips"});
  const entrants = (t.qualifying.entrants || []).map(id => playerById(id)).filter(Boolean).sort((a,b) => a.name.localeCompare(b.name));
  if(entrants.length === 0){
    chipsWrap.appendChild(el("p", {class:"picker-empty-note"}, ["No qualifying entrants added yet — search above to add them."]));
  } else {
    entrants.forEach(p => {
      const chip = el("span", {class:"entrant-chip", html: playerNameHTML(p)});
      chip.appendChild(el("button", {type:"button", class:"entrant-chip-remove", "data-qual-entrant-remove": p.id}, ["\u00d7"]));
      chipsWrap.appendChild(chip);
    });
  }
  container.appendChild(chipsWrap);
  updateQualFillStatus(t);
}

// "X / Y in the qualifying field" — Y is the full qualifying bracket capacity.
function updateQualFillStatus(t){
  const statusEl = $("#qual-fill-status");
  if(!statusEl) return;
  const cap = t.qualifying.numQualifiers * Math.pow(2, t.qualifying.numRounds);
  const filled = (t.qualifying.entrants || []).length;
  const complete = filled >= cap;
  statusEl.textContent = filled + " / " + cap + " in the qualifying field" +
    (complete ? " — field complete" : " — " + (cap - filled) + " more needed");
  statusEl.classList.toggle("complete", complete);
}

function handleQualEntrantSearchInput(e){
  if(!e.target.matches("[data-qual-entrant-search]")) return;
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  const query = e.target.value;
  const suggestionsEl = $('[data-qual-entrant-suggestions]');
  if(!query.trim()){ suggestionsEl.classList.add("hidden"); suggestionsEl.innerHTML = ""; return; }
  const existingIds = new Set(t.qualifying.entrants || []);
  const committedElsewhere = playersCommittedInWeek(mondayOf(tournamentDateMs(t)), t.id);
  const results = state.players
    .filter(p => !p.retired && !existingIds.has(p.id) && !committedElsewhere.has(p.id))
    .filter(p => matchesSearch(p.name, query))
    .slice(0, 8);
  suggestionsEl.innerHTML = results.length
    ? results.map(p => '<button type="button" class="picker-option" data-qual-entrant-pick="' + p.id + '">' + playerNameHTML(p) + '</button>').join("")
    : '<div class="picker-empty">No match</div>';
  suggestionsEl.classList.remove("hidden");
}

function handleQualEntrantsListClick(e){
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  const pickBtn = e.target.closest("[data-qual-entrant-pick]");
  if(pickBtn){
    const pid = pickBtn.dataset.qualEntrantPick;
    const set = new Set(t.qualifying.entrants || []);
    set.add(pid);
    t.qualifying.entrants = Array.from(set);
    saveState();
    renderQualEntrantsList(t);
    return;
  }
  const rmBtn = e.target.closest("[data-qual-entrant-remove]");
  if(rmBtn){
    const pid = rmBtn.dataset.qualEntrantRemove;
    t.qualifying.entrants = (t.qualifying.entrants || []).filter(id => id !== pid);
    saveState();
    renderQualEntrantsList(t);
  }
}

function handleQualConfigChange(){
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  const enabled = $("#qual-enabled").checked;
  const numQualifiers = Number($("#qual-numqualifiers").value) || 8;
  const numRounds = Number($("#qual-numrounds").value) || 2;
  const sizeChanged = numQualifiers !== t.qualifying.numQualifiers || numRounds !== t.qualifying.numRounds;
  const hasResults = matchesForQualifying(t.id).length > 0;
  if(sizeChanged && hasResults && !confirm("Changing the qualifying format clears its entrants and recorded results. Continue?")){
    renderQualifyingConfig(t);
    return;
  }
  t.qualifying.enabled = enabled;
  if(sizeChanged){
    t.qualifying.numQualifiers = numQualifiers;
    t.qualifying.numRounds = numRounds;
    t.qualifying.entrants = [];
    state.matches = state.matches.filter(m => !(m.tournamentId === t.id && m.bracket === "qual"));
  }
  ensureQualifyingEntries(t);
  saveState();
  renderQualifyingConfig(t);
  renderRankings();
}

function handleGenerateQualifyingDraw(){
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  const msg = $("#qual-generate-msg");
  const entrantCount = (t.qualifying.entrants || []).length;
  const cap = t.qualifying.numQualifiers * Math.pow(2, t.qualifying.numRounds);
  if(entrantCount === 0){
    msg.textContent = "Add at least a few qualifying entrants first.";
    msg.className = "form-msg";
    return;
  }
  if(entrantCount > cap){
    msg.textContent = "You've added " + entrantCount + " entrants but the qualifying draw only holds " + cap + " — extras won't be placed.";
    msg.className = "form-msg";
  }
  if(matchesForQualifying(t.id).length > 0 &&
     !confirm("This qualifying draw already has recorded results. Generating a new draw clears them. Continue?")){
    return;
  }
  generateQualifyingDraw(t);
  saveState();
  if(!msg.textContent || msg.className === "form-msg ok"){
    msg.textContent = "Qualifying draw generated.";
    msg.className = "form-msg ok";
  }
  renderQualBracketRounds(t);
  renderRankings();
}

function handleAddQualifiersToMain(){
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  const msg = $("#qual-add-msg");
  const results = computeQualifyingResults(t);
  const qualifiedIds = [];
  results.forEach((res, pid) => { if(res.code === "QUALIFIED") qualifiedIds.push(pid); });
  if(qualifiedIds.length === 0){
    msg.textContent = "No qualifiers yet — finish the qualifying draw first.";
    msg.className = "form-msg";
    return;
  }
  const seededIds = new Set((t.seeds || []).filter(Boolean));
  const existing = new Set(t.unseededEntrants || []);
  const qualifierSet = new Set(t.qualifierIds || []);
  let added = 0;
  qualifiedIds.forEach(pid => {
    qualifierSet.add(pid);
    if(!seededIds.has(pid) && !existing.has(pid)){ existing.add(pid); added++; }
  });
  t.unseededEntrants = Array.from(existing);
  t.qualifierIds = Array.from(qualifierSet);
  saveState();
  msg.textContent = added > 0
    ? "Added " + added + " qualifier" + (added===1?"":"s") + " to the main draw's unseeded entrants (marked with a Q)."
    : "All qualifiers are already in the main draw field.";
  msg.className = "form-msg ok";
  renderBracketUnseededList(t);
  renderBracketRounds(t);
}

const BRACKET_TITLE_OFFSET = 22;
const BRACKET_ROW_GAP = 5;
const SECTION_SIZE = 8; // matches per section (16 players) in the first round
const SECTION_LABEL_H = 24;

// Lays out a bracket by actually measuring each card's real rendered height
// (instead of assuming a uniform row height), so a round full of short
// "played" or "TBD" cards collapses down like a normal results table, and
// only whichever round is actively being played takes up real space for its
// score-entry form. Later rounds are centered on the midpoint of their two
// feeders' *measured* centers, computed round by round left to right.
function layoutBracketColumns(wrap, rounds, cardBuilder, titleFor){
  wrap.innerHTML = "";
  let prevCenters = null;
  let maxBottom = 0;
  const cols = [];

  rounds.forEach((roundObj, r) => {
    const col = el("div", {class:"bracket-round"});
    col.appendChild(el("div", {class:"bracket-round-title"}, [titleFor(roundObj)]));
    wrap.appendChild(col);
    cols.push(col);

    const cardEls = roundObj.matches.map(m => {
      const card = cardBuilder(m);
      card.style.position = "absolute";
      card.style.left = "0";
      card.style.right = "0";
      card.style.top = "0px";
      card.style.margin = "0";
      col.appendChild(card);
      return card;
    });
    const heights = cardEls.map(c => c.offsetHeight);
    const centers = [];

    if(r === 0){
      // A first round with more than one section's worth of matches gets a
      // "Section N" label every 16 players (8 matches), purely as a visual
      // wayfinding aid — the underlying centering math is untouched, later
      // rounds just follow whatever centers this produces, same as always.
      const showSections = roundObj.matches.length > SECTION_SIZE;
      let cum = BRACKET_TITLE_OFFSET;
      let sectionNum = 0;
      heights.forEach((h, i) => {
        if(showSections && i % SECTION_SIZE === 0){
          sectionNum++;
          const label = el("div", {class:"bracket-section-label"}, ["Section " + sectionNum]);
          label.style.position = "absolute";
          label.style.top = cum + "px";
          label.style.left = "0";
          label.style.right = "0";
          col.appendChild(label);
          cum += SECTION_LABEL_H;
        }
        cardEls[i].style.top = cum + "px";
        centers.push(cum + h / 2);
        cum += h + BRACKET_ROW_GAP;
      });
      maxBottom = Math.max(maxBottom, cum - BRACKET_ROW_GAP);
    } else {
      heights.forEach((h, i) => {
        const c = (prevCenters[i*2] + prevCenters[i*2+1]) / 2;
        cardEls[i].style.top = (c - h / 2) + "px";
        centers.push(c);
        maxBottom = Math.max(maxBottom, c + h / 2);
      });
    }
    prevCenters = centers;
  });

  cols.forEach(col => { col.style.height = maxBottom + "px"; });
}

function renderQualBracketRounds(t){
  const wrap = $("#qual-bracket-wrap");
  const rounds = computeQualifyingBracket(t);
  layoutBracketColumns(wrap, rounds, (m) => buildQualMatchCard(t, m), (roundObj) => roundObj.round);
}

function buildQualSlotRow(t, slot, m){
  let nameHTML, extraClass = "";
  if(slot.type === "player"){
    const p = playerById(slot.playerId);
    const isWC = isQualifyingWildCard(t, slot.playerId);
    const isPR = isQualifyingProtectedRanking(t, slot.playerId);
    const badges = (isWC ? '<span class="wc-badge">WC</span>' : "") + (isPR ? '<span class="pr-badge">PR</span>' : "");
    nameHTML = badges + (p ? (m.status === "ready" ? playerNameHTML(p) : playerLinkHTML(p)) : "(removed player)");
  } else {
    nameHTML = "TBD"; extraClass = " slot-empty";
  }
  const isWinner = m.status !== "ready" && m.winnerSlot && slot.type === "player" && m.winnerSlot.playerId === slot.playerId;
  const isWalkoverClickable = m.status === "ready" && slot.type === "player";
  const row = el("div", {class: "bracket-slot" + (isWinner ? " slot-winner" : "") + extraClass + (isWalkoverClickable ? " slot-walkover-target" : "")});
  row.appendChild(el("span", {class:"slot-name", html: nameHTML}));
  if(m.status === "played" && m.existingMatch && slot.type === "player"){
    row.appendChild(el("span", {html: slotScoreHTML(m.existingMatch, slot.playerId)}));
  }
  if(isWalkoverClickable){
    const p = playerById(slot.playerId);
    row.title = "Click to award " + (p ? p.name : "this player") + " the win by walkover";
    row.addEventListener("click", () => {
      if(p && confirm("Award the win to " + p.name + " by walkover?")){
        persistMatchResult(t, m, p.id, [], true, "qual");
      }
    });
  }
  return row;
}

function buildQualMatchCard(t, m){
  const card = el("div", {class:"bracket-match status-" + m.status});
  card.appendChild(buildQualSlotRow(t, m.slotA, m));
  card.appendChild(buildQualSlotRow(t, m.slotB, m));

  if(m.status === "ready" && m.slotA.type === "player" && m.slotB.type === "player"){
    const h2hBtn = el("button", {type:"button", class:"h2h-inline-badge", title:"View head-to-head record"}, ["H2H"]);
    h2hBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openH2HPopup(m.slotA.playerId, m.slotB.playerId);
    });
    card.appendChild(h2hBtn);
  }

  if(m.status === "ready"){
    card.appendChild(buildQualEntryForm(t, m));
  } else if(m.status === "played"){
    const clearX = el("button", {type:"button", class:"clear-x", title:"Clear result"}, ["\u00d7"]);
    clearX.addEventListener("click", (e) => {
      e.stopPropagation();
      if(confirm("Clear this result? Later qualifying rounds built on it will be cleared too.")){
        deleteQualCascade(t, qualRoundNames(t.qualifying.numRounds).indexOf(m.round), m.slotIndex);
        saveState();
        withScrollPreserved(() => renderQualBracketRounds(t));
        renderRankings();
      }
    });
    card.appendChild(clearX);
  }
  return card;
}

function buildQualEntryForm(t, m){
  const form = el("div", {class:"bracket-match-form"});
  const setRow = el("div", {class:"bracket-sets-row"});
  const setInputs = [];
  for(let i = 1; i <= 3; i++){
    const box = el("div", {class:"set-box"});
    box.appendChild(el("span", {}, ["S" + i]));
    const inner = el("div", {style:"display:flex;gap:2px;"});
    const a = el("input", {type:"number", min:"0", max:"30"});
    const b = el("input", {type:"number", min:"0", max:"30"});
    inner.appendChild(a); inner.appendChild(b);
    box.appendChild(inner);
    setRow.appendChild(box);
    setInputs.push({a, b});
  }
  form.appendChild(setRow);

  const errMsg = el("div", {class:"form-msg"}, []);
  form.appendChild(errMsg);

  // No submit button — the winner is read off as soon as someone has taken
  // 2 of the (up to) 3 sets entered. Click either name above for a walkover.
  function evaluateAndMaybeSave(){
    errMsg.textContent = "";
    let sets = [];
    for(const pair of setInputs){
      const av = pair.a.value, bv = pair.b.value;
      if(av === "" && bv === "") continue;
      if(av === "" || bv === "") return;
      const an = Number(av), bn = Number(bv);
      if(an === bn){ errMsg.textContent = "A set can't end in a tie."; return; }
      sets.push({a: an, b: bn});
    }
    if(sets.length === 0) return;
    let aSets = 0, bSets = 0;
    sets.forEach(s => { if(s.a > s.b) aSets++; else bSets++; });
    if(aSets < 2 && bSets < 2) return;
    persistMatchResult(t, m, aSets > bSets ? m.slotA.playerId : m.slotB.playerId, sets, false, "qual");
  }

  setInputs.forEach(pair => {
    pair.a.addEventListener("input", evaluateAndMaybeSave);
    pair.b.addEventListener("input", evaluateAndMaybeSave);
  });

  return form;
}

/* ---------------- Auto-fill from rankings ---------------- */
function handleAutofillMain(){
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  const msg = $("#bracket-autofill-msg");
  const entryDate = rankingDateFromSelectValue($("#bracket-entry-date").value);
  const seedDate = rankingDateFromSelectValue($("#bracket-seed-date").value);
  const numSeeds = numSeedsFor(t.drawSize);
  const qualSlots = t.qualifying.enabled ? t.qualifying.numQualifiers : 0;
  const directSlots = Math.max(0, t.drawSize - qualSlots);

  const entryRanks = officialRanksAsOf(entryDate);
  const alreadyUsed = new Set([...(t.seeds || []).filter(Boolean), ...(t.unseededEntrants || [])]);
  const committedElsewhere = playersCommittedInWeek(mondayOf(tournamentDateMs(t)), t.id);
  const fieldCandidates = state.players
    .filter(p => !p.retired && !alreadyUsed.has(p.id) && !committedElsewhere.has(p.id))
    .sort((a,b) => (entryRanks[a.id] || 99999) - (entryRanks[b.id] || 99999) || a.name.localeCompare(b.name));

  const openSeedSlots = [];
  t.seeds.forEach((s, i) => { if(!s) openSeedSlots.push(i); });
  const openUnseededCount = Math.max(0, directSlots - t.seeds.filter(Boolean).length - (t.unseededEntrants||[]).length);

  const field = fieldCandidates.slice(0, openSeedSlots.length + openUnseededCount);
  const seedRanks = officialRanksAsOf(seedDate);
  const reranked = field.slice().sort((a,b) => (seedRanks[a.id] || 99999) - (seedRanks[b.id] || 99999) || a.name.localeCompare(b.name));

  let filled = 0;
  const toSeed = reranked.slice(0, openSeedSlots.length);
  const toUnseeded = reranked.slice(openSeedSlots.length);
  toSeed.forEach((p, i) => { t.seeds[openSeedSlots[i]] = p.id; filled++; });
  const unseededSet = new Set(t.unseededEntrants || []);
  toUnseeded.forEach(p => { unseededSet.add(p.id); filled++; });
  t.unseededEntrants = Array.from(unseededSet);

  saveState();
  msg.textContent = filled > 0 ? "Filled " + filled + " open spot" + (filled===1?"":"s") + " in the main draw." : "No open seed or entrant spots to fill.";
  msg.className = "form-msg ok";
  renderBracketSeedsList(t);
  renderBracketUnseededList(t);
  $("#bracket-numseeds-label").textContent = numSeeds;
}

function handleAutofillQual(){
  const t = tournamentById(currentBracketTournamentId);
  if(!t || !t.qualifying.enabled) return;
  const msg = $("#bracket-autofill-msg");
  const entryDate = rankingDateFromSelectValue($("#bracket-entry-date").value);
  const numSeeds = numSeedsFor(t.drawSize);
  const qualSlots = t.qualifying.numQualifiers * Math.pow(2, t.qualifying.numRounds);
  const directSlots = Math.max(0, t.drawSize - t.qualifying.numQualifiers);

  const entryRanks = officialRanksAsOf(entryDate);
  const usedInMain = new Set([...(t.seeds || []).filter(Boolean), ...(t.unseededEntrants || [])]);
  const usedInQual = new Set(t.qualifying.entrants || []);
  const committedElsewhere = playersCommittedInWeek(mondayOf(tournamentDateMs(t)), t.id);
  const candidates = state.players
    .filter(p => !p.retired && !usedInMain.has(p.id) && !usedInQual.has(p.id) && !committedElsewhere.has(p.id))
    .sort((a,b) => (entryRanks[a.id] || 99999) - (entryRanks[b.id] || 99999) || a.name.localeCompare(b.name));

  const openSlots = Math.max(0, qualSlots - usedInQual.size);
  const toAdd = candidates.slice(0, openSlots);
  const set = new Set(t.qualifying.entrants || []);
  toAdd.forEach(p => set.add(p.id));
  t.qualifying.entrants = Array.from(set);

  saveState();
  msg.textContent = toAdd.length > 0 ? "Added " + toAdd.length + " qualifying entrant" + (toAdd.length===1?"":"s") + "." : "No open qualifying spots to fill.";
  msg.className = "form-msg ok";
  renderQualEntrantsList(t);
}

/* ---------------- Entry List (with wild cards) ---------------- */
function renderEntryListBody(t){
  const container = $("#entry-list-body");
  container.innerHTML = "";

  // Same dates already used by Process Entry List / Auto-Fill — showing
  // each player's rank as of right now previews exactly what those actions
  // will use, before you actually run them.
  const entryDate = rankingDateFromSelectValue($("#bracket-entry-date").value);
  const seedDate = rankingDateFromSelectValue($("#bracket-seed-date").value);
  const entryRanks = officialRanksAsOf(entryDate);
  const seedRanks = officialRanksAsOf(seedDate);

  const pickerWrap = el("div", {class:"picker-wrap"});
  pickerWrap.appendChild(el("input", {type:"text", class:"picker-input", "data-entrylist-search":"1", autocomplete:"off", placeholder:"Search player to add to entry list…"}));
  pickerWrap.appendChild(el("div", {class:"picker-suggestions hidden", "data-entrylist-suggestions":"1"}));
  container.appendChild(pickerWrap);

  const listWrap = el("div", {style:"margin-top:12px;"});
  if((t.entryList || []).length === 0){
    listWrap.appendChild(el("p", {class:"picker-empty-note"}, ["No one on the entry list yet — search above to add players."]));
  } else {
    t.entryList
      .map(entry => ({entry, p: playerById(entry.playerId)}))
      .filter(x => x.p)
      .sort((a,b) => a.p.name.localeCompare(b.p.name))
      .forEach(({entry, p}) => {
        const row = el("div", {class:"entry-list-row"});
        const erRank = entryRanks[p.id];
        const srRank = seedRanks[p.id];
        const rankBadges = (erRank ? '<span class="er-badge">ER: ' + erRank + '</span>' : '') +
          (srRank ? '<span class="sr-badge">SR: ' + srRank + '</span>' : '');
        row.appendChild(el("span", {class:"entry-list-name", html: rankBadges + playerNameHTML(p)}));
        const wcGroup = el("div", {class:"entry-list-wc-group"});
        [["none","Entry"], ["main","Main WC"], ["qual","Q WC"], ["pr","Main PR"], ["qpr","Q PR"]].forEach(([val, label]) => {
          const btn = el("button", {
            type:"button",
            class:"entry-list-wc-btn" + (entry.wildcard === val ? " active-" + val : ""),
            "data-entrylist-wc-player": entry.playerId,
            "data-entrylist-wc-value": val
          }, [label]);
          wcGroup.appendChild(btn);
        });
        row.appendChild(wcGroup);
        row.appendChild(el("button", {type:"button", class:"entry-list-remove", "data-entrylist-remove": entry.playerId}, ["\u00d7"]));
        listWrap.appendChild(row);
      });
  }
  container.appendChild(listWrap);
}

function handleEntryListSearchInput(e){
  if(!e.target.matches("[data-entrylist-search]")) return;
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  const query = e.target.value;
  const suggestionsEl = $('[data-entrylist-suggestions]');
  if(!query.trim()){ suggestionsEl.classList.add("hidden"); suggestionsEl.innerHTML = ""; return; }
  const existingIds = new Set((t.entryList || []).map(e2 => e2.playerId));
  const committedElsewhere = playersCommittedInWeek(mondayOf(tournamentDateMs(t)), t.id);
  const results = state.players
    .filter(p => !p.retired && !existingIds.has(p.id) && !committedElsewhere.has(p.id))
    .filter(p => matchesSearch(p.name, query))
    .slice(0, 8);
  suggestionsEl.innerHTML = results.length
    ? results.map(p => '<button type="button" class="picker-option" data-entrylist-pick="' + p.id + '">' + playerNameHTML(p) + '</button>').join("")
    : '<div class="picker-empty">No match</div>';
  suggestionsEl.classList.remove("hidden");
}

function handleEntryListClick(e){
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  const pickBtn = e.target.closest("[data-entrylist-pick]");
  if(pickBtn){
    const pid = pickBtn.dataset.entrylistPick;
    if(!t.entryList.some(e2 => e2.playerId === pid)){
      t.entryList.push({playerId: pid, wildcard: "none"});
      saveState();
      renderEntryListBody(t);
    }
    return;
  }
  const wcBtn = e.target.closest("[data-entrylist-wc-player]");
  if(wcBtn){
    const pid = wcBtn.dataset.entrylistWcPlayer;
    const val = wcBtn.dataset.entrylistWcValue;
    const entry = t.entryList.find(e2 => e2.playerId === pid);
    if(entry){
      entry.wildcard = val;
      saveState();
      renderEntryListBody(t);
    }
    return;
  }
  const rmBtn = e.target.closest("[data-entrylist-remove]");
  if(rmBtn){
    const pid = rmBtn.dataset.entrylistRemove;
    t.entryList = t.entryList.filter(e2 => e2.playerId !== pid);
    saveState();
    renderEntryListBody(t);
  }
}

// Splits the entry list into main-draw seeds/unseeded and qualifying
// entrants: wild cards get a guaranteed spot first, then the rest of the
// direct-acceptance and qualifying cutoffs are set by rank (entry-list
// date), and finally the main-draw field is seeded using the seeding date.
/* ---------------- Entry list field generator ---------------- */
// Rough real-tour shape: a WATP 1000 pulls hard from the very top of the
// rankings, a 500 from a wider band centered a bit lower, and a 250 mostly
// skips the very top (they'd be off resting/prepping for bigger events) in
// favor of mid-pack and rising players. Bands are (maxRank, weight) pairs,
// checked in order — the last one (Infinity) catches everyone else.
const FIELD_GEN_WEIGHT_BANDS = {
  OLYMPICS: [{maxRank:20, weight:15}, {maxRank:50, weight:5}, {maxRank:100, weight:1}, {maxRank:Infinity, weight:0.1}],
  WTA1000: [{maxRank:30, weight:10}, {maxRank:60, weight:4}, {maxRank:100, weight:1}, {maxRank:Infinity, weight:0.2}],
  WTA500:  [{maxRank:20, weight:3}, {maxRank:60, weight:8}, {maxRank:100, weight:5}, {maxRank:150, weight:2}, {maxRank:Infinity, weight:0.5}],
  WTA250:  [{maxRank:20, weight:1}, {maxRank:50, weight:3}, {maxRank:100, weight:6}, {maxRank:200, weight:8}, {maxRank:Infinity, weight:3}],
  CHALLENGER125: [{maxRank:40, weight:0.5}, {maxRank:80, weight:2}, {maxRank:150, weight:6}, {maxRank:350, weight:10}, {maxRank:Infinity, weight:4}],
  CHALLENGER100: [{maxRank:50, weight:0.3}, {maxRank:100, weight:1}, {maxRank:200, weight:5}, {maxRank:400, weight:10}, {maxRank:Infinity, weight:6}]
};
function fieldGenWeight(level, rank){
  const bands = FIELD_GEN_WEIGHT_BANDS[level] || FIELD_GEN_WEIGHT_BANDS.WTA250;
  for(const b of bands){ if(rank <= b.maxRank) return b.weight; }
  return 0.1;
}

// Efraimidis-Spirakis weighted sampling without replacement — each item
// gets a random key scaled by its weight, then the top-k keys win. Higher
// weight means more likely to be picked, but never guaranteed, so the same
// tier doesn't produce an identical field every time.
function weightedSampleWithoutReplacement(items, weightFn, k){
  const keyed = items.map(item => ({item, key: Math.pow(Math.random(), 1 / Math.max(weightFn(item), 0.0001))}));
  keyed.sort((a,b) => b.key - a.key);
  return keyed.slice(0, k).map(x => x.item);
}

// Every player already committed to some OTHER tournament the same week —
// checked across seeds, unseeded entrants, qualifying entrants, entry
// lists, and WATP Finals groups, so the generator never double-books someone.
function playersCommittedInWeek(weekMonday, excludeTournamentId){
  const committed = new Set();
  state.tournaments.forEach(t => {
    if(t.id === excludeTournamentId) return;
    if(mondayOf(tournamentDateMs(t)) !== weekMonday) return;
    (t.seeds || []).forEach(id => id && committed.add(id));
    (t.unseededEntrants || []).forEach(id => committed.add(id));
    if(t.qualifying) (t.qualifying.entrants || []).forEach(id => committed.add(id));
    (t.entryList || []).forEach(e => committed.add(e.playerId));
    if(t.groups) t.groups.forEach(g => (g.playerIds || []).forEach(id => committed.add(id)));
  });
  return committed;
}

function handleGenerateField(){
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  const msg = $("#entry-list-generate-msg");
  msg.className = "form-msg";

  const entryDate = rankingDateFromSelectValue($("#bracket-entry-date").value);
  const ranks = officialRanksAsOf(entryDate);
  const weekMonday = mondayOf(tournamentDateMs(t));
  const committedElsewhere = playersCommittedInWeek(weekMonday, t.id);
  const alreadyOnList = new Set((t.entryList || []).map(e => e.playerId));

  const qualEnabled = t.qualifying && t.qualifying.enabled;
  const qualCap = qualEnabled ? t.qualifying.numQualifiers * Math.pow(2, t.qualifying.numRounds) : 0;
  const directSlots = Math.max(0, t.drawSize - (qualEnabled ? t.qualifying.numQualifiers : 0));
  const target = directSlots + qualCap + Math.max(6, Math.round((directSlots + qualCap) * 0.15));

  const eligible = state.players.filter(p =>
    !p.retired &&
    !committedElsewhere.has(p.id) &&
    !alreadyOnList.has(p.id) &&
    ranks[p.id]
  );

  const picked = weightedSampleWithoutReplacement(eligible, (p) => fieldGenWeight(t.level, ranks[p.id]), Math.min(target, eligible.length));
  if(!t.entryList) t.entryList = [];
  picked.forEach(p => t.entryList.push({playerId: p.id, wildcard: "none"}));
  saveState();

  msg.className = "form-msg ok";
  msg.textContent = "Added " + picked.length + " player" + (picked.length===1?"":"s") + " to the entry list" +
    (picked.length < target ? " (only " + eligible.length + " eligible players were available)" : "") + ".";
  renderEntryListBody(t);
}

function handleProcessEntryList(){
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  const msg = $("#entry-list-msg");
  msg.className = "form-msg";

  const entryDate = rankingDateFromSelectValue($("#bracket-entry-date").value);
  const seedDate = rankingDateFromSelectValue($("#bracket-seed-date").value);
  const numSeeds = numSeedsFor(t.drawSize);
  const qualEnabled = t.qualifying.enabled;
  const qualCap = qualEnabled ? t.qualifying.numQualifiers * Math.pow(2, t.qualifying.numRounds) : 0;
  const directSlots = Math.max(0, t.drawSize - (qualEnabled ? t.qualifying.numQualifiers : 0));

  const mainWCs = t.entryList.filter(e => e.wildcard === "main").map(e => e.playerId);
  const qualWCs = t.entryList.filter(e => e.wildcard === "qual").map(e => e.playerId);
  const mainPRs = t.entryList.filter(e => e.wildcard === "pr").map(e => e.playerId);
  const qualPRs = t.entryList.filter(e => e.wildcard === "qpr").map(e => e.playerId);
  const regular = t.entryList.filter(e => e.wildcard === "none").map(e => e.playerId);

  const mainGuaranteed = mainWCs.length + mainPRs.length;
  const qualGuaranteed = qualWCs.length + qualPRs.length;

  if(mainGuaranteed > directSlots){
    msg.textContent = "Too many main-draw wild cards/protected rankings (" + mainGuaranteed + ") for " + directSlots + " direct slot" + (directSlots===1?"":"s") + ". Remove a few and try again.";
    return;
  }
  if(qualEnabled && qualGuaranteed > qualCap){
    msg.textContent = "Too many qualifying wild cards/protected rankings (" + qualGuaranteed + ") for " + qualCap + " qualifying slot" + (qualCap===1?"":"s") + ". Remove a few and try again.";
    return;
  }

  const entryRanks = officialRanksAsOf(entryDate);
  const regularSorted = regular.slice().sort((a,b) =>
    (entryRanks[a] || 999999) - (entryRanks[b] || 999999) ||
    (playerById(a) ? playerById(a).name : "").localeCompare(playerById(b) ? playerById(b).name : ""));

  const mainDirectCount = Math.max(0, directSlots - mainGuaranteed);
  const mainDirect = regularSorted.slice(0, mainDirectCount);
  const leftover = regularSorted.slice(mainDirectCount);

  const qualDirectCount = qualEnabled ? Math.max(0, qualCap - qualGuaranteed) : 0;
  const qualDirect = qualEnabled ? leftover.slice(0, qualDirectCount) : [];
  const alternates = qualEnabled ? leftover.slice(qualDirectCount) : leftover;

  const mainField = [...mainWCs, ...mainPRs, ...mainDirect];
  const qualField = [...qualWCs, ...qualPRs, ...qualDirect];

  const seedRanks = officialRanksAsOf(seedDate);
  const mainSorted = mainField.slice().sort((a,b) =>
    (seedRanks[a] || 999999) - (seedRanks[b] || 999999) ||
    (playerById(a) ? playerById(a).name : "").localeCompare(playerById(b) ? playerById(b).name : ""));

  const newSeeds = mainSorted.slice(0, numSeeds);
  const newUnseeded = mainSorted.slice(numSeeds);

  t.seeds = new Array(numSeeds).fill(null).map((_, i) => newSeeds[i] || null);
  t.unseededEntrants = Array.from(new Set(newUnseeded));
  if(qualEnabled) t.qualifying.entrants = Array.from(new Set(qualField));

  saveState();
  msg.className = "form-msg ok";
  msg.textContent = mainWCs.length + " main WC, " + mainPRs.length + " main PR, " +
    (qualEnabled ? qualWCs.length + " qualifying WC, " + qualPRs.length + " qualifying PR, " : "") +
    mainDirect.length + " direct into the main draw" + (qualEnabled ? ", " + qualDirect.length + " into qualifying" : "") +
    (alternates.length ? ", " + alternates.length + " on the entry list didn't make the cut." : ".");

  renderBracketSeedsList(t);
  renderBracketUnseededList(t);
  if(qualEnabled) renderQualEntrantsList(t);
  $("#bracket-numseeds-label").textContent = numSeeds;
}

function renderBracketSeedGrid(t){
  const grid = $("#bracket-seed-grid");
  grid.innerHTML = "";
  const cap = capacityOf(t.drawSize);
  const playersSorted = [...state.players].sort((a,b) => a.name.localeCompare(b.name));
  for(let i = 0; i < cap; i++){
    const entry = t.bracketEntries[i] || {type:"empty"};
    const wrap = el("div", {class:"bracket-seed-slot"});
    wrap.appendChild(el("span", {class:"slot-num"}, [String(i+1)]));
    const sel = el("select", {"data-seed-slot": i});
    sel.appendChild(el("option", {value:"empty"}, ["— Empty —"]));
    sel.appendChild(el("option", {value:"bye"}, ["Bye"]));
    playersSorted.forEach(p => sel.appendChild(el("option", {value:"player:" + p.id}, [p.name])));
    sel.value = entry.type === "player" ? "player:" + entry.playerId : entry.type;
    wrap.appendChild(sel);
    grid.appendChild(wrap);
  }
}

function handleSeedSelectChange(e){
  if(!e.target.matches("select[data-seed-slot]")) return;
  const t = tournamentById(currentBracketTournamentId);
  if(!t) return;
  const i = Number(e.target.dataset.seedSlot);
  const val = e.target.value;
  let entry;
  if(val === "empty") entry = {type:"empty"};
  else if(val === "bye") entry = {type:"bye"};
  else entry = {type:"player", playerId: val.slice(7)};
  t.bracketEntries[i] = entry;
  deleteCascade(t, 0, Math.floor(i / 2));
  saveState();
  withScrollPreserved(() => renderBracketRounds(t));
  renderRankings();
}

// Vertical rhythm: every round-0 match occupies one row of this height.
// Later rounds are centered exactly on the midpoint of their two feeder
// matches, based on each card's real measured height (see
// layoutBracketColumns), so the bracket is only as tall as it needs to be.
// A 16-player group always resolves to one winner in exactly 4 rounds
// (log2(16) = 4) — that's what makes "sections" work at any draw size.
const SECTION_INTERNAL_ROUNDS = 4;

// Vertical rhythm: every round-0 match occupies one row of this height.
// Later rounds are centered exactly on the midpoint of their two feeder
// matches, based on each card's real measured height (see
// layoutBracketColumns), so the bracket is only as tall as it needs to be.
//
// Draws bigger than 32 get split the way a real published draw sheet does:
// each 16-player group ("Section") plays out its own first/second/third
// round and quarterfinal-equivalent independently, and a separate "Finals"
// block up top re-shows that same last round alongside the semis and final
// as the unified business end — rather than one enormous continuous row of
// columns.
function renderBracketRounds(t){
  const container = $("#bracket-draw-container");
  container.innerHTML = "";
  const rounds = computeBracket(t);
  const round0Count = rounds[0].matches.length;
  const cap = capacityOf(t.drawSize);
  const cardBuilder = (m) => buildBracketMatchCard(t, m);

  // Sectioning only kicks in for draws bigger than 32 — a 32-draw (16
  // first-round matches, 2 sections) stays as one simple continuous view.
  if(cap <= 32){
    container.appendChild(el("div", {class:"bracket-section-title"}, [el("h3", {}, ["Draw"])]));
    const wrap = el("div", {class:"bracket-wrap"});
    container.appendChild(wrap);
    layoutBracketColumns(wrap, rounds, cardBuilder, (roundObj) => ROUND_LABELS[roundObj.round] || roundObj.round);
    renderOlympicsBronzeSection(t, container);
    renderSeedIndex(t);
    return;
  }

  const numSections = round0Count / SECTION_SIZE;

  // "Finals" always starts at Quarterfinals specifically, regardless of draw
  // size. For a 64-draw that's naturally also where each 16-player section's
  // own last round lands (QF), so it overlaps there as intended. For a
  // 128-draw, a 16-player section's own last round is R16, not QF — R16
  // still shows once, inside its section, but never gets duplicated up into
  // Finals too.
  const qfIndex = rounds.findIndex(r => r.round === "QF");
  const combinedRounds = qfIndex >= 0 ? rounds.slice(qfIndex) : rounds.slice(SECTION_INTERNAL_ROUNDS - 1);
  container.appendChild(el("div", {class:"bracket-section-title"}, [el("h3", {}, ["Finals"])]));
  const finalsWrap = el("div", {class:"bracket-wrap"});
  container.appendChild(finalsWrap);
  layoutBracketColumns(finalsWrap, combinedRounds, cardBuilder, (roundObj) => FRIENDLY_ROUND_NAMES[roundObj.round] || roundObj.round);

  // Sections, grouped into "Top half" / "Bottom half" once there are enough
  // of them that the grouping actually helps (4+ sections, i.e. 64+ draws).
  const groupIntoHalves = numSections >= 4;
  const sectionsPerHalf = groupIntoHalves ? numSections / 2 : numSections;
  const halfLabels = ["Top half", "Bottom half"];

  for(let half = 0; half < (groupIntoHalves ? 2 : 1); half++){
    if(groupIntoHalves){
      container.appendChild(el("h2", {class:"bracket-half-heading"}, [halfLabels[half]]));
    }
    for(let localSec = 0; localSec < sectionsPerHalf; localSec++){
      const sectionIndex = half * sectionsPerHalf + localSec;
      const sectionRoundsData = [];
      for(let r = 0; r < SECTION_INTERNAL_ROUNDS; r++){
        const matchesPerSection = SECTION_SIZE / Math.pow(2, r);
        const start = sectionIndex * matchesPerSection;
        sectionRoundsData.push({
          round: rounds[r].round,
          matches: rounds[r].matches.slice(start, start + matchesPerSection)
        });
      }
      container.appendChild(el("div", {class:"bracket-section-title"}, [el("h3", {}, ["Section " + (sectionIndex + 1)])]));
      const sectionWrap = el("div", {class:"bracket-wrap"});
      container.appendChild(sectionWrap);
      layoutBracketColumns(sectionWrap, sectionRoundsData, cardBuilder, (roundObj, idx) => {
        const posInSection = sectionRoundsData.indexOf(roundObj);
        if(posInSection < 3) return ["First Round", "Second Round", "Third Round"][posInSection];
        return FRIENDLY_ROUND_NAMES[roundObj.round] || roundObj.round;
      });
    }
  }

  renderOlympicsBronzeSection(t, container);
  renderSeedIndex(t);
}

// Appends the Bronze Medal Match section right after the main draw —
// nothing renders at all for non-Olympics tournaments, or before both
// semifinals are actually decided.
function renderOlympicsBronzeSection(t, container){
  if(t.level !== "OLYMPICS") return;
  const bronzeMatchData = computeBronzeMatch(t);
  if(!bronzeMatchData) return;
  container.appendChild(el("div", {class:"bracket-section-title"}, [el("h3", {}, ["Bronze Medal Match"])]));
  const wrap = el("div", {class:"bracket-wrap"});
  wrap.appendChild(buildBronzeMatchCard(t, bronzeMatchData));
  container.appendChild(wrap);
}

// A two-column seed sheet above the draw (seeds 1..N/2 on the left, the rest
// on the right — CSS multi-column layout does this split automatically since
// every row is the same height). Each seed fades out once they're eliminated.
function renderSeedIndex(t){
  const container = $("#seed-index");
  if(!container) return;
  const numSeeds = numSeedsFor(t.drawSize);
  const results = computeTournamentResults(t.id);
  let html = "";
  for(let i = 0; i < numSeeds; i++){
    const pid = t.seeds[i];
    const p = pid ? playerById(pid) : null;
    let statusHTML = "", eliminated = false;
    if(p){
      const res = results.get(pid);
      if(res){
        if(res.code === "W"){ statusHTML = '<span class="seed-status champ">champion</span>'; }
        else { statusHTML = '<span class="seed-status">lost ' + (ROUND_LABELS[res.code] || res.code) + '</span>'; eliminated = true; }
      }
    }
    html += '<div class="seed-index-row' + (eliminated ? " seed-eliminated" : "") + '">' +
      '<span class="seed-index-num">' + (i + 1) + '.</span>' +
      '<span class="seed-index-name">' + (p ? playerLinkHTML(p) : '<span class="seed-index-empty">—</span>') + '</span>' +
      (statusHTML ? '<span class="seed-index-status">' + statusHTML + '</span>' : "") +
      '</div>';
  }
  container.innerHTML = html || '<p class="picker-empty-note">No seeds assigned yet.</p>';
}

function buildSlotRow(slot, m, which, t){
  let nameHTML, extraClass = "";
  if(slot.type === "player"){
    const p = playerById(slot.playerId);
    const seedNum = t ? seedNumberForPlayer(t, slot.playerId) : null;
    const isWC = t ? isMainDrawWildCard(t, slot.playerId) : false;
    const isPR = t ? isMainDrawProtectedRanking(t, slot.playerId) : false;
    const isQ = t ? isMainDrawQualifier(t, slot.playerId) : false;
    const isLL = t ? isLuckyLoser(t, slot.playerId) : false;
    const badges = (seedNum ? '<span class="seed-badge">' + seedNum + '</span>' : "") +
      (isWC ? '<span class="wc-badge">WC</span>' : "") +
      (isPR ? '<span class="pr-badge">PR</span>' : "") +
      (isQ ? '<span class="qual-badge">Q</span>' : "") +
      (isLL ? '<span class="ll-badge">LL</span>' : "");
    // Ready matches: clicking a name awards that player the win by walkover.
    // Everything else: clicking a name opens their profile.
    nameHTML = badges + (p ? (m.status === "ready" ? playerNameHTML(p) : playerLinkHTML(p)) : "(removed player)");
  } else if(slot.type === "bye"){
    // A blank (not simply hidden) placeholder — same padding/line-height as
    // a real row, so the card's measured height (and therefore every round
    // after it) doesn't shift at all, it just doesn't show the word "Bye".
    nameHTML = "&nbsp;"; extraClass = " slot-bye";
  } else {
    nameHTML = "TBD"; extraClass = " slot-empty";
  }
  const isWinner = m.status !== "ready" && m.winnerSlot && slot.type === "player" && m.winnerSlot.playerId === slot.playerId;
  const isWalkoverClickable = m.status === "ready" && slot.type === "player";
  // Lucky Loser replacement only makes sense in Round 1, before any result
  // is recorded — once a match is played (or it's a later round), there's
  // no "withdrawal into an unplayed slot" left to fill.
  const isFirstRound = t && m.round === bracketRoundNames(capacityOf(t.drawSize))[0];
  const isWithdrawable = isWalkoverClickable && isFirstRound;
  const row = el("div", {class: "bracket-slot" + (isWinner ? " slot-winner" : "") + extraClass + (isWalkoverClickable ? " slot-walkover-target" : "")});
  row.appendChild(el("span", {class:"slot-name", html: nameHTML}));
  if(m.status === "played" && m.existingMatch && slot.type === "player"){
    row.appendChild(el("span", {html: slotScoreHTML(m.existingMatch, slot.playerId)}));
  }
  if(isWithdrawable){
    const wdBtn = el("button", {type:"button", class:"slot-withdraw-btn", title:"Mark withdrawn — replace with a Lucky Loser"}, ["WD"]);
    wdBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openLuckyLoserPicker(t, slot.playerId);
    });
    row.appendChild(wdBtn);
  }
  if(isWalkoverClickable){
    const p = playerById(slot.playerId);
    row.title = "Click to award " + (p ? p.name : "this player") + " the win by walkover";
    row.addEventListener("click", () => {
      if(p && confirm("Award the win to " + p.name + " by walkover?")){
        persistMatchResult(t, m, p.id, [], true, "main");
      }
    });
  }
  return row;
}

/* ---------------- Match Simulator ---------------- */
// Tunable knobs — easy to retune later without touching the formulas below.
const SIM_POINTS_ELO_SCALE = 2.5;      // operates on log10(points) — bigger = points gaps matter less
const SIM_SURFACE_SCALE = 1.2;         // converts a surface win% delta into an equivalent log-points shift
const SIM_H2H_SCALE = 0.5;             // how much the head-to-head delta can shift the final probability
const SIM_MIN_PROB = 0.03;             // nobody is ever a true lock...
const SIM_MAX_PROB = 0.97;             // ...or a true impossibility
const SIM_PEAK_HALF_LIFE_MONTHS = 12;  // how fast a rank peak's pull fades with time
const SIM_SURFACE_WINDOW_DAYS = 364;   // "recent" surface form uses the same rolling window rankings do

// Standard shrinkage curve: 0 matches -> 0 confidence, n=k -> 0.5, approaches
// 1 as the sample grows. Used everywhere a small sample should be trusted
// less than a large one.
function simConfidence(n, k){
  return n / (n + k);
}

// A player's "effective points" for simulation purposes blends their
// current ranking points with their career-best points total, weighted by
// how recently that peak happened — a peak from a few months ago (most
// likely rust from a layoff, not real decline) pulls hard toward itself;
// an old peak fades back toward mostly just current points, though it
// never fully disappears. Points, not rank — rank is only an ordering, so
// two players 60 spots apart in the crowded middle of the field can be a
// tiny handful of points apart (one extra tournament round), while two
// players just a few spots apart at the very top can be thousands of
// points apart. Points capture how big that gap actually is; rank alone
// can't tell the two situations apart.
function computeEffectivePointsForSim(playerId, asOfMs){
  const effectiveNow = asOfMs - 7 * MS_PER_DAY; // matches officialRanksAsOf's own lag convention
  const currentPoints = (computeRankingsAsOf(effectiveNow).get(playerId) || {points:0}).points;

  let peakPoints = currentPoints, peakDateMs = asOfMs;
  getRankingSnapshotDates().forEach(d => {
    if(d > asOfMs) return; // never let a simulation see a future peak
    const pts = (computeRankingsAsOf(d - 7 * MS_PER_DAY).get(playerId) || {points:0}).points;
    if(pts > peakPoints){
      peakPoints = pts;
      peakDateMs = d;
    }
  });
  if(peakPoints <= currentPoints) return currentPoints; // no peak above current -- nothing to blend

  const monthsSincePeak = Math.max(0, (asOfMs - peakDateMs) / (30 * MS_PER_DAY));
  const peakWeight = Math.pow(0.5, monthsSincePeak / SIM_PEAK_HALF_LIFE_MONTHS);
  return currentPoints + peakWeight * (peakPoints - currentPoints);
}

// How much better or worse a player performs on this surface than their
// own overall baseline — not their absolute surface win rate, since a
// great player can have a great clay record just by being great, with
// nothing surface-specific going on. Blends a career-long view with a
// recent (rolling-window) one; both sides are dampened by how much
// evidence actually backs them, and the blend itself leans toward
// "recent" exactly as much as there's real recent evidence to lean on.
function computeSurfaceAdjustmentForSim(playerId, surface, asOfMs){
  const allMatches = matchesForPlayer(playerId).filter(isTourLevelMatch).filter(m => {
    const t = tournamentById(m.tournamentId);
    return t && tournamentDateMs(t) <= asOfMs;
  });
  if(allMatches.length === 0) return 0;

  function deltaAndConfidence(matchList){
    if(matchList.length === 0) return {delta: 0, confidence: 0};
    const surfaceMatches = matchList.filter(m => {
      const t = tournamentById(m.tournamentId);
      return t && t.surface === surface;
    });
    if(surfaceMatches.length === 0) return {delta: 0, confidence: 0};
    const overallWinPct = matchList.filter(m => m.winnerId === playerId).length / matchList.length;
    const surfaceWinPct = surfaceMatches.filter(m => m.winnerId === playerId).length / surfaceMatches.length;
    return {delta: surfaceWinPct - overallWinPct, confidence: simConfidence(surfaceMatches.length, 8)};
  }

  const career = deltaAndConfidence(allMatches);
  const windowStart = asOfMs - SIM_SURFACE_WINDOW_DAYS * MS_PER_DAY;
  const recentMatches = allMatches.filter(m => {
    const t = tournamentById(m.tournamentId);
    return tournamentDateMs(t) > windowStart;
  });
  const recent = deltaAndConfidence(recentMatches);

  const dampenedCareer = career.delta * career.confidence;
  const dampenedRecent = recent.delta * recent.confidence;
  const recentWeight = recent.confidence;
  return recentWeight * dampenedRecent + (1 - recentWeight) * dampenedCareer;
}

// A distinct nudge on top of the base probability, not folded into it —
// head-to-head is about how two specific players' games clash, which
// rankings alone can't capture. A single past meeting barely moves this;
// a long, lopsided history moves it more.
function computeH2HAdjustmentForSim(idA, idB){
  const {winsA, winsB} = computeHeadToHead(idA, idB);
  const total = winsA + winsB;
  if(total === 0) return 0;
  const delta = (winsA / total) - 0.5;
  return delta * simConfidence(total, 4);
}

// Full pipeline: effective points (current blended with recency-weighted
// peak) -> compared on a log10 scale, so a doubling of points means the
// same thing whether it's 100 vs 200 or 4000 vs 8000, rather than a flat
// point gap meaning wildly different things depending on where on the
// scale it sits -> adjusted by each player's own surface form -> nudged
// by head-to-head -> clamped so nothing is ever a true lock.
function simulateMatchProbability(idA, idB, surface, asOfMs){
  const pointsA = computeEffectivePointsForSim(idA, asOfMs);
  const pointsB = computeEffectivePointsForSim(idB, asOfMs);
  const surfAdjA = computeSurfaceAdjustmentForSim(idA, surface, asOfMs) * SIM_SURFACE_SCALE;
  const surfAdjB = computeSurfaceAdjustmentForSim(idB, surface, asOfMs) * SIM_SURFACE_SCALE;
  // +1 avoids log10(0) for a player with no points at all yet.
  const logA = Math.log10(pointsA + 1) + surfAdjA;
  const logB = Math.log10(pointsB + 1) + surfAdjB;
  const baseProb = 1 / (1 + Math.pow(10, (logB - logA) / SIM_POINTS_ELO_SCALE));
  const h2hAdj = computeH2HAdjustmentForSim(idA, idB) * SIM_H2H_SCALE;
  return Math.min(SIM_MAX_PROB, Math.max(SIM_MIN_PROB, baseProb + h2hAdj));
}

// Picks a realistic game score for one set, given how likely the actual set
// winner was to win it (>= 0.5). Real tennis sets are usually decided by a
// single break of serve — 6-4/6-3 are the most common scores even in
// genuinely competitive matches, since reaching 5-5 or 6-6 requires BOTH
// players holding serve the whole way, which isn't the typical path even
// when the match itself is close. 7-6 and 7-5 are real outcomes, not the
// default ones. Blends a "close match" weight table with a "lopsided
// match" one, based on how close this particular set's winner actually
// was to a coin flip.
function pickSimSetScore(setWinnerProb){
  const closeness = 1 - Math.abs(setWinnerProb - 0.5) * 2; // 1 = coin flip, 0 = total lock
  const closeWeights =    {"7-6":0.15, "7-5":0.15, "6-4":0.30, "6-3":0.20, "6-2":0.12, "6-1":0.06, "6-0":0.02};
  const lopsidedWeights = {"7-6":0.02, "7-5":0.03, "6-4":0.10, "6-3":0.20, "6-2":0.30, "6-1":0.25, "6-0":0.10};
  const options = Object.keys(closeWeights).map(key => {
    const [a,b] = key.split("-").map(Number);
    return {score:[a,b], weight: closeness * closeWeights[key] + (1 - closeness) * lopsidedWeights[key]};
  });
  const total = options.reduce((s,o) => s + o.weight, 0);
  let r = Math.random() * total;
  for(const o of options){
    r -= o.weight;
    if(r <= 0) return o.score;
  }
  return options[options.length - 1].score;
}

// Best-of-3 win probability given an independent per-set win probability:
// win the first two sets outright, or win exactly one of the first two and
// then the decider. Used to invert a desired MATCH-level probability back
// into the per-set probability that actually produces it.
function bestOf3MatchProbFromSetProb(setProb){
  return setProb * setProb + 2 * setProb * setProb * (1 - setProb);
}

// Best-of-3 amplifies whatever per-set edge a player has — winning 2 of 3
// independent events at probability p is more likely than p itself
// whenever p is above 0.5, so using the desired match-level probability
// directly as each set's probability would make every simulated match
// more lopsided than intended (verified directly: a target of 0.75 came
// out as an actual 0.84 empirical win rate before this fix). Binary
// search inverts it — finds the per-set probability that, run through the
// best-of-3 formula above, actually reproduces the intended match-level
// probability.
function invertMatchProbToSetProb(targetMatchProb){
  if(targetMatchProb < 0.5) return 1 - invertMatchProbToSetProb(1 - targetMatchProb);
  let lo = 0.5, hi = 1.0;
  for(let i = 0; i < 40; i++){
    const mid = (lo + hi) / 2;
    if(bestOf3MatchProbFromSetProb(mid) < targetMatchProb) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// Best-of-3, set by set — each set independently uses the per-set
// probability that correctly reproduces the intended overall MATCH
// probability (see invertMatchProbToSetProb above), not the match
// probability itself.
function simulateMatchScoreline(probA){
  const setProbA = invertMatchProbToSetProb(probA);
  const sets = [];
  let setsA = 0, setsB = 0;
  while(setsA < 2 && setsB < 2){
    const aWinsSet = Math.random() < setProbA;
    const setWinnerProb = aWinsSet ? setProbA : (1 - setProbA);
    const [winGames, loseGames] = pickSimSetScore(setWinnerProb);
    if(aWinsSet){ sets.push({a: winGames, b: loseGames}); setsA++; }
    else{ sets.push({a: loseGames, b: winGames}); setsB++; }
  }
  return {aWinsMatch: setsA === 2, sets};
}

// Runs the whole pipeline for one match and saves it exactly the way a
// manually entered result would be — same persistMatchResult call, same
// bracket refresh, same rankings refresh. A simulated result is
// indistinguishable from a typed-in one once it's saved; the "clear
// result" (×) button on any played match is the undo for either kind.
function simulateAndPersistMatch(t, m, bracketType){
  const idA = m.slotA.playerId, idB = m.slotB.playerId;
  const asOfMs = tournamentDateMs(t);
  const probA = simulateMatchProbability(idA, idB, t.surface, asOfMs);
  const {aWinsMatch, sets} = simulateMatchScoreline(probA);
  const winnerId = aWinsMatch ? idA : idB;
  persistMatchResult(t, m, winnerId, sets, false, bracketType || "main");
}

function buildBracketMatchCard(t, m){
  const card = el("div", {class:"bracket-match status-" + m.status});
  card.appendChild(buildSlotRow(m.slotA, m, "A", t));
  card.appendChild(buildSlotRow(m.slotB, m, "B", t));

  // Same "there until it's decided, then gone" treatment as the WD button —
  // once a result is recorded there's no more "about to face off" tension
  // to check, and the full match history (including this one) is always
  // still one click away from either player's own profile.
  if(m.status === "ready" && m.slotA.type === "player" && m.slotB.type === "player"){
    const h2hBtn = el("button", {type:"button", class:"h2h-inline-badge", title:"View head-to-head record"}, ["H2H"]);
    h2hBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openH2HPopup(m.slotA.playerId, m.slotB.playerId);
    });
    card.appendChild(h2hBtn);
  }

  if(m.status === "ready"){
    card.appendChild(buildBracketEntryForm(t, m));
  } else if(m.status === "played"){
    const clearX = el("button", {type:"button", class:"clear-x", title:"Clear result"}, ["\u00d7"]);
    clearX.addEventListener("click", (e) => {
      e.stopPropagation();
      if(confirm("Clear this result? Later rounds built on it will be cleared too.")){
        deleteCascade(t, bracketRoundNames(capacityOf(t.drawSize)).indexOf(m.round), m.slotIndex);
        saveState();
        withScrollPreserved(() => renderBracketRounds(t));
        renderRankings();
      }
    });
    card.appendChild(clearX);
  }
  return card;
}

// A near-copy of buildBracketMatchCard for the one match that isn't part of
// the normal round chain — it reuses the same slot rows and score-entry
// form (both are already fully generic), but "Clear result" can't use
// deleteCascade here: that walks the standard round-name list to find what
// to delete and cascade forward from, and "BRONZE" was deliberately never
// added to that list (it isn't "further along" than the semifinal the way
// every real round is). A bronze match also has nothing built on top of it
// to cascade into, so a direct removal by match id is all it actually needs.
function buildBronzeMatchCard(t, m){
  const card = el("div", {class:"bracket-match status-" + m.status});
  card.appendChild(buildSlotRow(m.slotA, m, "A", t));
  card.appendChild(buildSlotRow(m.slotB, m, "B", t));

  if(m.status === "ready" && m.slotA.type === "player" && m.slotB.type === "player"){
    const h2hBtn = el("button", {type:"button", class:"h2h-inline-badge", title:"View head-to-head record"}, ["H2H"]);
    h2hBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openH2HPopup(m.slotA.playerId, m.slotB.playerId);
    });
    card.appendChild(h2hBtn);
  }

  if(m.status === "ready"){
    card.appendChild(buildBracketEntryForm(t, m));
  } else if(m.status === "played" && m.existingMatch){
    const clearX = el("button", {type:"button", class:"clear-x", title:"Clear result"}, ["\u00d7"]);
    clearX.addEventListener("click", (e) => {
      e.stopPropagation();
      if(confirm("Clear the bronze medal match result?")){
        state.matches = state.matches.filter(mm => mm.id !== m.existingMatch.id);
        saveState();
        withScrollPreserved(() => renderBracketRounds(t));
        renderRankings();
      }
    });
    card.appendChild(clearX);
  }
  return card;
}

function buildBracketEntryForm(t, m){
  const form = el("div", {class:"bracket-match-form"});
  const setRow = el("div", {class:"bracket-sets-row"});
  const setInputs = [];
  for(let i = 1; i <= 3; i++){
    const box = el("div", {class:"set-box"});
    box.appendChild(el("span", {}, ["S" + i]));
    const inner = el("div", {style:"display:flex;gap:2px;"});
    const a = el("input", {type:"number", min:"0", max:"30"});
    const b = el("input", {type:"number", min:"0", max:"30"});
    inner.appendChild(a); inner.appendChild(b);
    box.appendChild(inner);
    setRow.appendChild(box);
    setInputs.push({a, b});
  }
  const simBtn = el("button", {type:"button", class:"btn btn-small btn-ghost sim-btn", title:"Simulate a result for this match"}, ["SIM"]);
  simBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    simulateAndPersistMatch(t, m, "main");
  });
  setRow.appendChild(simBtn);
  form.appendChild(setRow);

  const errMsg = el("div", {class:"form-msg"}, []);
  form.appendChild(errMsg);

  // No submit button — the winner is read off as soon as someone has taken
  // 2 of the (up to) 3 sets entered. Click either name above for a walkover.
  function evaluateAndMaybeSave(){
    errMsg.textContent = "";
    let sets = [];
    for(const pair of setInputs){
      const av = pair.a.value, bv = pair.b.value;
      if(av === "" && bv === "") continue;
      if(av === "" || bv === "") return; // still mid-entry, wait quietly
      const an = Number(av), bn = Number(bv);
      if(an === bn){ errMsg.textContent = "A set can't end in a tie."; return; }
      sets.push({a: an, b: bn});
    }
    if(sets.length === 0) return;
    let aSets = 0, bSets = 0;
    sets.forEach(s => { if(s.a > s.b) aSets++; else bSets++; });
    if(aSets < 2 && bSets < 2) return; // not decided yet
    persistMatchResult(t, m, aSets > bSets ? m.slotA.playerId : m.slotB.playerId, sets, false, "main");
  }

  setInputs.forEach(pair => {
    pair.a.addEventListener("input", evaluateAndMaybeSave);
    pair.b.addEventListener("input", evaluateAndMaybeSave);
  });

  return form;
}

/* ---------------- Records ---------------- */

// Every Monday from the first tournament's week through the most recent
// active week — this mirrors how many "ranking weeks" have actually elapsed,
// including weeks where nothing was played but old results rolled off the
// 52-week window and standings shifted anyway.
function getAllWeeklySeries(){
  const allDates = [
    ...state.tournaments.map(t => tournamentDateMs(t)),
    ...(state.byeWeeks || []).map(bw => byeWeekDateMs(bw))
  ];
  if(allDates.length === 0) return [];
  const startMonday = mondayOf(Math.min(...allDates));
  const endMonday = mondayOf(getLatestActiveDate());
  const weeks = [];
  for(let cur = startMonday; cur <= endMonday; cur += 7 * MS_PER_DAY){
    weeks.push(cur);
  }
  return weeks;
}

// Longest consecutive match win streak, tour-level only (qualifying
// excluded, same convention as career Win-Loss) — chronological by
// tournament date, then by when each result was actually entered as a
// tiebreak within the same tournament (works for main draw and WATP
// Finals round robin alike, without needing round-code-specific ordering).
function computeLongestWinStreaks(){
  const byPlayer = new Map();
  state.matches.forEach(m => {
    if(!isTourLevelMatch(m)) return;
    [m.playerAId, m.playerBId].forEach(pid => {
      if(!byPlayer.has(pid)) byPlayer.set(pid, []);
      byPlayer.get(pid).push(m);
    });
  });

  const streaks = new Map();
  byPlayer.forEach((matches, pid) => {
    const sorted = matches.slice().sort((a, b) => {
      const ta = tournamentById(a.tournamentId), tb = tournamentById(b.tournamentId);
      const da = ta ? tournamentDateMs(ta) : 0, db = tb ? tournamentDateMs(tb) : 0;
      return da - db || (a.createdAt || 0) - (b.createdAt || 0);
    });
    let current = 0, longest = 0;
    sorted.forEach(m => {
      if(m.winnerId === pid){ current++; if(current > longest) longest = current; }
      else current = 0;
    });
    streaks.set(pid, longest);
  });
  return streaks;
}

function computeHistoryRecords(){
  const weeks = getAllWeeklySeries();
  const weeksAtNo1 = new Map();
  const weeksInTop10 = new Map();
  state.players.forEach(p => { weeksAtNo1.set(p.id, 0); weeksInTop10.set(p.id, 0); });
  weeks.forEach(w => {
    const ranks = officialRanksAsOf(w);
    Object.keys(ranks).forEach(pid => {
      const r = ranks[pid];
      if(r === 1) weeksAtNo1.set(pid, (weeksAtNo1.get(pid) || 0) + 1);
      if(r <= 10) weeksInTop10.set(pid, (weeksInTop10.get(pid) || 0) + 1);
    });
  });
  return {weeksAtNo1, weeksInTop10};
}

// Every stint at No. 1, in chronological order — same week series and same
// per-week ranking calculation as computeHistoryRecords, so the totals here
// always sum to exactly the same "weeks at No. 1" figure shown elsewhere.
// "no" (the leaderboard-style numbering) only increments the first time a
// given player ever reaches No. 1; every later stint by that same player
// keeps their original number and just gets an occurrence count instead —
// same convention as the classic "list of WTA no. 1 players" tables.
function computeNo1ReignHistory(){
  const weeks = getAllWeeklySeries();
  const reigns = [];
  let currentPlayerId = null, reignStartIdx = null;

  weeks.forEach((w, i) => {
    const ranks = officialRanksAsOf(w);
    let no1Id = null;
    Object.keys(ranks).forEach(pid => { if(ranks[pid] === 1) no1Id = pid; });
    if(no1Id !== currentPlayerId){
      if(currentPlayerId !== null) reigns.push({playerId: currentPlayerId, startIdx: reignStartIdx, endIdx: i - 1});
      currentPlayerId = no1Id;
      reignStartIdx = i;
    }
  });
  if(currentPlayerId !== null) reigns.push({playerId: currentPlayerId, startIdx: reignStartIdx, endIdx: weeks.length - 1});

  const firstAppearanceOrder = [];
  const occurrenceCount = {};
  const cumulativeWeeks = {};

  return reigns.map(r => {
    const weeksInReign = r.endIdx - r.startIdx + 1;
    occurrenceCount[r.playerId] = (occurrenceCount[r.playerId] || 0) + 1;
    cumulativeWeeks[r.playerId] = (cumulativeWeeks[r.playerId] || 0) + weeksInReign;
    let no = null;
    if(!firstAppearanceOrder.includes(r.playerId)){
      firstAppearanceOrder.push(r.playerId);
      no = firstAppearanceOrder.length;
    }
    return {
      no,
      playerId: r.playerId,
      occurrence: occurrenceCount[r.playerId],
      startWeek: weeks[r.startIdx],
      endWeek: weeks[r.endIdx],
      weeksInReign,
      cumulativeTotal: cumulativeWeeks[r.playerId]
    };
  });
}

// Same row shape as renderRecordListInto, but without the top-10 cap — for
// the dedicated Ranking History page, which exists specifically to show
// the full list.
function renderRecordListFullInto(container, map, unitLabel){
  container.innerHTML = "";
  const rows = Array.from(map.entries())
    .map(([pid, count]) => ({p: playerById(pid), count}))
    .filter(r => r.p && r.count > 0)
    .sort((a,b) => b.count - a.count || a.p.name.localeCompare(b.p.name));
  if(rows.length === 0){
    container.appendChild(el("p", {class:"picker-empty-note"}, ["No data yet."]));
    return;
  }
  rows.forEach((r, i) => {
    container.appendChild(el("div", {class:"record-row"}, [
      el("span", {class:"record-rank"}, [String(i+1)]),
      el("span", {class:"record-name", html: playerLinkHTML(r.p)}),
      el("span", {class:"record-count"}, [String(r.count) + " " + unitLabel])
    ]));
  });
}

function renderRankHistoryPage(){
  const {weeksAtNo1, weeksInTop10} = computeHistoryRecords();
  renderRecordListFullInto($("#rh-weeks-no1-list"), weeksAtNo1, "wks");
  renderRecordListFullInto($("#rh-weeks-top10-list"), weeksInTop10, "wks");

  const reigns = computeNo1ReignHistory();
  const table = $("#rh-no1-table");
  const empty = $("#rh-no1-empty");
  if(reigns.length === 0){
    table.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  table.classList.remove("hidden");
  empty.classList.add("hidden");

  $("#rh-no1-body").innerHTML = reigns.map(r => {
    const p = playerById(r.playerId);
    if(!p) return "";
    const nameCell = flagImgHTML(p.country) + '<button class="player-link" data-open-player="' + p.id + '">' + escapeHtml(p.name) + '</button>' +
      (r.occurrence > 1 ? ' <span class="rh-occurrence">(' + r.occurrence + ')</span>' : "");
    return '<tr' + (r.no ? ' class="rh-first-row"' : '') + '>' +
      '<td class="record-rank-cell">' + (r.no || "") + '</td>' +
      '<td>' + nameCell + '</td>' +
      '<td>' + formatWeekDate(r.startWeek) + '</td>' +
      '<td>' + formatWeekDate(r.endWeek) + '</td>' +
      '<td>' + r.weeksInReign + '</td>' +
      '<td class="points-cell">' + r.cumulativeTotal + '</td>' +
      '</tr>';
  }).join("");
}

function computeTitlesByLevel(){
  const byLevel = {};
  Object.keys(LEVEL_LABELS).forEach(lvl => { byLevel[lvl] = new Map(); });
  state.tournaments.forEach(t => {
    const results = computeTournamentResults(t.id);
    results.forEach((res, pid) => {
      if(res.code === "W" && byLevel[t.level]){
        byLevel[t.level].set(pid, (byLevel[t.level].get(pid) || 0) + 1);
      }
    });
  });
  return byLevel;
}

function renderRecordListInto(container, map, unitLabel){
  container.innerHTML = "";
  const rows = Array.from(map.entries())
    .map(([pid, count]) => ({p: playerById(pid), count}))
    .filter(r => r.p && r.count > 0)
    .sort((a,b) => b.count - a.count || a.p.name.localeCompare(b.p.name))
    .slice(0, 10);
  if(rows.length === 0){
    container.appendChild(el("p", {class:"picker-empty-note"}, ["No data yet."]));
    return;
  }
  rows.forEach((r, i) => {
    container.appendChild(el("div", {class:"record-row"}, [
      el("span", {class:"record-rank"}, [String(i+1)]),
      el("span", {class:"record-name", html: playerLinkHTML(r.p)}),
      el("span", {class:"record-count"}, [String(r.count) + " " + unitLabel])
    ]));
  });
}

function renderRecords(){
  const empty = $("#records-empty");
  const body = $("#records-body");
  if(state.tournaments.length === 0 || state.matches.length === 0){
    empty.classList.remove("hidden");
    body.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  body.classList.remove("hidden");

  const {weeksAtNo1, weeksInTop10} = computeHistoryRecords();
  const careerTotals = computeRankings(null);
  const titlesOverall = new Map();
  careerTotals.forEach((v, pid) => titlesOverall.set(pid, v.titles));

  renderRecordListInto($("#record-weeks-no1 .record-list"), weeksAtNo1, "wks");
  renderRecordListInto($("#record-weeks-top10 .record-list"), weeksInTop10, "wks");
  renderRecordListInto($("#record-titles-overall .record-list"), titlesOverall, "titles");
  renderRecordListInto($("#record-win-streak .record-list"), computeLongestWinStreaks(), "wins");
  renderRecordListInto($("#record-top10-wins .record-list"), computeTop10WinsCounts(), "wins");

  const byLevel = computeTitlesByLevel();
  const levelContainer = $("#record-titles-by-level");
  levelContainer.innerHTML = "";
  Object.keys(LEVEL_LABELS).forEach(lvl => {
    const panel = el("div", {class:"record-panel"});
    panel.appendChild(el("h3", {}, [LEVEL_LABELS[lvl]]));
    const list = el("div", {class:"record-list"});
    panel.appendChild(list);
    levelContainer.appendChild(panel);
    renderRecordListInto(list, byLevel[lvl], "titles");
  });
}

/* ---------------- History view ---------------- */
/* ---------------- Grand Slam History ---------------- */
// Cumulative QF/SF/F/W appearances, either across every Grand Slam
// (majorName === null) or scoped to one specific major by name.
// Real slams have a fixed order in the calendar (Jan, May-Jun, Jun-Jul,
// Aug-Sep) — sorting by each major's average scheduled month, rather than
// alphabetically, gets Australian/French/Wimbledon/US Open in the right
// order automatically no matter what the user actually names them.
function averageMajorMonth(name){
  const editions = state.tournaments.filter(t => t.level === "GRAND_SLAM" && t.name === name && t.startDate);
  if(editions.length === 0) return null;
  const months = editions.map(t => new Date(t.startDate + "T00:00:00").getMonth());
  return months.reduce((a, b) => a + b, 0) / months.length;
}
function sortMajorNamesByCalendarOrder(names){
  return names.slice().sort((a, b) => {
    const ma = averageMajorMonth(a), mb = averageMajorMonth(b);
    if(ma === null && mb === null) return a.localeCompare(b);
    if(ma === null) return 1;
    if(mb === null) return -1;
    return ma - mb || a.localeCompare(b);
  });
}

function computeGrandSlamCareerStats(majorName){
  const stats = new Map();
  state.players.forEach(p => stats.set(p.id, {QF:0, SF:0, F:0, W:0}));
  const idxQF = ROUND_ORDER.indexOf("QF");
  const idxSF = ROUND_ORDER.indexOf("SF");
  const idxF = ROUND_ORDER.indexOf("F");

  state.tournaments
    .filter(t => t.level === "GRAND_SLAM" && (majorName == null || t.name === majorName))
    .forEach(t => {
      const results = computeTournamentResults(t.id);
      results.forEach((res, pid) => {
        const s = stats.get(pid);
        if(!s) return;
        if(res.code === "W"){
          s.QF++; s.SF++; s.F++; s.W++;
        } else {
          const idx = ROUND_ORDER.indexOf(res.code);
          if(idx >= idxQF) s.QF++;
          if(idx >= idxSF) s.SF++;
          if(idx >= idxF) s.F++;
        }
      });
    });
  return stats;
}

// "Total" (all majors combined, includes manually-added pre-WATP history)
// or a specific major's name — historical entries only ever apply to Total,
// since they aren't broken down by which major they came from.
let slamFilter = "TOTAL";

function populateSlamFilterToggle(){
  const namesFromTournaments = state.tournaments.filter(t => t.level === "GRAND_SLAM").map(t => t.name);
  const namesFromHistory = [];
  state.players.forEach(p => getHistoricalSlamsArray(p).forEach(e => { if(e.majorName) namesFromHistory.push(e.majorName); }));
  const majorNames = sortMajorNamesByCalendarOrder(Array.from(new Set([...namesFromTournaments, ...namesFromHistory])));

  const toggle = $("#slam-filter-toggle");
  toggle.innerHTML = '<button class="mode-btn" data-slam-filter="TOTAL">Total</button>' +
    majorNames.map(n => '<button class="mode-btn" data-slam-filter="' + escapeHtml(n) + '">' + escapeHtml(n) + '</button>').join("");
  $all("[data-slam-filter]").forEach(btn => btn.classList.toggle("active", btn.dataset.slamFilter === slamFilter));
}

let slamHistorySortCol = "W";

function renderGrandSlamHistory(){
  populateSlamFilterToggle();
  const isTotal = slamFilter === "TOTAL";
  const computed = computeGrandSlamCareerStats(isTotal ? null : slamFilter);

  const rows = state.players
    .map(p => {
      const c = computed.get(p.id) || {QF:0, SF:0, F:0, W:0};
      const h = historicalSlamsForMajor(p, isTotal ? null : slamFilter);
      return {
        p,
        s: {QF: c.QF + h.QF, SF: c.SF + h.SF, F: c.F + h.F, W: c.W + h.W},
        hasHistorical: !!(h.QF || h.SF || h.F || h.W)
      };
    })
    .filter(r => r.s.QF > 0);

  // Sorting is always primarily by whichever column you clicked — the
  // other three still break ties in the usual Titles>F>SF>QF order, so
  // sorting by "QF" surfaces the deepest overall careers among players
  // tied on quarterfinal count, not an arbitrary order.
  const metricOrder = ["W", "F", "SF", "QF"].filter(m => m !== slamHistorySortCol);
  rows.sort((a,b) =>
    b.s[slamHistorySortCol] - a.s[slamHistorySortCol] ||
    b.s[metricOrder[0]] - a.s[metricOrder[0]] ||
    b.s[metricOrder[1]] - a.s[metricOrder[1]] ||
    b.s[metricOrder[2]] - a.s[metricOrder[2]] ||
    a.p.name.localeCompare(b.p.name));

  const table = $("#slams-table");
  const empty = $("#slams-empty");
  if(rows.length === 0){
    table.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  table.classList.remove("hidden");
  empty.classList.add("hidden");

  $all("#slams-thead-row [data-slam-sort-col]").forEach(th => {
    th.classList.toggle("sort-active", th.dataset.slamSortCol === slamHistorySortCol);
  });

  const mark = (r) => r.hasHistorical ? '<span class="hist-marker">*</span>' : "";

  $("#slams-body").innerHTML = rows.map((r, i) => (
    '<tr>' +
    '<td class="record-rank-cell">' + (i + 1) + '</td>' +
    '<td><button class="player-link" data-open-player="' + r.p.id + '">' + flagImgHTML(r.p.country) + escapeHtml(r.p.name) + '</button></td>' +
    '<td class="country-chip">' + (r.p.country ? escapeHtml(r.p.country.toUpperCase()) : "—") + '</td>' +
    '<td>' + r.s.QF + mark(r) + '</td>' +
    '<td>' + r.s.SF + mark(r) + '</td>' +
    '<td>' + r.s.F + mark(r) + '</td>' +
    '<td class="points-cell">' + r.s.W + mark(r) + '</td>' +
    '<td><button class="btn btn-small btn-ghost" data-edit-slam-history="' + r.p.id + '">Edit</button></td>' +
    '</tr>'
  )).join("");
}

/* ---------------- WATP 1000 History (same shape as Slam History, no manual additions) ---------------- */
function computeThousandsCareerStats(tournamentName){
  const stats = new Map();
  state.players.forEach(p => stats.set(p.id, {QF:0, SF:0, F:0, W:0}));
  const idxQF = ROUND_ORDER.indexOf("QF");
  const idxSF = ROUND_ORDER.indexOf("SF");
  const idxF = ROUND_ORDER.indexOf("F");

  state.tournaments
    .filter(t => t.level === "WTA1000" && (tournamentName == null || t.name === tournamentName))
    .forEach(t => {
      const results = computeTournamentResults(t.id);
      results.forEach((res, pid) => {
        const s = stats.get(pid);
        if(!s) return;
        if(res.code === "W"){
          s.QF++; s.SF++; s.F++; s.W++;
        } else {
          const idx = ROUND_ORDER.indexOf(res.code);
          if(idx >= idxQF) s.QF++;
          if(idx >= idxSF) s.SF++;
          if(idx >= idxF) s.F++;
        }
      });
    });
  return stats;
}

let thousandsFilter = "TOTAL";

function populateThousandsFilterToggle(){
  const names = Array.from(new Set(state.tournaments.filter(t => t.level === "WTA1000").map(t => t.name))).sort();
  const toggle = $("#thousands-filter-toggle");
  toggle.innerHTML = '<button class="mode-btn" data-thousands-filter="TOTAL">Total</button>' +
    names.map(n => '<button class="mode-btn" data-thousands-filter="' + escapeHtml(n) + '">' + escapeHtml(n) + '</button>').join("");
  $all("[data-thousands-filter]").forEach(btn => btn.classList.toggle("active", btn.dataset.thousandsFilter === thousandsFilter));
}

let thousandsSortCol = "W";

function renderThousandsHistory(){
  populateThousandsFilterToggle();
  const isTotal = thousandsFilter === "TOTAL";
  const computed = computeThousandsCareerStats(isTotal ? null : thousandsFilter);

  const rows = state.players
    .map(p => ({p, s: computed.get(p.id) || {QF:0, SF:0, F:0, W:0}}))
    .filter(r => r.s.QF > 0);

  const metricOrder = ["W", "F", "SF", "QF"].filter(m => m !== thousandsSortCol);
  rows.sort((a,b) =>
    b.s[thousandsSortCol] - a.s[thousandsSortCol] ||
    b.s[metricOrder[0]] - a.s[metricOrder[0]] ||
    b.s[metricOrder[1]] - a.s[metricOrder[1]] ||
    b.s[metricOrder[2]] - a.s[metricOrder[2]] ||
    a.p.name.localeCompare(b.p.name));

  const table = $("#thousands-table");
  const empty = $("#thousands-empty");
  if(rows.length === 0){
    table.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  table.classList.remove("hidden");
  empty.classList.add("hidden");

  $all("#thousands-thead-row [data-thousands-sort-col]").forEach(th => {
    th.classList.toggle("sort-active", th.dataset.thousandsSortCol === thousandsSortCol);
  });

  $("#thousands-body").innerHTML = rows.map((r, i) => (
    '<tr>' +
    '<td class="record-rank-cell">' + (i + 1) + '</td>' +
    '<td><button class="player-link" data-open-player="' + r.p.id + '">' + flagImgHTML(r.p.country) + escapeHtml(r.p.name) + '</button></td>' +
    '<td class="country-chip">' + (r.p.country ? escapeHtml(r.p.country.toUpperCase()) : "—") + '</td>' +
    '<td>' + r.s.QF + '</td>' +
    '<td>' + r.s.SF + '</td>' +
    '<td>' + r.s.F + '</td>' +
    '<td class="points-cell">' + r.s.W + '</td>' +
    '</tr>'
  )).join("");
}

/* ---------------- Historical Grand Slam record (manual, purely additive) ---------------- */
// Reads a player's historical entries safely regardless of which shape is
// stored — a fresh save is always the new per-major array, but any player
// saved before this feature had per-major rows will still have the old
// flat {QF,SF,F,W} shape sitting in storage, so this treats that old shape
// as a single legacy row rather than losing it.
function getHistoricalSlamsArray(p){
  if(Array.isArray(p.historicalSlams)) return p.historicalSlams;
  if(p.historicalSlams && typeof p.historicalSlams === "object"){
    const h = p.historicalSlams;
    if(h.QF || h.SF || h.F || h.W){
      return [{id:"legacy", majorName:"Historical (Unspecified)", qf:h.QF||0, sf:h.SF||0, f:h.F||0, titles:h.W||0}];
    }
  }
  return [];
}
// majorName === null sums every entry (Total); otherwise scoped to one major.
function historicalSlamsForMajor(p, majorName){
  const entries = getHistoricalSlamsArray(p);
  const relevant = majorName == null ? entries : entries.filter(e => e.majorName === majorName);
  return relevant.reduce((acc, e) => ({
    QF: acc.QF + (Number(e.qf) || 0),
    SF: acc.SF + (Number(e.sf) || 0),
    F: acc.F + (Number(e.f) || 0),
    W: acc.W + (Number(e.titles) || 0)
  }), {QF:0, SF:0, F:0, W:0});
}

let eshSelectedPlayerId = null;

function buildEshPicker(){
  const wrap = $("#esh-player-picker");
  wrap.innerHTML = "";
  const p = eshSelectedPlayerId ? playerById(eshSelectedPlayerId) : null;
  const input = el("input", {type:"text", class:"picker-input", autocomplete:"off", placeholder:"Search player…", id:"esh-player-search"});
  input.value = p ? p.name : "";
  input.disabled = false;
  wrap.appendChild(input);
  wrap.appendChild(el("div", {class:"picker-suggestions hidden", id:"esh-player-suggestions"}));
}

function handleEshSearchInput(e){
  if(e.target.id !== "esh-player-search") return;
  const query = e.target.value;
  const suggestionsEl = $("#esh-player-suggestions");
  if(!query.trim()){ suggestionsEl.classList.add("hidden"); suggestionsEl.innerHTML = ""; return; }
  const results = state.players.filter(p => matchesSearch(p.name, query)).slice(0, 8);
  suggestionsEl.innerHTML = results.length
    ? results.map(p => '<button type="button" class="picker-option" data-esh-pick="' + p.id + '">' + playerNameHTML(p) + '</button>').join("")
    : '<div class="picker-empty">No match</div>';
  suggestionsEl.classList.remove("hidden");
}

function knownMajorNamesForDatalist(){
  const names = new Set(state.tournaments.filter(t => t.level === "GRAND_SLAM").map(t => t.name));
  state.players.forEach(p => getHistoricalSlamsArray(p).forEach(e => { if(e.majorName) names.add(e.majorName); }));
  return sortMajorNamesByCalendarOrder(Array.from(names));
}

function addEshRow(entry){
  const rows = $("#esh-rows");
  const row = el("div", {class:"esh-row"});
  const majorInput = el("input", {type:"text", placeholder:"Major name, e.g. Wimbledon", list:"esh-major-list"});
  majorInput.value = entry ? entry.majorName : "";
  const qfInput = el("input", {type:"number", min:"0", placeholder:"QF"});
  qfInput.value = entry ? entry.qf : "";
  const sfInput = el("input", {type:"number", min:"0", placeholder:"SF"});
  sfInput.value = entry ? entry.sf : "";
  const fInput = el("input", {type:"number", min:"0", placeholder:"F"});
  fInput.value = entry ? entry.f : "";
  const wInput = el("input", {type:"number", min:"0", placeholder:"Titles"});
  wInput.value = entry ? entry.titles : "";
  const removeBtn = el("button", {type:"button", class:"entry-list-remove"}, ["\u00d7"]);
  removeBtn.addEventListener("click", () => row.remove());
  row.appendChild(majorInput); row.appendChild(qfInput); row.appendChild(sfInput); row.appendChild(fInput); row.appendChild(wInput); row.appendChild(removeBtn);
  rows.appendChild(row);
}

function handleEshClick(e){
  const pickBtn = e.target.closest("[data-esh-pick]");
  if(!pickBtn) return;
  eshSelectedPlayerId = pickBtn.dataset.eshPick;
  buildEshPicker();
}

function openEditSlamHistory(playerId){
  const p = playerId ? playerById(playerId) : null;
  eshSelectedPlayerId = p ? p.id : null;

  if(!$("#esh-major-list")){
    document.body.appendChild(el("datalist", {id:"esh-major-list"}));
  }
  $("#esh-major-list").innerHTML = knownMajorNamesForDatalist().map(n => '<option value="' + escapeHtml(n) + '">').join("");

  $("#esh-rows").innerHTML = "";
  const entries = p ? getHistoricalSlamsArray(p) : [];
  if(entries.length === 0) addEshRow(null);
  else entries.forEach(addEshRow);

  buildEshPicker();
  $("#edit-slam-history-backdrop").classList.remove("hidden");
}
function closeEditSlamHistory(){
  $("#edit-slam-history-backdrop").classList.add("hidden");
  eshSelectedPlayerId = null;
}
function handleEditSlamHistoryForm(ev){
  ev.preventDefault();
  const p = eshSelectedPlayerId ? playerById(eshSelectedPlayerId) : null;
  if(!p){ alert("Search and pick a player first."); return; }

  const entries = [];
  let hadError = false;
  $all("#esh-rows .esh-row").forEach((row, i) => {
    const inputs = row.querySelectorAll("input");
    const majorName = inputs[0].value.trim();
    const qf = Math.max(0, Math.round(Number(inputs[1].value) || 0));
    const sf = Math.max(0, Math.round(Number(inputs[2].value) || 0));
    const f = Math.max(0, Math.round(Number(inputs[3].value) || 0));
    const w = Math.max(0, Math.round(Number(inputs[4].value) || 0));
    if(!majorName && qf === 0 && sf === 0 && f === 0 && w === 0) return; // skip fully-empty rows
    if(!majorName){ alert("Row " + (i + 1) + " needs a major name."); hadError = true; return; }
    if(w > f || f > sf || sf > qf){
      alert("Row " + (i + 1) + " (" + majorName + "): each stage should be at least as many as the next — Titles ≤ Finals ≤ Semifinals ≤ Quarterfinals.");
      hadError = true;
      return;
    }
    entries.push({id: uid("hs"), majorName, qf, sf, f, titles: w});
  });
  if(hadError) return;

  p.historicalSlams = entries;
  saveState();
  closeEditSlamHistory();
  renderGrandSlamHistory();
}

/* ---------------- Head to Head ---------------- */
let h2hPlayerA = null, h2hPlayerB = null;

function buildH2HPicker(side){
  const wrap = $("#h2h-picker-" + side.toLowerCase());
  wrap.innerHTML = "";
  const id = side === "A" ? h2hPlayerA : h2hPlayerB;
  const p = id ? playerById(id) : null;
  const input = el("input", {type:"text", class:"picker-input", autocomplete:"off", placeholder:"Search player…", "data-h2h-search": side});
  input.value = p ? p.name : "";
  wrap.appendChild(input);
  if(p){
    wrap.appendChild(el("button", {type:"button", class:"picker-clear", "data-h2h-clear": side}, ["\u00d7"]));
  }
  wrap.appendChild(el("div", {class:"picker-suggestions hidden", "data-h2h-suggestions": side}));
}

function handleH2HSearchInput(e){
  const side = e.target.dataset.h2hSearch;
  if(!side) return;
  const query = e.target.value;
  const suggestionsEl = document.querySelector('[data-h2h-suggestions="' + side + '"]');
  if(!query.trim()){ suggestionsEl.classList.add("hidden"); suggestionsEl.innerHTML = ""; return; }
  const otherSide = side === "A" ? h2hPlayerB : h2hPlayerA;
  const results = state.players
    .filter(p => p.id !== otherSide)
    .filter(p => matchesSearch(p.name, query))
    .slice(0, 8);
  suggestionsEl.innerHTML = results.length
    ? results.map(p => '<button type="button" class="picker-option" data-h2h-pick="' + side + '" data-player-id="' + p.id + '">' + playerNameHTML(p) + '</button>').join("")
    : '<div class="picker-empty">No match</div>';
  suggestionsEl.classList.remove("hidden");
}

function handleH2HClick(e){
  const pickBtn = e.target.closest("[data-h2h-pick]");
  if(pickBtn){
    const side = pickBtn.dataset.h2hPick;
    const pid = pickBtn.dataset.playerId;
    if(side === "A") h2hPlayerA = pid; else h2hPlayerB = pid;
    renderHeadToHead();
    return;
  }
  const clearBtn = e.target.closest("[data-h2h-clear]");
  if(clearBtn){
    const side = clearBtn.dataset.h2hClear;
    if(side === "A") h2hPlayerA = null; else h2hPlayerB = null;
    renderHeadToHead();
  }
}

function computeHeadToHead(idA, idB){
  const matches = state.matches.filter(m =>
    (m.playerAId === idA && m.playerBId === idB) || (m.playerAId === idB && m.playerBId === idA)
  );
  matches.sort((a,b) => {
    const ta = tournamentById(a.tournamentId), tb = tournamentById(b.tournamentId);
    return (tb ? tournamentDateMs(tb) : 0) - (ta ? tournamentDateMs(ta) : 0);
  });
  let winsA = 0, winsB = 0;
  const surfaceStats = {hard:{a:0,b:0}, clay:{a:0,b:0}, grass:{a:0,b:0}};
  matches.forEach(m => {
    const t = tournamentById(m.tournamentId);
    if(m.winnerId === idA) winsA++;
    else if(m.winnerId === idB) winsB++;
    if(t && surfaceStats[t.surface]){
      if(m.winnerId === idA) surfaceStats[t.surface].a++;
      else if(m.winnerId === idB) surfaceStats[t.surface].b++;
    }
  });
  return {matches, winsA, winsB, surfaceStats};
}

// A quick H2H popup for two players about to face off (or who already have)
// in a bracket, without leaving the bracket page — reuses computeHeadToHead
// (same source of truth as the full Head to Head page) and the existing
// general-purpose player modal, so there's no separate modal to maintain.
function openH2HPopup(idA, idB){
  const pA = playerById(idA), pB = playerById(idB);
  if(!pA || !pB) return;
  const {matches, winsA, winsB, surfaceStats} = computeHeadToHead(idA, idB);

  const modal = $("#player-modal");
  modal.innerHTML = "";
  modal.appendChild(el("h3", {}, ["Head to Head"]));
  modal.appendChild(el("div", {class:"h2h-header", html:
    '<span class="h2h-name">' + playerNameHTML(pA) + '</span>' +
    '<span class="h2h-score">' + winsA + '\u2013' + winsB + '</span>' +
    '<span class="h2h-name">' + playerNameHTML(pB) + '</span>'
  }));

  const surfaceRow = el("div", {class:"profile-stats"}, ["hard","clay","grass"].map(s =>
    el("div", {class:"stat-box"}, [
      el("div", {class:"stat-num"}, [surfaceStats[s].a + "\u2013" + surfaceStats[s].b]),
      el("div", {class:"stat-label"}, [s])
    ])
  ));
  modal.appendChild(surfaceRow);

  modal.appendChild(el("div", {class:"profile-section-title"}, ["All Meetings"]));
  if(matches.length === 0){
    modal.appendChild(el("p", {}, ["No previous meetings."]));
  } else {
    matches.forEach(m => {
      const t = tournamentById(m.tournamentId);
      const winner = playerById(m.winnerId);
      const row = el("div", {class:"tourney-row"}, [
        el("span", {class:"tourney-name"}, [t ? (t.name + " '" + String(t.year).slice(-2)) : ""]),
        el("span", {class:"tourney-champ", html: (winner ? playerLinkHTML(winner) : "(unknown)") + " won"}),
        el("span", {html: renderScoreboardHTML(m)})
      ]);
      modal.appendChild(row);
    });
  }

  modal.appendChild(el("div", {class:"modal-close-row"}, [
    el("span", {}),
    el("button", {class:"btn btn-ghost", id:"profile-close"}, ["Close"])
  ]));
  $("#player-modal-backdrop").classList.remove("hidden");
  $("#profile-close").addEventListener("click", closePlayerModal);
}

function renderHeadToHead(){
  buildH2HPicker("A");
  buildH2HPicker("B");
  const idA = h2hPlayerA;
  const idB = h2hPlayerB;
  const empty = $("#h2h-empty");
  const body = $("#h2h-body");

  const pA = idA ? playerById(idA) : null;
  const pB = idB ? playerById(idB) : null;

  if(!pA || !pB || idA === idB){
    body.classList.add("hidden");
    empty.classList.remove("hidden");
    empty.querySelector("p").textContent = (idA && idA === idB)
      ? "Choose two different players."
      : "Pick two players to see their head-to-head record.";
    return;
  }
  empty.classList.add("hidden");
  body.classList.remove("hidden");

  const {matches, winsA, winsB, surfaceStats} = computeHeadToHead(idA, idB);

  body.innerHTML = "";
  body.appendChild(el("div", {class:"h2h-header"}, [
    el("div", {class:"h2h-name", html: playerLinkHTML(pA)}),
    el("div", {class:"h2h-score"}, [winsA + " – " + winsB]),
    el("div", {class:"h2h-name", html: playerLinkHTML(pB)})
  ]));

  if(matches.length > 0){
    const surfaceRow = el("div", {class:"profile-stats"}, ["hard","clay","grass"].map(s =>
      el("div", {class:"stat-box"}, [
        el("div", {class:"stat-num"}, [surfaceStats[s].a + "-" + surfaceStats[s].b]),
        el("div", {class:"stat-label"}, [s])
      ])
    ));
    body.appendChild(surfaceRow);
  }

  body.appendChild(el("div", {class:"profile-section-title"}, ["All Meetings"]));
  if(matches.length === 0){
    body.appendChild(el("p", {}, ["These two haven't played each other yet."]));
  } else {
    matches.forEach(m => {
      const t = tournamentById(m.tournamentId);
      const a = playerById(m.playerAId), b = playerById(m.playerBId);
      if(!a || !b) return;
      body.appendChild(el("div", {class:"match-row"}, [
        el("span", {class:"match-round"}, [ROUND_LABELS[m.round] || m.round]),
        el("span", {class:"match-players", html:
          (m.winnerId === a.id ? '<span class="winner">' + playerLinkHTML(a) + '</span>' : playerLinkHTML(a)) +
          ' def. ' +
          (m.winnerId === b.id ? '<span class="winner">' + playerLinkHTML(b) + '</span>' : playerLinkHTML(b))
        }),
        el("span", {html: renderScoreboardHTML(m)}),
        el("span", {class:"match-tourney"}, [t ? (t.name + " '" + String(t.year).slice(-2)) : "—"])
      ]));
    });
  }
}

/* ---------------- Modals: add player / bulk add / add tournament ---------------- */
function openAddPlayer(){ $("#add-player-backdrop").classList.remove("hidden"); $("#ap-name").focus(); updateFlagPreview(); }
function closeAddPlayer(){ $("#add-player-backdrop").classList.add("hidden"); $("#add-player-form").reset(); updateFlagPreview(); }
function updateFlagPreview(){
  const code = $("#ap-country").value;
  const flag = flagImgHTML(code);
  $("#ap-flag-preview").innerHTML = flag ? flag + " " + escapeHtml(code.toUpperCase()) : (code ? "No flag found for that code" : "");
}

function openBulkAdd(){ $("#bulk-add-backdrop").classList.remove("hidden"); $("#ba-textarea").focus(); }
function closeBulkAdd(){ $("#bulk-add-backdrop").classList.add("hidden"); $("#ba-textarea").value = ""; $("#ba-msg").textContent = ""; }

function handleBulkAdd(ev){
  ev.preventDefault();
  const raw = $("#ba-textarea").value;
  const msg = $("#ba-msg");
  const lines = raw.split("\n").map(l => l.trim()).filter(l => l.length > 0);

  if(lines.length === 0){
    msg.textContent = "Paste at least one player first.";
    msg.className = "form-msg";
    return;
  }

  const existingNames = new Set(state.players.map(p => p.name.trim().toLowerCase()));
  let added = 0, skippedDup = 0;

  lines.forEach(line => {
    const parts = line.split(",");
    const name = parts[0].trim();
    const country = parts.length > 1 ? parts[1].trim().toUpperCase().slice(0,3) : "";
    if(!name) return;
    const key = name.toLowerCase();
    if(existingNames.has(key)){ skippedDup++; return; }
    existingNames.add(key);
    state.players.push({id: uid("p"), name, country, hand: "R", createdAt: Date.now()});
    added++;
  });

  if(added > 0) saveState();

  let text = added === 1 ? "Added 1 player." : "Added " + added + " players.";
  if(skippedDup > 0) text += " Skipped " + skippedDup + " already on the roster.";
  msg.textContent = text;
  msg.className = "form-msg ok";
  $("#ba-textarea").value = "";

  renderPlayers();
  renderRankings();
}

function openAddTournament(){ $("#add-tournament-backdrop").classList.remove("hidden"); $("#at-name").focus(); }
function closeAddTournament(){
  $("#add-tournament-backdrop").classList.add("hidden");
  $("#add-tournament-form").reset();
  $("#at-normal-fields").classList.remove("hidden");
  $("#at-finals-note").classList.add("hidden");
}

function handleAddPlayer(ev){
  ev.preventDefault();
  const name = $("#ap-name").value.trim();
  if(!name) return;
  const country = $("#ap-country").value.trim().toUpperCase();
  const hand = $("#ap-hand").value;
  const turnedPro = $("#ap-turnedpro").value ? Number($("#ap-turnedpro").value) : null;
  const height = $("#ap-height").value ? Number($("#ap-height").value) : null;
  state.players.push({id: uid("p"), name, country, hand, turnedPro, height, createdAt: Date.now()});
  saveState();
  closeAddPlayer();
  renderPlayers();
  renderRankings();
}

function openEditPlayer(id){
  const p = playerById(id);
  if(!p) return;
  $("#ep-id").value = p.id;
  $("#ep-name").value = p.name;
  $("#ep-country").value = p.country || "";
  $("#ep-hand").value = p.hand || "R";
  $("#ep-turnedpro").value = p.turnedPro || "";
  $("#ep-height").value = p.height || "";
  $("#ep-change-date").value = new Date().toISOString().slice(0, 10);
  updateEditFlagPreview();
  $("#edit-player-backdrop").classList.remove("hidden");
}
function closeEditPlayer(){
  $("#edit-player-backdrop").classList.add("hidden");
}
function updateEditFlagPreview(){
  const code = $("#ep-country").value;
  const flag = flagImgHTML(code);
  $("#ep-flag-preview").innerHTML = flag ? flag + " " + escapeHtml(code.toUpperCase()) : (code ? "No flag found for that code" : "");
}
function handleEditPlayer(ev){
  ev.preventDefault();
  const id = $("#ep-id").value;
  const p = playerById(id);
  if(!p) return;
  const name = $("#ep-name").value.trim();
  if(!name) return;
  const country = $("#ep-country").value.trim().toUpperCase();
  const changeDate = $("#ep-change-date").value || new Date().toISOString().slice(0, 10);

  // Log the change BEFORE overwriting, so the history entry captures what
  // it actually changed FROM. Name and country are logged as separate
  // entries even if both changed in the same edit, since they're
  // conceptually different kinds of change (and might not have actually
  // happened on the same real-world date, even though we only have one
  // date field to work with here).
  if(!Array.isArray(p.history)) p.history = [];
  if(name !== p.name){
    p.history.push({type:"name", from: p.name, to: name, date: changeDate, createdAt: Date.now()});
  }
  if(country !== (p.country || "")){
    p.history.push({type:"country", from: p.country || "", to: country, date: changeDate, createdAt: Date.now()});
  }

  p.name = name;
  p.country = country;
  p.hand = $("#ep-hand").value;
  p.turnedPro = $("#ep-turnedpro").value ? Number($("#ep-turnedpro").value) : null;
  p.height = $("#ep-height").value ? Number($("#ep-height").value) : null;
  saveState();
  closeEditPlayer();
  renderPlayers();
  renderRankings();
  if(!$("#player-modal-backdrop").classList.contains("hidden")){
    renderPlayerProfile(id);
  }
  if(currentBracketTournamentId){
    renderBracketPage();
  }
}

function openAddByeWeek(){ $("#add-byeweek-backdrop").classList.remove("hidden"); $("#bw-date").focus(); }
function closeAddByeWeek(){ $("#add-byeweek-backdrop").classList.add("hidden"); $("#add-byeweek-form").reset(); }
function handleAddByeWeek(ev){
  ev.preventDefault();
  const date = $("#bw-date").value;
  if(!date) return;
  const note = $("#bw-note").value.trim();
  if(!state.byeWeeks) state.byeWeeks = [];
  state.byeWeeks.push({id: uid("bw"), date, note, createdAt: Date.now()});
  saveState();
  closeAddByeWeek();
  renderTournaments();
}
function handleDeleteByeWeek(id){
  if(!confirm("Delete this bye week?")) return;
  state.byeWeeks = (state.byeWeeks || []).filter(bw => bw.id !== id);
  saveState();
  renderTournaments();
}

function handleAddTournament(ev){
  ev.preventDefault();
  const name = $("#at-name").value.trim();
  const startDate = $("#at-date").value;
  if(!name || !startDate) return;
  const location = $("#at-location").value.trim();
  const twoWeeks = $("#at-twoweeks").checked;
  const year = computeTournamentSeasonYear(new Date(startDate + "T00:00:00").getTime(), twoWeeks ? 14 : 7);
  const level = $("#at-level").value;
  const surface = $("#at-surface").value;

  if(level === "FINALS"){
    state.tournaments.push({
      id: uid("t"), name, location, level, surface, year, startDate, drawSize: 8,
      twoWeeks,
      bracketEntries: [], seeds: [], unseededEntrants: [],
      qualifying: {enabled:false, numQualifiers:8, numRounds:2, entrants:[], bracketEntries:[]},
      groups: [{id:"A", name:"Group A", playerIds:[]}, {id:"B", name:"Group B", playerIds:[]}],
      createdAt: Date.now()
    });
    saveState();
    closeAddTournament();
    renderTournaments();
    return;
  }

  const drawSize = Number($("#at-drawsize").value) || 32;
  const qualEnabled = $("#at-qual-enabled").checked;
  const qualNum = Number($("#at-qual-numqualifiers").value) || 8;
  const qualRounds = Number($("#at-qual-numrounds").value) || 2;
  state.tournaments.push({
    id: uid("t"), name, location, level, surface, year, startDate, drawSize,
    twoWeeks,
    bracketEntries: new Array(capacityOf(drawSize)).fill(0).map(() => ({type:"empty"})),
    seeds: new Array(numSeedsFor(drawSize)).fill(null),
    unseededEntrants: [],
    qualifying: {
      enabled: qualEnabled,
      numQualifiers: qualNum,
      numRounds: qualRounds,
      entrants: [],
      bracketEntries: new Array(qualNum * Math.pow(2, qualRounds)).fill(0).map(() => ({type:"empty"}))
    },
    createdAt: Date.now()
  });
  saveState();
  closeAddTournament();
  renderTournaments();
}

function openEditTournament(id){
  const t = tournamentById(id);
  if(!t) return;
  $("#et-id").value = t.id;
  $("#et-name").value = t.name;
  $("#et-location").value = t.location || "";
  $("#et-level").value = t.level;
  $("#et-surface").value = t.surface;
  $("#et-date").value = t.startDate || "";
  $("#et-twoweeks").checked = !!t.twoWeeks;
  $("#edit-tournament-backdrop").classList.remove("hidden");
}
function closeEditTournament(){
  $("#edit-tournament-backdrop").classList.add("hidden");
}
function handleEditTournament(ev){
  ev.preventDefault();
  const id = $("#et-id").value;
  const t = tournamentById(id);
  if(!t) return;
  const name = $("#et-name").value.trim();
  const startDate = $("#et-date").value;
  if(!name || !startDate) return;
  t.name = name;
  t.location = $("#et-location").value.trim();
  t.level = $("#et-level").value;
  t.surface = $("#et-surface").value;
  t.startDate = startDate;
  t.twoWeeks = $("#et-twoweeks").checked;
  t.year = computeTournamentSeasonYear(new Date(startDate + "T00:00:00").getTime(), t.twoWeeks ? 14 : 7);
  saveState();
  closeEditTournament();
  renderTournaments();
  renderRankings();
  if(currentBracketTournamentId === id) renderBracketPage();
}

function handleDeleteTournament(id){
  const t = tournamentById(id);
  if(!t) return;
  const matchCount = matchesForTournament(id).length;
  const warning = matchCount > 0
    ? "Delete \"" + t.name + "\"? This also removes its " + matchCount + " recorded result" + (matchCount===1?"":"s") + ". This can't be undone."
    : "Delete \"" + t.name + "\"? This can't be undone.";
  if(!confirm(warning)) return;
  state.tournaments = state.tournaments.filter(x => x.id !== id);
  state.matches = state.matches.filter(m => m.tournamentId !== id);
  saveState();
  if(currentBracketTournamentId === id) closeBracket();
  renderTournaments();
  renderRankings();
}

/* ---------------- Tab / view switching ---------------- */
function switchView(view){
  $all(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === view));
  // The dropdown toggle itself has no data-view (it just opens the menu),
  // so it needs its own check — it should read as "active" whenever any of
  // its three sub-pages is the one currently showing.
  $("#records-dropdown-toggle").classList.toggle("active", view === "records" || view === "rank-history" || view === "slams" || view === "thousands");
  $all(".view").forEach(v => v.classList.toggle("hidden", v.id !== "view-" + view));
  if(view !== "tourney-history") currentTourneyHistoryName = null;
  if(view === "rankings") renderRankings();
  if(view === "players") renderPlayers();
  if(view === "tournaments") renderTournaments();
  if(view === "records") renderRecords();
  if(view === "rank-history") renderRankHistoryPage();
  if(view === "slams") renderGrandSlamHistory();
  if(view === "thousands") renderThousandsHistory();
  if(view === "h2h") renderHeadToHead();
}

/* ---------------- Backup: export / import ---------------- */
function handleExportData(){
  const payload = {
    app: "fortnight-watp-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: state
  };
  const dataStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([dataStr], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = "fortnight-watp-backup-" + dateStamp + ".json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function handleImportFileSelected(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    let parsed;
    try{
      parsed = JSON.parse(ev.target.result);
    }catch(err){
      alert("Couldn't read that file — make sure it's a valid JSON backup exported from this app.");
      e.target.value = "";
      return;
    }
    // Accept either the wrapped export format or a raw {players,tournaments,matches} object.
    const payload = (parsed && parsed.data && typeof parsed.data === "object") ? parsed.data : parsed;
    if(!payload || !Array.isArray(payload.players) || !Array.isArray(payload.tournaments) || !Array.isArray(payload.matches)){
      alert("That doesn't look like a valid Fortnight backup file.");
      e.target.value = "";
      return;
    }
    const summary = payload.players.length + " players, " + payload.tournaments.length +
      " tournaments, and " + payload.matches.length + " results";
    if(!confirm("Import this backup (" + summary + ")? This replaces everything currently in your browser. This can't be undone.")){
      e.target.value = "";
      return;
    }
    state = {
      players: payload.players,
      tournaments: payload.tournaments,
      matches: payload.matches
    };
    saveState();
    location.reload();
  };
  reader.readAsText(file);
}

/* ---------------- Wire up events ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  migrateLegacyGsRoundCodes();
  migrateTournamentSeasonYears();

  // Only tabs with a real destination switch views directly — the Records
  // dropdown's own toggle button is styled the same but has no data-view
  // (it just opens/closes the menu), so it needs to be excluded here or
  // clicking it would try to switch to a view named "undefined".
  $all(".tab").forEach(tab => tab.addEventListener("click", () => { if(tab.dataset.view) switchView(tab.dataset.view); }));

  $("#records-dropdown-toggle").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#records-dropdown-menu").classList.toggle("hidden");
  });
  $("#records-dropdown-menu").addEventListener("click", (e) => {
    if(e.target.closest("[data-view]")) $("#records-dropdown-menu").classList.add("hidden");
  });
  document.addEventListener("click", (e) => {
    if(!e.target.closest("#records-dropdown")) $("#records-dropdown-menu").classList.add("hidden");
  });

  $("#rankings-year").addEventListener("change", renderRankings);

  $("#open-add-player").addEventListener("click", openAddPlayer);
  $("#header-add-player").addEventListener("click", openAddPlayer);
  $("#global-search-input").addEventListener("input", handleGlobalSearchInput);
  $("#global-search-wrap").addEventListener("click", handleGlobalSearchClick);
  $("#ap-cancel").addEventListener("click", closeAddPlayer);
  $("#add-player-form").addEventListener("submit", handleAddPlayer);
  $("#add-player-backdrop").addEventListener("click", (e) => { if(e.target.id === "add-player-backdrop") closeAddPlayer(); });
  $("#ap-country").addEventListener("input", updateFlagPreview);

  $("#ep-cancel").addEventListener("click", closeEditPlayer);
  $("#edit-player-form").addEventListener("submit", handleEditPlayer);
  $("#edit-player-backdrop").addEventListener("click", (e) => { if(e.target.id === "edit-player-backdrop") closeEditPlayer(); });
  $("#ep-country").addEventListener("input", updateEditFlagPreview);

  $("#open-bulk-add").addEventListener("click", openBulkAdd);
  $("#ba-cancel").addEventListener("click", closeBulkAdd);
  $("#bulk-add-form").addEventListener("submit", handleBulkAdd);
  $("#bulk-add-backdrop").addEventListener("click", (e) => { if(e.target.id === "bulk-add-backdrop") closeBulkAdd(); });

  $("#open-add-tournament").addEventListener("click", openAddTournament);
  $("#at-cancel").addEventListener("click", closeAddTournament);
  $("#add-tournament-form").addEventListener("submit", handleAddTournament);
  $("#add-tournament-backdrop").addEventListener("click", (e) => { if(e.target.id === "add-tournament-backdrop") closeAddTournament(); });
  $("#at-qual-enabled").addEventListener("change", (e) => {
    $("#at-qual-fields").classList.toggle("hidden", !e.target.checked);
  });
  $("#at-level").addEventListener("change", (e) => {
    const isFinals = e.target.value === "FINALS";
    $("#at-normal-fields").classList.toggle("hidden", isFinals);
    $("#at-finals-note").classList.toggle("hidden", !isFinals);
  });

  $("#tournaments-year-filter").addEventListener("change", renderTournaments);
  $("#rp-cancel").addEventListener("click", closeRetirePlayerModal);
  $("#retire-player-form").addEventListener("submit", handleRetirePlayerForm);
  $("#retire-player-backdrop").addEventListener("click", (e) => { if(e.target.id === "retire-player-backdrop") closeRetirePlayerModal(); });

  $("#open-add-bye-week").addEventListener("click", openAddByeWeek);
  $("#bw-cancel").addEventListener("click", closeAddByeWeek);
  $("#add-byeweek-form").addEventListener("submit", handleAddByeWeek);
  $("#add-byeweek-backdrop").addEventListener("click", (e) => { if(e.target.id === "add-byeweek-backdrop") closeAddByeWeek(); });

  $("#et-cancel").addEventListener("click", closeEditTournament);
  $("#edit-tournament-form").addEventListener("submit", handleEditTournament);
  $("#edit-tournament-backdrop").addEventListener("click", (e) => { if(e.target.id === "edit-tournament-backdrop") closeEditTournament(); });

  $("#bracket-back").addEventListener("click", closeBracket);
  $("#tourney-history-back").addEventListener("click", closeTournamentHistory);
  $("#bracket-subnav").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-bracket-tab]");
    if(!btn || btn.classList.contains("hidden")) return;
    switchBracketSubTab(btn.dataset.bracketTab);
  });
  $("#bracket-toggle-seed").addEventListener("click", () => $("#bracket-seed-grid").classList.toggle("hidden"));
  $("#bracket-seed-grid").addEventListener("change", handleSeedSelectChange);
  $("#bracket-seeds-list").addEventListener("input", handleSeedSearchInput);
  $("#bracket-seeds-list").addEventListener("click", handleSeedsListClick);
  $("#bracket-unseeded-list").addEventListener("input", handleEntrantSearchInput);
  $("#bracket-unseeded-list").addEventListener("click", handleUnseededListClick);
  $("#bracket-generate-draw").addEventListener("click", handleGenerateDraw);

  $("#qual-enabled").addEventListener("change", handleQualConfigChange);
  $("#qual-numqualifiers").addEventListener("change", handleQualConfigChange);
  $("#qual-numrounds").addEventListener("change", handleQualConfigChange);
  $("#qual-entrants-list").addEventListener("input", handleQualEntrantSearchInput);
  $("#qual-entrants-list").addEventListener("click", handleQualEntrantsListClick);
  $("#qual-generate-draw").addEventListener("click", handleGenerateQualifyingDraw);
  $("#qual-add-to-main").addEventListener("click", handleAddQualifiersToMain);

  $("#bracket-autofill-main").addEventListener("click", handleAutofillMain);
  $("#bracket-autofill-qual").addEventListener("click", handleAutofillQual);
  $("#entry-list-body").addEventListener("input", handleEntryListSearchInput);
  $("#entry-list-body").addEventListener("click", handleEntryListClick);
  $("#finals-entry-container").addEventListener("input", handleFinalsGroupSearchInput);
  $("#finals-entry-container").addEventListener("click", handleFinalsEntryClick);
  $("#entry-list-generate").addEventListener("click", handleGenerateField);
  $("#bracket-entry-date").addEventListener("change", () => {
    const t = tournamentById(currentBracketTournamentId);
    if(t) renderEntryListBody(t);
  });
  $("#bracket-seed-date").addEventListener("change", () => {
    const t = tournamentById(currentBracketTournamentId);
    if(t) renderEntryListBody(t);
  });
  $("#entry-list-process").addEventListener("click", handleProcessEntryList);

  document.addEventListener("click", (e) => {
    if(!e.target.closest(".picker-wrap")){
      $all(".picker-suggestions").forEach(s => s.classList.add("hidden"));
    }
  });

  // Rank-history chart: a custom tooltip on hover (styled, instant, unlike
  // the browser's native title tooltip) and clicking a point jumps straight
  // to that week's full Rankings table for context on who else was around
  // them that week.
  function chartTooltipEl(){
    let tip = document.getElementById("chart-tooltip");
    if(!tip){
      tip = document.createElement("div");
      tip.id = "chart-tooltip";
      tip.className = "chart-tooltip hidden";
      document.body.appendChild(tip);
    }
    return tip;
  }
  document.addEventListener("mouseover", (e) => {
    const pt = e.target.closest(".rank-chart-hit");
    if(!pt) return;
    const tip = chartTooltipEl();
    const week = Number(pt.dataset.chartWeek);
    const rank = pt.dataset.chartRank;
    const delta = pt.dataset.chartDelta;
    tip.innerHTML = '<b>No. ' + rank + '</b><br>' + formatWeekDate(week) + (delta ? '<br>' + delta : '') + '<br><span class="chart-tooltip-hint">Click for full rankings</span>';
    const rect = pt.getBoundingClientRect();
    tip.style.left = (rect.left + rect.width / 2) + "px";
    tip.style.top = (rect.top - 8) + "px";
    tip.classList.remove("hidden");
  });
  document.addEventListener("mouseout", (e) => {
    if(e.target.closest(".rank-chart-hit")) chartTooltipEl().classList.add("hidden");
  });
  document.addEventListener("click", (e) => {
    const pt = e.target.closest(".rank-chart-hit");
    if(!pt) return;
    const week = mondayOf(Number(pt.dataset.chartWeek));
    closePlayerModal();
    switchView("rankings");
    $("#rankings-year").value = "week:" + week;
    renderRankings();
  });

  // Same shared tooltip element as the rank-history chart above — the
  // breakdown table's cells already carry a click-to-open-bracket action
  // (via data-open-bracket, handled by the existing global click delegation
  // further down), this just adds a richer hover on top of that.
  document.addEventListener("mouseover", (e) => {
    const cell = e.target.closest("[data-breakdown-tip]");
    if(!cell) return;
    const tip = chartTooltipEl();
    const [name, result, points, countedNote] = cell.dataset.breakdownTip.split("\u001F");
    tip.innerHTML = '<b>' + escapeHtml(name) + '</b><br>' + escapeHtml(result) + ' \u2014 ' + escapeHtml(points) + '<br>' + escapeHtml(countedNote) + '<br><span class="chart-tooltip-hint">Click for bracket</span>';
    const rect = cell.getBoundingClientRect();
    tip.style.left = (rect.left + rect.width / 2) + "px";
    tip.style.top = (rect.top - 8) + "px";
    tip.classList.remove("hidden");
  });
  document.addEventListener("mouseout", (e) => {
    if(e.target.closest("[data-breakdown-tip]")) chartTooltipEl().classList.add("hidden");
  });

  $("#rankings-search").addEventListener("input", renderRankings);
  $("#rankings-mode-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-rankings-mode]");
    if(!btn) return;
    rankingsMode = btn.dataset.rankingsMode;
    renderRankings();
  });

  $("#view-h2h").addEventListener("input", handleH2HSearchInput);
  $("#view-h2h").addEventListener("click", handleH2HClick);
  $("#slam-filter-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-slam-filter]");
    if(!btn) return;
    slamFilter = btn.dataset.slamFilter;
    renderGrandSlamHistory();
  });
  $("#thousands-filter-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-thousands-filter]");
    if(!btn) return;
    thousandsFilter = btn.dataset.thousandsFilter;
    renderThousandsHistory();
  });

  $("#open-add-slam-history").addEventListener("click", () => openEditSlamHistory(null));
  $("#esh-cancel").addEventListener("click", closeEditSlamHistory);
  $("#edit-slam-history-form").addEventListener("submit", handleEditSlamHistoryForm);
  $("#edit-slam-history-backdrop").addEventListener("click", (e) => { if(e.target.id === "edit-slam-history-backdrop") closeEditSlamHistory(); });
  $("#esh-player-picker").addEventListener("input", handleEshSearchInput);
  $("#esh-player-picker").addEventListener("click", handleEshClick);
  $("#esh-add-row").addEventListener("click", () => addEshRow(null));
  $("#slams-body").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-edit-slam-history]");
    if(btn) openEditSlamHistory(btn.dataset.editSlamHistory);
  });

  $("#player-modal-backdrop").addEventListener("click", (e) => { if(e.target.id === "player-modal-backdrop") closePlayerModal(); });
  $("#ll-modal-backdrop").addEventListener("click", (e) => { if(e.target.id === "ll-modal-backdrop") closeLuckyLoserPicker(); });
  $("#ll-modal-backdrop").addEventListener("click", (e) => {
    const closeBtn = e.target.closest("#ll-modal-close");
    if(closeBtn) closeLuckyLoserPicker();
    const pickBtn = e.target.closest("[data-select-ll]");
    if(pickBtn) handleSelectLuckyLoser(pickBtn.dataset.selectLl);
  });

  $("#edit-gs-grid-backdrop").addEventListener("click", (e) => { if(e.target.id === "edit-gs-grid-backdrop") closeEditGsGrid(); });
  $("#edit-gs-grid-backdrop").addEventListener("click", (e) => {
    const closeBtn = e.target.closest("#edit-gs-grid-close");
    if(closeBtn){ closeEditGsGrid(); return; }
    const loadBtn = e.target.closest("#gs-load-year");
    if(loadBtn){ handleLoadGsYear(); return; }
    const saveBtn = e.target.closest("#gs-save-year");
    if(saveBtn){ handleSaveGsYear(); return; }
    const jumpBtn = e.target.closest("[data-gs-jump-year]");
    if(jumpBtn){ editGsGridYear = Number(jumpBtn.dataset.gsJumpYear); renderEditGsGridModal(); return; }
    const removeBtn = e.target.closest("[data-remove-gs-entry]");
    if(removeBtn){ handleRemoveGsEntry(removeBtn.dataset.removeGsEntry); return; }
  });

  $("#open-points-config").addEventListener("click", openPointsConfigEditor);
  $("#points-config-backdrop").addEventListener("click", (e) => { if(e.target.id === "points-config-backdrop") closePointsConfigEditor(); });
  $("#points-config-backdrop").addEventListener("click", (e) => {
    const closeBtn = e.target.closest("#points-config-close");
    if(closeBtn){ closePointsConfigEditor(); return; }
    const addBtn = e.target.closest("#pc-add-bracket");
    if(addBtn){ handleAddPointsBracket(); return; }
    const saveBtn = e.target.closest("#pc-save");
    if(saveBtn){ handleSavePointsConfig(); return; }
    const resetBtn = e.target.closest("#pc-reset-defaults");
    if(resetBtn){ handleResetPointsConfigDefaults(); return; }
    const removeBracketBtn = e.target.closest("[data-pc-remove-bracket]");
    if(removeBracketBtn){
      const [level, idx] = removeBracketBtn.dataset.pcRemoveBracket.split(":");
      handleRemovePointsBracket(level, Number(idx));
      return;
    }
  });

  document.addEventListener("click", (e) => {
    const retireBtn = e.target.closest("[data-toggle-retire]");
    if(retireBtn){ handleToggleRetire(retireBtn.dataset.toggleRetire); return; }
    const toggleBtn = e.target.closest("[data-toggle-breakdown]");
    if(toggleBtn && !e.target.closest(".player-link")){
      const pid = toggleBtn.dataset.toggleBreakdown;
      expandedRankingRow = expandedRankingRow === pid ? null : pid;
      renderRankings();
      return;
    }
    const editBtn = e.target.closest("[data-edit-player]");
    if(editBtn){ openEditPlayer(editBtn.dataset.editPlayer); return; }
    const editGsBtn = e.target.closest("[data-edit-gs-grid]");
    if(editGsBtn){ openEditGsGrid(editGsBtn.dataset.editGsGrid); return; }
    const openBtn = e.target.closest("[data-open-player]");
    if(openBtn){ renderPlayerProfile(openBtn.dataset.openPlayer); return; }
    const sortTh = e.target.closest("[data-sort-col]");
    if(sortTh){
      const col = sortTh.dataset.sortCol;
      if(finalsHistorySort.col === col){
        finalsHistorySort.dir = finalsHistorySort.dir === "asc" ? "desc" : "asc";
      } else {
        finalsHistorySort = {col, dir: "desc"};
      }
      if(profileYearFilterPlayerId) renderPlayerProfile(profileYearFilterPlayerId);
      return;
    }
    const slamSortTh = e.target.closest("[data-slam-sort-col]");
    if(slamSortTh){
      slamHistorySortCol = slamSortTh.dataset.slamSortCol;
      renderGrandSlamHistory();
      return;
    }
    const thousandsSortTh = e.target.closest("[data-thousands-sort-col]");
    if(thousandsSortTh){
      thousandsSortCol = thousandsSortTh.dataset.thousandsSortCol;
      renderThousandsHistory();
      return;
    }
    const bracketBtn = e.target.closest("[data-open-bracket]");
    if(bracketBtn){ openBracket(bracketBtn.dataset.openBracket); return; }
    const tourneyHistBtn = e.target.closest("[data-open-tourney-history]");
    if(tourneyHistBtn){ openTournamentHistory(tourneyHistBtn.dataset.openTourneyHistory); return; }
    const editTBtn = e.target.closest("[data-edit-tournament]");
    if(editTBtn){ openEditTournament(editTBtn.dataset.editTournament); return; }
    const delTBtn = e.target.closest("[data-delete-tournament]");
    if(delTBtn){ handleDeleteTournament(delTBtn.dataset.deleteTournament); return; }
    const delBwBtn = e.target.closest("[data-delete-byeweek]");
    if(delBwBtn){ handleDeleteByeWeek(delBwBtn.dataset.deleteByeweek); return; }
  });

  $("#export-data").addEventListener("click", handleExportData);
  $("#import-data-trigger").addEventListener("click", () => $("#import-data-input").click());
  $("#import-data-input").addEventListener("change", handleImportFileSelected);

  $("#reset-all-data").addEventListener("click", () => {
    const summary = state.players.length + " players, " + state.tournaments.length +
      " tournaments, and " + state.matches.length + " results";
    if(confirm("This permanently deletes everything — " + summary + ". This can't be undone. Continue?")){
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    }
  });

  renderRankings();
});

})();
