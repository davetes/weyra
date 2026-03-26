// Auto-Verification Engine — matches bank SMS with pending deposit claims
const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const { parseBankSms, isBankSms } = require("./smsParser");
const {
  notifyEntertainers,
  getEntertainerIds,
  isEntertainer,
} = require("./entertainer");

const prisma = new PrismaClient();

const UNMATCHED_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const EXPIRY_CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

/**
 * Normalize a reference string for comparison (uppercase, trim, strip dashes/spaces).
 */
function normalizeRef(ref) {
  if (!ref) return "";
  return ref
    .toUpperCase()
    .replace(/[\s\-_]/g, "")
    .trim();
}

/**
 * Process an incoming bank SMS: parse, store, and try to match with pending claims.
 * Returns { matched: boolean, depositId?: number, bankSmsId: number }
 */
async function processIncomingSms(rawText, bot) {
  const parsed = parseBankSms(rawText);
  if (!parsed) {
    return { matched: false, error: "Could not parse SMS" };
  }

  const normalizedRef = normalizeRef(parsed.reference);
  if (normalizedRef) {
    const existingSms = await findExistingSmsByRef(normalizedRef);
    if (existingSms) {
      console.log(
        `[AutoVerify] Duplicate SMS ignored for ref=${normalizedRef} (existing SMS #${existingSms.id}, status=${existingSms.status})`,
      );
      return {
        matched: existingSms.status === "matched",
        bankSmsId: existingSms.id,
      };
    }
  }

  // Store the bank SMS
  const bankSms = await prisma.bankSms.create({
    data: {
      rawText,
      amount: parsed.amount,
      reference: parsed.reference || "",
      bank: parsed.bank || "",
      status: "unmatched",
    },
  });

  console.log(
    `[AutoVerify] Bank SMS #${bankSms.id} stored: amount=${parsed.amount}, ref=${parsed.reference}, bank=${parsed.bank}`,
  );

  // Try to match with a pending deposit claim
  const result = await tryMatchSmsToDeposit(bankSms, bot);
  return result;
}

async function findExistingSmsByRef(normalizedRef) {
  if (!normalizedRef) return null;
  const recent = await prisma.bankSms.findMany({
    where: {
      reference: { not: "" },
    },
    orderBy: { receivedAt: "desc" },
    take: 200,
  });
  for (const sms of recent) {
    if (normalizeRef(sms.reference) === normalizedRef) return sms;
  }
  return null;
}

/**
 * Try to match a stored BankSms with a pending DepositRequest.
 * Matching criteria: reference matches AND amount matches (within tolerance).
 */
async function tryMatchSmsToDeposit(bankSms, bot) {
  const normalizedRef = normalizeRef(bankSms.reference);

  if (!normalizedRef) {
    console.log(
      `[AutoVerify] SMS #${bankSms.id} has no reference — cannot auto-match`,
    );
    return { matched: false, bankSmsId: bankSms.id };
  }

  // Find pending deposits with matching reference
  const pendingDeposits = await prisma.depositRequest.findMany({
    where: {
      status: "pending",
      bankReference: { not: "" },
    },
    include: { player: true },
    orderBy: { createdAt: "desc" },
  });

  for (const deposit of pendingDeposits) {
    const depositRef = normalizeRef(deposit.bankReference);
    if (depositRef !== normalizedRef) continue;

    // Reference matches — check amount if both are available
    if (bankSms.amount && deposit.amount) {
      const smsAmount = new Decimal(bankSms.amount.toString());
      const depositAmount = new Decimal(deposit.amount.toString());
      // Allow 1 ETB tolerance for rounding
      if (smsAmount.minus(depositAmount).abs().gt(1)) {
        console.log(
          `[AutoVerify] Ref match but amount mismatch: SMS=${smsAmount}, Deposit=${depositAmount}`,
        );
        continue;
      }
    }

    // MATCH FOUND — credit the player
    const creditResult = await creditPlayer(deposit, bankSms, bot);
    return {
      matched: true,
      depositId: deposit.id,
      bankSmsId: bankSms.id,
      ...creditResult,
    };
  }

  console.log(
    `[AutoVerify] No matching pending deposit for SMS #${bankSms.id} ref=${normalizedRef}`,
  );
  return { matched: false, bankSmsId: bankSms.id };
}

