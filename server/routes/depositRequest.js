const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const { getBot } = require("../bot/index");
const { notifyEntertainers, getEntertainerIds } = require("../bot/entertainer");

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
    // Use validated tid from initData middleware (secure)
    const tidBig = req.validatedTid || null;
    if (!tidBig) {
      return res.status(400).json({ ok: false, error: "Missing tid" });
    }

    const method = String(req.body?.method || "").trim();
    const caption = String(req.body?.caption || "").trim();
    const amountRaw = req.body?.amount;

    // Validate method against allowed values
    const ALLOWED_METHODS = ["Telebirr", "CBE Birr"];
    if (method && !ALLOWED_METHODS.includes(method)) {
      return res.status(400).json({ ok: false, error: "Invalid payment method" });
    }

    const amountDec = new Decimal(amountRaw || 0);
    if (!amountDec.isFinite() || amountDec.lte(0)) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    const player = await prisma.player.findUnique({
      where: { telegramId: tidBig },
      select: { id: true, username: true, phone: true },
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

    // Notify admin entertainers via Telegram bot
    try {
      const bot = getBot();
      const entertainerIds = getEntertainerIds();
      if (bot && entertainerIds.length > 0) {
        const message =
          `💰 Deposit Request #${created.id}\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `User: @${player.username || "-"} (id: ${tidBig})\n` +
          `Phone: ${player.phone || "-"}\n` +
          `Amount: ${amountDec.toFixed(2)} ETB\n` +
          `Method: ${method || "-"}\n` +
          `Caption: ${caption || "-"}\n` +
          `Source: MiniApp\n`;

        await notifyEntertainers(bot, message, {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "✅ Approve",
                  callback_data: `approve_deposit:${created.id}`,
                },
                {
                  text: "❌ Reject",
                  callback_data: `reject_deposit:${created.id}`,
                },
              ],
            ],
          },
        });
      }
    } catch (notifyErr) {
      console.error("deposit admin notify error:", notifyErr.message);
    }

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
