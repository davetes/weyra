const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");

const prisma = new PrismaClient();

function parseTid(input) {
  const tidStr = String(input || "").trim();
  if (!tidStr) return { tidStr: "", tidBig: null };
  try {
    return { tidStr, tidBig: BigInt(tidStr) };
  } catch (_) {
    return { tidStr: "", tidBig: null };
  }
}

async function handleWalletRequests(req, res) {
  try {
    const { tidBig } = parseTid(req.query.tid);
    if (!tidBig) {
      return res.status(400).json({ ok: false, error: "Missing tid" });
    }

    const player = await prisma.player.findUnique({
      where: { telegramId: tidBig },
      select: { id: true },
    });

    if (!player) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    const [deposits, withdraws] = await Promise.all([
      prisma.depositRequest.findMany({
        where: { playerId: player.id },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          method: true,
          amount: true,
          status: true,
          caption: true,
          createdAt: true,
        },
      }),
      prisma.withdrawRequest.findMany({
        where: { playerId: player.id },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          method: true,
          amount: true,
          status: true,
          account: true,
          createdAt: true,
        },
      }),
    ]);

    const items = [];

    for (const d of deposits) {
      const amt = d.amount != null ? new Decimal(d.amount.toString()).toNumber() : null;
      items.push({
        type: "deposit",
        id: d.id,
        status: d.status,
        method: d.method || "",
        amount: amt,
        note: d.caption || "",
        createdAt: d.createdAt,
      });
    }

    for (const w of withdraws) {
      const amt = w.amount != null ? new Decimal(w.amount.toString()).toNumber() : null;
      items.push({
        type: "withdraw",
        id: w.id,
        status: w.status,
        method: w.method || "",
        amount: amt,
        note: w.account || "",
        createdAt: w.createdAt,
      });
    }

    items.sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return tb - ta;
    });

    return res.json({
      ok: true,
      items: items.map((it) => ({
        ...it,
        createdAt: it.createdAt ? new Date(it.createdAt).toISOString() : null,
      })),
    });
  } catch (err) {
    console.error("wallet_requests error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

module.exports = handleWalletRequests;