/**
 * When a player creates a new deposit claim with a reference,
 * check if a matching bank SMS already arrived.
 */
async function tryMatchDepositToSms(depositRequest, bot) {
  const normalizedRef = normalizeRef(depositRequest.bankReference);
  if (!normalizedRef) return { matched: false };

  // Search unmatched bank SMS with same reference
  const bankSmsList = await prisma.bankSms.findMany({
    where: {
      status: "unmatched",
      reference: { not: "" },
    },
    orderBy: { receivedAt: "desc" },
  });

  for (const sms of bankSmsList) {
    const smsRef = normalizeRef(sms.reference);
    if (smsRef !== normalizedRef) continue;

    // Check amount if both available
    if (sms.amount && depositRequest.amount) {
      const smsAmount = new Decimal(sms.amount.toString());
      const depositAmount = new Decimal(depositRequest.amount.toString());
      if (smsAmount.minus(depositAmount).abs().gt(1)) continue;
    }

    // Reload deposit to get player relation
    const deposit = await prisma.depositRequest.findUnique({
      where: { id: depositRequest.id },
      include: { player: true },
    });
    if (!deposit || deposit.status !== "pending") continue;

    // MATCH FOUND
    const creditResult = await creditPlayer(deposit, sms, bot);
    return { matched: true, bankSmsId: sms.id, ...creditResult };
  }

  return { matched: false };
}

/**
 * Credit a player's wallet after a successful match.
 */
async function creditPlayer(deposit, bankSms, bot) {
  const player = deposit.player;
  const amount = deposit.amount
    ? new Decimal(deposit.amount.toString())
    : bankSms.amount
      ? new Decimal(bankSms.amount.toString())
      : null;

  if (!amount || amount.lte(0)) {
    console.error(
      `[AutoVerify] Cannot credit — no valid amount for deposit #${deposit.id}`,
    );
    return { credited: false };
  }

  try {
    // Atomic transaction: credit wallet + mark deposit approved + mark SMS matched
    await prisma.$transaction([
      prisma.player.update({
        where: { id: player.id },
        data: { wallet: { increment: amount.toNumber() } },
      }),
      prisma.transaction.create({
        data: {
          playerId: player.id,
          kind: "deposit",
          amount: amount.toNumber(),
          note: `Auto-verified deposit #${deposit.id} via SMS ref: ${bankSms.reference || "N/A"}`,
        },
      }),
      prisma.depositRequest.update({
        where: { id: deposit.id },
        data: {
          status: "approved",
          decidedAt: new Date(),
          decisionNote: `Auto-verified via bank SMS #${bankSms.id}`,
        },
      }),
      prisma.bankSms.update({
        where: { id: bankSms.id },
        data: {
          status: "matched",
          matchedDepositId: deposit.id,
        },
      }),
    ]);

    console.log(
      `[AutoVerify] ✅ Auto-credited ${amount.toFixed(2)} ETB to player #${player.id} (deposit #${deposit.id})`,
    );

    // Get updated balance
    const updated = await prisma.player.findUnique({
      where: { id: player.id },
    });
    const newBalance = updated
      ? new Decimal(updated.wallet.toString()).toFixed(2)
      : "N/A";

    // Notify player via Telegram
    try {
      if (bot) {
        await bot.sendMessage(
          deposit.telegramId.toString(),
          `✅ የገንዘብ ማስገቢያዎ ተረጋግጧል!\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `💰 Amount: ${amount.toFixed(2)} ETB\n` +
            `📋 Reference: ${bankSms.reference || "N/A"}\n` +
            `💳 New Balance: ${newBalance} ETB\n` +
            `━━━━━━━━━━━━━━━━━━\n`,
        );
      }
    } catch (notifyErr) {
      console.error("[AutoVerify] Failed to notify player:", notifyErr.message);
    }

    // Notify entertainers
    try {
      if (bot) {
        await notifyEntertainers(
          bot,
          `✅ Auto-Verified Deposit #${deposit.id}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `Player: @${player.username || "-"} (id: ${deposit.telegramId})\n` +
            `Amount: ${amount.toFixed(2)} ETB\n` +
            `Reference: ${bankSms.reference || "N/A"}\n` +
            `Bank: ${bankSms.bank || "Unknown"}\n` +
            `New Balance: ${newBalance} ETB`,
        );
      }
    } catch (_) {}

    return { credited: true, amount: amount.toNumber(), newBalance };
  } catch (err) {
    console.error(
      `[AutoVerify] Credit failed for deposit #${deposit.id}:`,
      err,
    );
    return { credited: false, error: err.message };
  }
}

