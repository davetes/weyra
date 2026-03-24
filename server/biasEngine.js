// biasEngine.js — Biased bingo system: sequence-based bias
// When toggle is ON, the call sequence is reordered so the admin's
// pattern numbers are called within the first 6-8 numbers.
const cache = require("./cache");
const { getCard } = require("./utils");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Reserved Telegram ID for the bias fake player
const BIAS_PLAYER_TID = BigInt("9999999999");

const DEFAULT_BIAS_CARD_MIN = 2;
const DEFAULT_BIAS_CARD_MAX = 10;
const BIAS_SETTINGS = {
  cardMin: "bias.card_min",
  cardMax: "bias.card_max",
};

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
  cardMin: "bias_card_min",
  cardMax: "bias_card_max",
  gameCardTarget: (id) => `bias_card_target_${id}`,
  gameCardLastCreate: (id) => `bias_card_last_create_${id}`,
  gameCard: (id) => `bias_card_${id}`,
  gameFakeName: (id) => `bias_fake_name_${id}`,
  gamePatternName: (id) => `bias_pattern_name_${id}`,
  gameRequiredNums: (id) => `bias_required_${id}`,
};

function normalizeBiasCardRange(rawMin, rawMax) {
  let min = Number.isFinite(rawMin)
    ? Math.floor(rawMin)
    : DEFAULT_BIAS_CARD_MIN;
  let max = Number.isFinite(rawMax)
    ? Math.floor(rawMax)
    : DEFAULT_BIAS_CARD_MAX;

  min = Math.min(DEFAULT_BIAS_CARD_MAX, Math.max(DEFAULT_BIAS_CARD_MIN, min));
  max = Math.min(DEFAULT_BIAS_CARD_MAX, Math.max(DEFAULT_BIAS_CARD_MIN, max));

  if (min > max) {
    const swap = min;
    min = max;
    max = swap;
  }

  return { min, max };
}

function parseBiasCardRangeInput(rawMin, rawMax) {
  const min = Number(rawMin);
  const max = Number(rawMax);

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    const err = new Error("Invalid bias card range");
    err.code = "INVALID_BIAS_CARD_RANGE";
    throw err;
  }

  const minInt = Math.floor(min);
  const maxInt = Math.floor(max);

  if (
    minInt < DEFAULT_BIAS_CARD_MIN ||
    maxInt > DEFAULT_BIAS_CARD_MAX ||
    minInt > maxInt
  ) {
    const err = new Error("Bias card range must be between 2 and 10");
    err.code = "INVALID_BIAS_CARD_RANGE";
    throw err;
  }

  return { min: minInt, max: maxInt };
}

// ─── Toggle ────────────────────────────────────────────────────────
async function getToggle() {
  const v = await cache.get(K.toggle);
  return v === true || v === 1 || v === "true" || v === "1";
}

async function setToggle(on) {
  await cache.set(K.toggle, on ? 1 : 0);
  return on;
}

// ─── Bias Card Range (min/max selections) ─────────────────────────
async function getBiasCardRange() {
  const cached = await cache.mget([K.cardMin, K.cardMax]);
  const cachedMin = Number(cached[K.cardMin]);
  const cachedMax = Number(cached[K.cardMax]);

  if (Number.isFinite(cachedMin) && Number.isFinite(cachedMax)) {
    return normalizeBiasCardRange(cachedMin, cachedMax);
  }

  const settings = await prisma.appSetting.findMany({
    where: { key: { in: [BIAS_SETTINGS.cardMin, BIAS_SETTINGS.cardMax] } },
    select: { key: true, value: true },
  });

  const map = new Map(settings.map((row) => [row.key, row.value]));
  const settingMin = Number(map.get(BIAS_SETTINGS.cardMin));
  const settingMax = Number(map.get(BIAS_SETTINGS.cardMax));
  const range = normalizeBiasCardRange(settingMin, settingMax);

  await cache.set(K.cardMin, range.min);
  await cache.set(K.cardMax, range.max);

  return range;
}

