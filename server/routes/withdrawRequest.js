const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");

const prisma = new PrismaClient();

function parseNumberSetting(map, key, fallback) {
  const raw = map.get(key);
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

async function getSettings(keys) {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });
  const map = new Map();
  for (const r of rows) map.set(String(r.key), String(r.value || ""));
  return map;
}

function parseTid(input) {
  const tidStr = String(input || "").trim();
  if (!tidStr) return { tidStr: "", tidBig: null };
  try {
    return { tidStr, tidBig: BigInt(tidStr) };
  } catch (_) {
    return { tidStr: "", tidBig: null };
  }
}

async function handleWithdrawRequest(req, res) {
  try {
    const { tidBig } = parseTid(req.body?.tid ?? req.query?.tid);
    if (!tidBig) {
      return res.status(400).json({ ok: false, error: "Missing tid" });
    }

    const method = String(req.body?.method || "").trim();
    const account = String(req.body?.account || "").trim();
    const amountRaw = req.body?.amount;

    const amountDec = new Decimal(amountRaw || 0);
    if (!amountDec.isFinite() || amountDec.lte(0)) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    const settings = await getSettings([
      "withdraw.max_per_tx",
      "withdraw.max_per_day",
      "withdraw.max_pending",
      "withdraw.min_seconds_between",
      "withdraw.review_threshold",
    ]);

    const maxPerTx = parseNumberSetting(settings, "withdraw.max_per_tx", 0);
    const maxPerDay = parseNumberSetting(settings, "withdraw.max_per_day", 0);
    const maxPending = parseNumberSetting(settings, "withdraw.max_pending", 3);
    const minSecondsBetween = parseNumberSetting(
      settings,
      "withdraw.min_seconds_between",
      30,
    );
    const reviewThreshold = parseNumberSetting(
      settings,
      "withdraw.review_threshold",
      0,
    );

    if (maxPerTx > 0 && amountDec.gt(new Decimal(maxPerTx))) {
      return res
        .status(400)
        .json({ ok: false, error: "Amount exceeds max per transaction" });
    }

    const player = await prisma.player.findUnique({
      where: { telegramId: tidBig },
      select: { id: true },
    });

    if (!player) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    const now = new Date();

    const pendingCount = await prisma.withdrawRequest.count({
      where: { telegramId: tidBig, status: "pending" },
    });
    if (pendingCount >= maxPending) {
      return res
        .status(429)
        .json({ ok: false, error: "Too many pending withdraw requests" });
    }

    if (minSecondsBetween > 0) {
      const since = new Date(Date.now() - minSecondsBetween * 1000);
      const recent = await prisma.withdrawRequest.findFirst({
        where: { telegramId: tidBig, createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (recent) {
        return res.status(429).json({
          ok: false,
          error: "Please wait before creating another withdraw request",
        });
      }
    }

    if (maxPerDay > 0) {
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0,
        0,
        0,
        0,
      );
      const sum = await prisma.withdrawRequest.aggregate({
        where: {
          telegramId: tidBig,
          createdAt: { gte: start },
          status: { in: ["pending", "approved"] },
        },
        _sum: { amount: true },
      });

      const dayTotal = sum._sum.amount
        ? new Decimal(sum._sum.amount.toString())
        : new Decimal(0);
      if (dayTotal.plus(amountDec).gt(new Decimal(maxPerDay))) {
        return res
          .status(400)
          .json({ ok: false, error: "Amount exceeds daily withdraw limit" });
      }
    }

    const needsReview =
      reviewThreshold > 0 && amountDec.gt(new Decimal(reviewThreshold));
    const adminNote = needsReview
      ? `Auto-flag: amount above review threshold (${reviewThreshold})`
      : "";
    const disputeStatus = needsReview ? "review" : "none";

    const created = await prisma.withdrawRequest.create({
      data: {
        playerId: player.id,
        telegramId: tidBig,
        method,
        account,
        amount: amountDec.toNumber(),
        status: "pending",
        adminNote,
        disputeStatus,
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
    console.error("withdraw_request error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

module.exports = handleWithdrawRequest;