/**
 * Check for expired unmatched SMS and notify admin.
 */
async function checkExpiredSms(bot) {
  const cutoff = new Date(Date.now() - UNMATCHED_TIMEOUT_MS);

  const expiredSms = await prisma.bankSms.findMany({
    where: {
      status: "unmatched",
      receivedAt: { lt: cutoff },
    },
  });

  for (const sms of expiredSms) {
    await prisma.bankSms.update({
      where: { id: sms.id },
      data: { status: "expired" },
    });

    console.log(
      `[AutoVerify] SMS #${sms.id} expired (no matching claim within 30 min)`,
    );

    // Notify admin
    try {
      if (bot) {
        const amountStr = sms.amount
          ? new Decimal(sms.amount.toString()).toFixed(2)
          : "N/A";
        await notifyEntertainers(
          bot,
          `⚠️ Unmatched Bank SMS (30 min timeout)\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `SMS #${sms.id}\n` +
            `Amount: ${amountStr} ETB\n` +
            `Reference: ${sms.reference || "N/A"}\n` +
            `Bank: ${sms.bank || "Unknown"}\n` +
            `Received: ${sms.receivedAt.toISOString()}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `No player claimed this deposit.\n` +
            `Original SMS:\n${sms.rawText.substring(0, 200)}`,
        );
      }
    } catch (_) {}
  }
}

/**
 * Set up auto-verification: SMS handler + periodic expiry check.
 */
function setupAutoVerify(bot) {
  // Handle forwarded/text messages from entertainers that look like bank SMS
  bot.on("message", async (msg) => {
    if (!msg.text) return;
    const tid = msg.from && msg.from.id;
    if (!tid) return;

    // Only process messages from entertainers (SMS Forwarder sends via entertainer's account)
    if (!isEntertainer(tid)) return;

    // Skip commands
    if (msg.text.startsWith("/")) return;

    // Check if it looks like a bank SMS
    if (!isBankSms(msg.text)) return;

    console.log(
      `[AutoVerify] Received potential bank SMS from entertainer ${tid}`,
    );

    const result = await processIncomingSms(msg.text, bot);

    // Reply to entertainer with result
    try {
      if (result.matched) {
        await bot.sendMessage(
          msg.chat.id,
          `✅ Bank SMS auto-matched!\n` +
            `Deposit #${result.depositId} verified and credited.`,
        );
      } else if (result.error) {
        await bot.sendMessage(
          msg.chat.id,
          `⚠️ Could not parse bank SMS: ${result.error}`,
        );
      } else {
        await bot.sendMessage(
          msg.chat.id,
          `📋 Bank SMS #${result.bankSmsId} stored.\n` +
            `Waiting for player claim (30 min timeout).`,
        );
      }
    } catch (_) {}
  });

  // Start periodic expiry checker
  setInterval(() => {
    checkExpiredSms(bot).catch((err) =>
      console.error("[AutoVerify] Expiry check error:", err.message),
    );
  }, EXPIRY_CHECK_INTERVAL_MS);

  console.log("🔄 Auto-verify SMS handler and expiry checker started");
}

module.exports = {
  setupAutoVerify,
  processIncomingSms,
  tryMatchDepositToSms,
  tryMatchSmsToDeposit,
  checkExpiredSms,
  normalizeRef,
};