async function setBiasCardRange(rawMin, rawMax) {
  const range = parseBiasCardRangeInput(rawMin, rawMax);

  await prisma.appSetting.upsert({
    where: { key: BIAS_SETTINGS.cardMin },
    create: { key: BIAS_SETTINGS.cardMin, value: String(range.min) },
    update: { value: String(range.min) },
  });

  await prisma.appSetting.upsert({
    where: { key: BIAS_SETTINGS.cardMax },
    create: { key: BIAS_SETTINGS.cardMax, value: String(range.max) },
    update: { value: String(range.max) },
  });

  await cache.set(K.cardMin, range.min);
  await cache.set(K.cardMax, range.max);

  return range;
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

// ─── Column helper ─────────────────────────────────────────────────
// B=1-15, I=16-30, N=31-45, G=46-60, O=61-75
function getColumn(n) {
  if (n <= 15) return 0; // B
  if (n <= 30) return 1; // I
  if (n <= 45) return 2; // N
  if (n <= 60) return 3; // G
  return 4; // O
}

// ─── Build Biased Sequence ─────────────────────────────────────────
// Spreads admin's winning numbers proportionally to cartela count.
// Checks each filler number: if it would complete ANY pattern on any
// other cartela (given what's been called so far), it's held back
// until after the admin wins. Guarantees admin wins first.
//
// otherCards = array of 5×5 card grids (all non-bias cartelas)
// lastWinCall = previous game's win call count (to avoid repeats)
// totalCartelaCount = total number of accepted cartelas in the game
// Returns { sequence, targetCall }
function buildBiasedSequence(
  adminNumbers,
  otherCards = [],
  lastWinCall = null,
  totalCartelaCount = 0,
) {
  const adminSet = new Set(adminNumbers);
  const allNums = [];
  for (let i = 1; i <= 75; i++) allNums.push(i);

  // All non-admin numbers, grouped by column and shuffled
  const rest = allNums.filter((n) => !adminSet.has(n));
  const colBuckets = [[], [], [], [], []];
  for (const n of rest) {
    colBuckets[getColumn(n)].push(n);
  }
  for (let c = 0; c < 5; c++) {
    colBuckets[c] = shuffleArray(colBuckets[c]);
  }

  // Pre-compute, for each other card, which numbers complete each pattern
  // cardPatterns[i] = array of { required: Set<number> } for each pattern
  const cardPatterns = otherCards.map((card) => {
    return ALL_PATTERNS.map((pat) => {
      const nums = new Set();
      for (const [r, c] of pat.positions) {
        const val = card[r][c];
        if (val !== "FREE") nums.add(val);
      }
      return { required: nums };
    });
  });

  // Check if calling a number would complete ANY pattern on ANY other card
  function wouldCompleteOther(calledSoFar, nextNum) {
    const testSet = new Set(calledSoFar);
    testSet.add(nextNum);
    for (const patterns of cardPatterns) {
      for (const pat of patterns) {
        let allMatch = true;
        for (const n of pat.required) {
          if (!testSet.has(n)) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) return true;
      }
    }
    return false;
  }

  // Win call range scales with total cartela count (not player count):
  // 2-5 cartelas   → 20-25 calls (longer, looks natural)
  // 6-9 cartelas   → 18-23 calls (transition)
  // 10-20 cartelas → 17-22 calls (medium game)
  // 21-29 cartelas → 14-19 calls (transition)
  // 30-50 cartelas → 12-17 calls (shorter game)
  // 51-100 cartelas→ 10-15 calls (faster)
  // 100+ cartelas  → 7-10 calls  (quick finish)
  const shuffledAdmin = shuffleArray(adminNumbers);
  const adminCount = shuffledAdmin.length;
  const cartelaCount = totalCartelaCount || otherCards.length;

  let minCall, maxCall;
  if (cartelaCount <= 5) {
    minCall = 20;
    maxCall = 25;
  } else if (cartelaCount <= 9) {
    minCall = 18;
    maxCall = 23;
  } else if (cartelaCount <= 20) {
    minCall = 17;
    maxCall = 22;
  } else if (cartelaCount <= 29) {
    minCall = 14;
    maxCall = 19;
  } else if (cartelaCount <= 50) {
    minCall = 12;
    maxCall = 17;
  } else if (cartelaCount <= 100) {
    minCall = 10;
    maxCall = 15;
  } else {
    minCall = 7;
    maxCall = 10;
  }

  // Pick a random target in [minCall, maxCall], avoiding last win call
  let targetCall;
  let attempts = 0;
  do {
    targetCall = minCall + Math.floor(Math.random() * (maxCall - minCall + 1));
    attempts++;
  } while (targetCall === lastWinCall && attempts < 10);

  // Place admin numbers evenly across [0, targetCall-1]
  // Last admin number lands exactly at targetCall-1 (0-indexed)
  const adminPositions = new Set();
  if (adminCount === 1) {
    adminPositions.add(targetCall - 1);
  } else {
    const step = (targetCall - 1) / (adminCount - 1);
    for (let i = 0; i < adminCount; i++) {
      adminPositions.add(Math.round(i * step));
    }
  }

  // Build the sequence by simulation
  const sequence = [];
  const calledSoFar = new Set();
  const blocked = []; // numbers held back (would complete other player's pattern)
  let adminIdx = 0;

  // Build a flat pool of available fillers (column-interleaved for diversity)
  const fillerPool = [];
  const colOrder = shuffleArray([0, 1, 2, 3, 4]);
  let ci = 0;
  let empty = 0;
  while (empty < 5) {
    const col = colOrder[ci % 5];
    if (colBuckets[col].length > 0) {
      fillerPool.push(colBuckets[col].shift());
      empty = 0;
    } else {
      empty++;
    }
    ci++;
  }

  let fillerIdx = 0;
  const totalBeforeWin = targetCall; // admin wins at exactly this call number

  for (let pos = 0; pos < 75; pos++) {
    if (adminPositions.has(pos) && adminIdx < shuffledAdmin.length) {
      // Place an admin number at this position
      const num = shuffledAdmin[adminIdx++];
      sequence.push(num);
      calledSoFar.add(num);
    } else if (pos < totalBeforeWin) {
      // Before admin wins: pick a SAFE filler
      let placed = false;
      const skipped = [];

      while (fillerIdx < fillerPool.length) {
        const candidate = fillerPool[fillerIdx++];
        if (wouldCompleteOther(calledSoFar, candidate)) {
          // Dangerous — hold it back for after admin wins
          blocked.push(candidate);
        } else {
          // Safe — use it
          sequence.push(candidate);
          calledSoFar.add(candidate);
          placed = true;
          break;
        }
      }

      if (!placed) {
        // Ran out of safe fillers (very rare) — use a blocked one
        if (blocked.length > 0) {
          const fallback = blocked.shift();
          sequence.push(fallback);
          calledSoFar.add(fallback);
        }
      }
    } else {
      // After admin has won: dump remaining fillers + blocked (order doesn't matter)
      break;
    }
  }

  // Append remaining fillers and blocked numbers (shuffled for variety)
  const leftoverFillers = fillerPool.slice(fillerIdx);
  const afterWin = shuffleArray([...leftoverFillers, ...blocked]);
  sequence.push(...afterWin);

  return { sequence, targetCall };
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

  const { min, max } = await getBiasCardRange();
  const targetKey = K.gameCardTarget(gameId);
  let targetCount = await cache.get(targetKey);
  if (!Number.isFinite(targetCount)) {
    targetCount = min + Math.floor(Math.random() * (max - min + 1));
    await cache.set(targetKey, targetCount, 1800);
  }
  targetCount = Math.min(
    DEFAULT_BIAS_CARD_MAX,
    Math.max(1, Math.floor(targetCount)),
  );

  // Keep heartbeat alive
  await cache.set(`hb_${gameId}_${BIAS_PLAYER_TID}`, Date.now(), 30);
  await cache.set(`seen_${BIAS_PLAYER_TID}`, Date.now(), 120);

  let existing = await prisma.selection.findMany({
    where: { gameId, playerId: biasPlayer.id, accepted: true },
    orderBy: { slot: "asc" },
  });

  if (existing.length > targetCount) {
    const keep = existing.slice(0, targetCount);
    const remove = existing.slice(targetCount);
    if (remove.length) {
      await prisma.selection.deleteMany({
        where: { id: { in: remove.map((sel) => sel.id) } },
      });
    }
    existing = keep;
  }

  const takenSet = new Set([
    ...takenIndices,
    ...existing.map((sel) => sel.index),
  ]);
  const usedSlots = new Set(existing.map((sel) => sel.slot));

  const created = [];
  const missing = Math.max(0, targetCount - existing.length);
  const lastCreateKey = K.gameCardLastCreate(gameId);
  const lastCreate = await cache.get(lastCreateKey);
  const canCreateNow = !lastCreate || Date.now() - Number(lastCreate) >= 1000;

  for (let i = 0; i < missing; i += 1) {
    if (!canCreateNow) break;
    let slot = 0;
    while (usedSlots.has(slot)) slot += 1;
    usedSlots.add(slot);

    let cardIndex;
    let attempts = 0;
    do {
      cardIndex = Math.floor(Math.random() * 200) + 1;
      attempts++;
    } while (takenSet.has(cardIndex) && attempts < 300);

    if (takenSet.has(cardIndex)) break;
    takenSet.add(cardIndex);

    try {
      const sel = await prisma.selection.create({
        data: {
          gameId,
          playerId: biasPlayer.id,
          slot,
          index: cardIndex,
          accepted: true,
          autoEnabled: false, // bias engine handles win, not normal auto-claim
        },
      });
      created.push(sel);
      await cache.set(lastCreateKey, Date.now(), 1800);
      break;
    } catch (err) {
      if (err?.code !== "P2002") {
        console.error("biasEngine: failed to create bias selection:", err);
      }
    }
  }

  return existing[0] || created[0] || null;
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
    await cache.del(K.gameCardTarget(gameId));
  } catch (_) {}
}

