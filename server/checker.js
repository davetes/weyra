// Port of bingo/checker.py — pattern matching for bingo claims
const { getCard } = require("./utils");
const { ALL_PATTERNS } = require("./biasEngine");

function flatten(rows) {
  const out = [];
  for (const r of rows) {
    for (const v of r) {
      if (v === "FREE") continue;
      out.push(Number(v));
    }
  }
  return out;
}

// Legacy winning lines (rows, cols, diags, corners) for backward compat
function winningLines(rows) {
  const lines = [];
  for (let r = 0; r < 5; r++) {
    const line = [];
    for (let c = 0; c < 5; c++) if (rows[r][c] !== "FREE") line.push(rows[r][c]);
    lines.push(line);
  }
  for (let c = 0; c < 5; c++) {
    const line = [];
    for (let r = 0; r < 5; r++) if (rows[r][c] !== "FREE") line.push(rows[r][c]);
    lines.push(line);
  }
  {
    const line = [];
    for (let i = 0; i < 5; i++) if (rows[i][i] !== "FREE") line.push(rows[i][i]);
    lines.push(line);
  }
  {
    const line = [];
    for (let i = 0; i < 5; i++) if (rows[i][4 - i] !== "FREE") line.push(rows[i][4 - i]);
    lines.push(line);
  }
  lines.push([rows[0][0], rows[0][4], rows[4][0], rows[4][4]]);
  return lines;
}

// Check if a specific pattern is complete on a card given called numbers
function checkPatternMatch(card, calledSet, pattern) {
  for (const [r, c] of pattern.positions) {
    const val = card[r][c];
    if (val === "FREE") continue;
    if (!calledSet.has(val)) return false;
  }
  return true;
}

// Check card against ALL patterns, returns first match or null
function checkAllPatterns(card, calledSet) {
  for (const pattern of ALL_PATTERNS) {
    if (checkPatternMatch(card, calledSet, pattern)) {
      return { pattern: pattern.name, positions: pattern.positions };
    }
  }
  return null;
}

module.exports = { flatten, winningLines, checkPatternMatch, checkAllPatterns, ALL_PATTERNS };
