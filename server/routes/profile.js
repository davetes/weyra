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

async function handleProfile(req, res) {
  try {
    const { tidBig } = parseTid(req.query.tid);
    if (!tidBig) {
      return res.status(400).json({ ok: false, error: "Missing tid" });
    }

    const player = await prisma.player.findUnique({
      where: { telegramId: tidBig },
      select: {
        id: true,
        telegramId: true,
        username: true,
        phone: true,
        wallet: true,
        gift: true,
        wins: true,
      },
    });

    if (!player) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    const wallet = new Decimal(player.wallet.toString()).toNumber();
    const gift = new Decimal(player.gift.toString()).toNumber();

    const [refAgg, refCount] = await Promise.all([
      prisma.transaction.aggregate({
        where: { playerId: player.id, kind: "referral_bonus" },
        _sum: { amount: true },
      }),
      prisma.transaction.count({
        where: { playerId: player.id, kind: "referral_bonus" },
      }),
    ]);

    const totalInvites = refCount || 0;
    const totalEarning = refAgg?._sum?.amount
      ? new Decimal(refAgg._sum.amount.toString()).toNumber()
      : 0;

    const botUsername = String(process.env.BOT_USERNAME || "").trim();
    const referralLink = botUsername
      ? `https://t.me/${botUsername}?start=ref_${String(player.telegramId)}`
      : "";

    return res.json({
      ok: true,
      profile: {
        tid: String(player.telegramId),
        username: player.username || "",
        phone: player.phone || "",
        wallet,
        gift,
        wins: player.wins || 0,
        totalInvites,
        totalEarning,
        referralLink,
      },
    });
  } catch (err) {
    console.error("profile error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

module.exports = handleProfile;