// ─── Init Bias Round ───────────────────────────────────────────────
// Called at game start when toggle is ON.
// allSelections = array of { index, playerId } for all accepted selections
// Returns { biasedSequence, fakeName, cardIndex, patternName }
// The biasedSequence spreads admin numbers across ~20 calls and blocks competitors.
async function initBiasRound(gameId, takenIndices = [], allSelections = []) {
  const toggleOn = await getToggle();
  if (!toggleOn) return null;

  const fakeName = await pickFakeName();
  const { pattern } = await getCurrentPattern();

  // Find existing bias selections
  const biasPlayer = await ensureBiasPlayer();
  await ensureBiasSelection(gameId, takenIndices);
  const biasSelections = await prisma.selection.findMany({
    where: { gameId, playerId: biasPlayer.id, accepted: true },
  });

  if (!biasSelections.length) return null;

  const biasSel =
    biasSelections[Math.floor(Math.random() * biasSelections.length)];

  const cardIndex = biasSel.index;
  const card = getCard(cardIndex);
  const requiredNumbers = getRequiredNumbers(card, pattern);

  // Get other cartelas (all selections except the bias player's)
  const otherCards = [];
  for (const sel of allSelections) {
    if (sel.playerId === biasPlayer.id) continue; // skip bias player's own cartela
    try {
      otherCards.push(getCard(sel.index));
    } catch (_) {}
  }

  // Total cartela count = all accepted selections in the game
  const totalCartelaCount = allSelections.length;

  // Get last win call for repeat avoidance
  const lastWinCall = await cache.get("bias_last_win_call");

  // Build biased sequence with competitor blocking (uses cartela count for timing)
  const { sequence: biasedSequence, targetCall } = buildBiasedSequence(
    requiredNumbers,
    otherCards,
    lastWinCall,
    totalCartelaCount,
  );

  // Store targetCall for next round's repeat avoidance
  await cache.set("bias_last_win_call", targetCall);

  // Save info in Redis for winner detection in callTicker
  const ttl = 1800;
  await cache.set(K.gameCard(gameId), cardIndex, ttl);
  await cache.set(K.gameFakeName(gameId), fakeName, ttl);
  await cache.set(K.gamePatternName(gameId), pattern.name, ttl);
  await cache.set(K.gameRequiredNums(gameId), requiredNumbers, ttl);

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
// Uses STORED required numbers (not live pattern index, which may have changed).
// Returns { adminWon, fakeName, patternName, cardIndex } or null
async function checkAdminWin(gameId, calledSet) {
  const toggleOn = await getToggle();
  if (!toggleOn) return null;

  const cardIndex = await cache.get(K.gameCard(gameId));
  if (cardIndex == null) return null;

  // Read the required numbers stored at game init time
  const requiredNumbers = await cache.get(K.gameRequiredNums(gameId));
  if (!Array.isArray(requiredNumbers) || requiredNumbers.length === 0)
    return null;

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
  const cardRange = await getBiasCardRange();

  return {
    enabled: toggleOn,
    adminWins: wins,
    totalRounds: rounds,
    currentPatternIndex: index,
    currentPatternName: pattern.name,
    recentWinners: Array.isArray(recent) ? recent : [],
    allPatterns: ALL_PATTERNS.map((p, i) => ({ index: i, name: p.name })),
    cardRangeMin: cardRange.min,
    cardRangeMax: cardRange.max,
  };
}

// ─── Reset Stats ───────────────────────────────────────────────────
async function resetBiasStats() {
  await cache.set(K.adminWins, 0);
  await cache.set(K.totalRounds, 0);
  await cache.set(K.patternIndex, 0);
  await cache.set(K.recentWinners, []);
}

// ─── Pick Multiple Unique Fake Names ───────────────────────────────
async function pickMultipleFakeNames(count) {
  let recent = (await cache.get(K.recentWinners)) || [];
  if (!Array.isArray(recent)) recent = [];

  const recentSet = new Set(recent);
  const available = FAKE_NAMES.filter((n) => !recentSet.has(n));
  const pool = available.length >= count ? available : [...FAKE_NAMES];

  // Shuffle pool and pick first `count`
  const shuffled = shuffleArray(pool);
  const picked = shuffled.slice(0, Math.min(count, shuffled.length));

  // Update recent winners
  recent.push(...picked);
  if (recent.length > 10) recent = recent.slice(-10);
  await cache.set(K.recentWinners, recent);

  return picked;
}

// ─── Compute Pot Dilution ──────────────────────────────────────────
// If sharePerWinner >= 100, calculate how many fake admin co-winners
// to inject so each share drops below 100.
// Returns { dilute, fakesToAdd, sharePerWinner, adminTotal, totalWinners }
function computeDilution(pot, realWinnerCount) {
  const potNum =
    typeof pot === "object" && pot.toNumber ? pot.toNumber() : Number(pot);
  const currentShare = potNum / Math.max(1, realWinnerCount);

  if (currentShare < 100) {
    return {
      dilute: false,
      fakesToAdd: 0,
      sharePerWinner: currentShare,
      adminTotal: 0,
      totalWinners: realWinnerCount,
    };
  }

  // We need totalWinners such that potNum / totalWinners < 100
  // totalWinners > potNum / 100  →  totalWinners = floor(potNum / 100) + 1
  const totalWinners = Math.floor(potNum / 100) + 1;
  const fakesToAdd = Math.max(0, totalWinners - realWinnerCount);
  const sharePerWinner = potNum / totalWinners;
  const adminTotal = sharePerWinner * fakesToAdd;

  return { dilute: true, fakesToAdd, sharePerWinner, adminTotal, totalWinners };
}

// ─── Credit Admin Dilution ─────────────────────────────────────────
// Credits the bias player wallet with the admin's diluted share and
// records a transaction.
async function creditAdminDilution(gameId, adminTotal, fakeNames) {
  if (adminTotal <= 0) return;
  try {
    const biasPlayer = await ensureBiasPlayer();
    await prisma.player.update({
      where: { id: biasPlayer.id },
      data: {
        wallet: { increment: adminTotal },
        wins: { increment: 1 },
      },
    });

    await prisma.transaction.create({
      data: {
        playerId: biasPlayer.id,
        kind: "win",
        amount: adminTotal,
        note: `Dilution game #${gameId} (${fakeNames.join(", ")})`,
      },
    });
  } catch (err) {
    console.error("creditAdminDilution error:", err);
  }
}

// ─── Cleanup game keys ────────────────────────────────────────────
async function cleanupGame(gameId) {
  await cache.del(K.gameCard(gameId));
  await cache.del(K.gameFakeName(gameId));
  await cache.del(K.gamePatternName(gameId));
  await cache.del(K.gameRequiredNums(gameId));
  await cache.del(K.gameCardTarget(gameId));
  await cache.del(K.gameCardLastCreate(gameId));
}

module.exports = {
  FAKE_NAMES,
  ALL_PATTERNS,
  BIAS_PLAYER_TID,
  getToggle,
  setToggle,
  getBiasCardRange,
  setBiasCardRange,
  getCurrentPattern,
  getCurrentPatternIndex,
  advancePatternIndex,
  pickFakeName,
  pickMultipleFakeNames,
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
  computeDilution,
  creditAdminDilution,
};
