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

async function handleDepositRequest(req, res) {
  try {
    const { tidBig } = parseTid(req.body?.tid ?? req.query?.tid);
    if (!tidBig) {
      return res.status(400).json({ ok: false, error: "Missing tid" });
    }

    const method = String(req.body?.method || "").trim();
    const caption = String(req.body?.caption || "").trim();
    const amountRaw = req.body?.amount;

    const amountDec = new Decimal(amountRaw || 0);
    if (!amountDec.isFinite() || amountDec.lte(0)) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    const player = await prisma.player.findUnique({
      where: { telegramId: tidBig },
      select: { id: true },
    });

    if (!player) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    const created = await prisma.depositRequest.create({
      data: {
        playerId: player.id,
        telegramId: tidBig,
        method,
        amount: amountDec.toNumber(),
        caption,
        status: "pending",
      },
    });

    return res.json({
      ok: true,
      request: {
        id: created.id,
        status: created.status,
      },
    });
  } catch (err) {
    console.error("deposit_request error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

module.exports = handleDepositRequest;
