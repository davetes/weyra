// Deterministic bingo card generator — port of bingo/utils.py

const RANGES = [
  [1, 15],   // B
  [16, 30],  // I
  [31, 45],  // N
  [46, 60],  // G
  [61, 75],  // O
];

function mulberry32(seed) {
  seed = seed & 0xFFFFFFFF;
  return function () {
    seed = (seed + 0x6D2B79F5) & 0xFFFFFFFF;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, seed) {
  const prng = mulberry32(seed);
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function getCard(seed) {
  const columns = RANGES.map(([start, end], idx) => {
    const arr = [];
    for (let n = start; n <= end; n++) arr.push(n);
    const shuffled = shuffle(arr, seed + idx * 1000);
    return shuffled.slice(0, 5);
  });
  const rows = [];
  for (let r = 0; r < 5; r++) {
    const row = [];
    for (let c = 0; c < 5; c++) {
      if (r === 2 && c === 2) row.push('FREE');
      else row.push(columns[c][r]);
    }
    rows.push(row);
  }
  return rows;
}

function letterFor(n) {
  n = Number(n);
  if (n >= 1 && n <= 15) return 'B';
  if (n <= 30) return 'I';
  if (n <= 45) return 'N';
  if (n <= 60) return 'G';
  return 'O';
}

module.exports = { RANGES, mulberry32, shuffle, getCard, letterFor };
