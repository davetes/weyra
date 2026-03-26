// Bot command handlers — port of bingo/bot.py
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const { buildDepositKeyboard, handleDepositSelection } = require("./deposit");
const { setupWithdraw } = require("./withdraw");
const { setupInvite } = require("./invite");
const { tryMatchDepositToSms } = require("./autoVerify");
const { setupReport } = require("./report");
const {
  notifyEntertainers,
  forwardToEntertainers,
  getEntertainerIds,
} = require("./entertainer");

const prisma = new PrismaClient();

// Conversation state (replaces python-telegram-bot context.user_data)
const userState = new Map();

function getUserState(uid) {
  if (!userState.has(uid)) userState.set(uid, {});
  return userState.get(uid);
}

function parsePositiveAmount(raw) {
  try {
    const d = new Decimal(String(raw).trim());
    if (!d.isFinite() || d.lte(0)) return null;
    return d;
  } catch (_) {
    return null;
  }
}

function clearUserState(uid) {
  userState.delete(uid);
}

// Reset any ongoing conversation when a new command starts
function resetConversationState(uid) {
  const state = getUserState(uid);
  // Clear deposit flow
  state.lastDepositMethod = null;
  state.depositAmount = null;
  state.awaitingDepositAmount = false;
  state.awaitingBankReference = false;
  state.bankReference = null;
  state.awaitingDepositReceipt = false;
  // Clear withdraw flow
  state.withdrawStep = null;
  state.withdraw = null;
  // Clear transfer flow
  state.transferStep = null;
  state.transfer = null;
  // Clear convert flow
  state.convertStep = null;
  state.convert = null;
  // Clear report flow
  state.reportStep = null;
  state.report = null;
  return state;
}

const BUTTON_ROWS = (tid) => {
  const WEBAPP_URL = (
    process.env.WEBAPP_URL || "http://127.0.0.1:3000"
  ).replace(/\/$/, "");
  const withTid = tid ? `?tid=${tid}` : "";
  return [
    [
      {
        text: "🎮 Play Now / ጨዋታ ጀምር",
        web_app: { url: `${WEBAPP_URL}/${withTid}` },
      },
    ],
    [
      { text: "💳 Deposit /ግቢ ማድረጊያ", callback_data: "deposit" },
      { text: "🧾 Balance /ቀሪ ሂሳብ", callback_data: "check_balance" },
    ],
    [
      { text: "🎟️ Invite /ጓደኛ ጋብዝ", callback_data: "invite" },
      { text: "🧩 Win Patterns /የአሸናፊ ቅጦች", callback_data: "win_patterns" },
    ],
    [
      { text: "📘 How to Play / እንዴት ይጫወቱ", callback_data: "instructions" },
      { text: "🆘 Support / ድጋፍ", callback_data: "support" },
    ],
  ];
};

function buildStakeKeyboard(tid) {
  const WEBAPP_URL = (
    process.env.WEBAPP_URL || "http://127.0.0.1:3000"
  ).replace(/\/$/, "");
  const withTid = tid ? `&tid=${tid}` : "";
  return {
    inline_keyboard: [
      [
        {
          text: "🎮 10 ብር / ETB",
          web_app: { url: `${WEBAPP_URL}/play?stake=10${withTid}` },
        },
        {
          text: "🎮 20 ብር / ETB",
          web_app: { url: `${WEBAPP_URL}/play?stake=20${withTid}` },
        },
      ],
      [
        {
          text: "🎮 50 ብር / ETB",
          web_app: { url: `${WEBAPP_URL}/play?stake=50${withTid}` },
        },
      ],
    ],
  };
}

function buildPlayNowWebAppKeyboard(tid) {
  const WEBAPP_URL = (
    process.env.WEBAPP_URL || "http://127.0.0.1:3000"
  ).replace(/\/$/, "");
  const withTid = tid ? `?tid=${tid}` : "";
  return {
    inline_keyboard: [
      [
        {
          text: "🎮 Play Now / ጨዋታ ጀምር",
          web_app: { url: `${WEBAPP_URL}/${withTid}` },
        },
      ],
    ],
  };
}

async function ensurePhoneRegistered(bot, chatId, player) {
  if (player && player.phone && player.phone.trim().length > 0) return true;

  await bot.sendMessage(chatId, "Please Share Your Phone Number", {
    reply_markup: {
      keyboard: [
        [
          { text: "Share Phone Number / ስልክ ቁጥር ያጋሩ", request_contact: true },
          { text: "Cancel / ሰርዝ" },
        ],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
      input_field_placeholder: "Tap 'Share Phone Number'",
    },
  });
  return false;
}

function setupCommands(bot) {
  // /start — register + welcome
  bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const tid = msg.from.id;
    const username = msg.from.username || "";
    resetConversationState(tid); // Cancel any previous unfinished command
    const refParam = (match[1] || "").trim();

    // Create or update player atomically to avoid unique race
    const player = await prisma.player.upsert({
      where: { telegramId: BigInt(tid) },
      create: {
        telegramId: BigInt(tid),
        username,
      },
      update: username ? { username } : {},
    });

    // Capture referral for first-time registration completion
    if (refParam.startsWith("ref_")) {
      const refTid = parseInt(refParam.replace("ref_", ""), 10);
      if (refTid && refTid !== tid) {
        const state = getUserState(tid);
        state.referrerTid = refTid;
      }
    }

    const imgUrl = process.env.START_IMAGE_URL;
    const imgPath = process.env.START_IMAGE_PATH;
    const welcome =
      "PLAY AND WIN! - ይጫወቱ ያሸንፉ!! > Pick your Weyra, join the game, and claim your win!\n\n" +
      "ወይራን ይምረጡ፣ ጨዋታውን ይቀላቀሉ እና ድልዎን ያረጋግጡ!";
    if (imgUrl) {
      try {
        await bot.sendPhoto(chatId, imgUrl, {
          caption: "🎉 Welcome To Weyra Bingo! 🎉",
        });
      } catch (_) {}
    } else if (imgPath) {
      try {
        const resolved = path.isAbsolute(imgPath)
          ? imgPath
          : path.join(process.cwd(), imgPath);
        if (fs.existsSync(resolved)) {
          await bot.sendPhoto(chatId, resolved, {
            caption: "🎉 Welcome To weyra Bingo! 🎉",
          });
        }
      } catch (_) {}
    }
    await bot.sendMessage(chatId, welcome, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: BUTTON_ROWS(tid) },
    });

    await ensurePhoneRegistered(bot, chatId, player);
  });

  // /play — open web app
  bot.onText(/\/play/, async (msg) => {
    const chatId = msg.chat.id;
    const tid = msg.from.id;
    resetConversationState(tid); // Cancel any previous unfinished command
    const player = await prisma.player.findUnique({
      where: { telegramId: BigInt(tid) },
    });
    const ok = await ensurePhoneRegistered(bot, chatId, player);
    if (!ok) return;

    await bot.sendMessage(chatId, "🎮 Tap 'Play Now' to open Weyra Bingo.", {
      reply_markup: buildPlayNowWebAppKeyboard(tid),
    });
  });

  // /deposit — show deposit options
  bot.onText(/\/deposit/, async (msg) => {
    const chatId = msg.chat.id;
    const tid = msg.from.id;
    resetConversationState(tid); // Cancel any previous unfinished command
    const player = await prisma.player.findUnique({
      where: { telegramId: BigInt(tid) },
    });
    const ok = await ensurePhoneRegistered(bot, chatId, player);
    if (!ok) return;

    await bot.sendMessage(
      chatId,
      "🏦 Select Your Bank - ባንክዎን ይምረጡ\nPlease choose your preferred bank to complete the deposit.\nክፍያውን ለመፈጸም የሚጠቀሙበትን ባንክ ይምረጡ።",
      {
        reply_markup: buildDepositKeyboard(),
      },
    );
  });

  // /balance
  bot.onText(/\/balance/, async (msg) => {
    const chatId = msg.chat.id;
    const tid = msg.from.id;
    resetConversationState(tid); // Cancel any previous unfinished command
    const player = await prisma.player.findUnique({
      where: { telegramId: BigInt(tid) },
    });
    if (!player) {
      return bot.sendMessage(chatId, "Please /start first to register.");
    }
    const wallet = new Decimal(player.wallet.toString()).toFixed(2);
    const gift = new Decimal(player.gift.toString()).toFixed(2);
    await bot.sendMessage(
      chatId,
      "```\n" +
        `Username:      ${player.username || "-"}\n` +
        `Wallet:        ${wallet} ETB\n` +
        `Play Wallet:   ${gift} ETB\n` +
        "```",
      { parse_mode: "Markdown" },
    );
  });

  // /instruction
  bot.onText(/\/instruction/, async (msg) => {
    resetConversationState(msg.from.id); // Cancel any previous unfinished command
    await bot.sendMessage(
      msg.chat.id,
      "🎰 WEYRA BINGO | ወይራ ቢንጎ 🎰\n" +
        "Fast • Fair • Fun\n\n" +
        "GET STARTED | አጀማመር\n" +
        "• REGISTER: Hit 'Register' to link your number.\n" +
        "  መመዝገቢያ፦ 'Register' በመጫን ስልክዎን ያገናኙ።\n" +
        "• DEPOSIT: Use 'Deposit Fund' to add balance.\n" +
        "  ገንዘብ ለመሙላት፦ 'Deposit Fund' በመጠቀም ሂሳብ ይሙሉ፡፡\n" +
        "• PLAY: Click 'Start Play' and set your bet.\n" +
        "  ለመጫወት፦ 'Start Play' በመጫን መወራረጃ ይምረጡ።\n\n" +
        "HOW TO WIN | የአሸናፊነት መንገዶች\n" +
        "• Pick & Accept: Select your lucky numbers.\n" +
        "  መምረጥ፦ የሚወዱትን የቁጥር ካርቴላ መርጠው 'Accept' ይበሉ።\n" +
        "• Mark Your Card: Watch the draw and mark matching numbers.\n" +
        "  ማቅለም፦ የሚወጡትን ቁጥሮች ካርቴላዎ ላይ ያቅልሙ።\n" +
        "• Call BINGO: Win by completing:\n" +
        "  ቢንጎ ለማለት፦ እነዚህን ሲያጠናቅቁ ያሸንፋሉ፡\n" +
        "   - Horizontal / Vertical Row (ወደ ጎን ወይም ወደ ታች)\n" +
        "   - Diagonal Line (ጋድም መስመር)\n" +
        "   - The 4 Corners (አራቱ ጠርዞች)\n\n" +
        "⚠️ RULES | ህግጋት\n" +
        "• Don't Rush: Clicking 'Bingo' by mistake will disqualify you.\n" +
        "  ጥንቃቄ፦ ሳይሞሉ 'Bingo' ቢሉ ከጨዋታው ይባረራሉ።\n" +
        "• Minimum Players: A round needs 2+ players to start.\n" +
        "  ተጫዋች፦ ጨዋታ ለመጀመር ቢያንስ 2 ተጫዋች ያስፈልጋል።\n" +
        "• Be Fast: The first person to hit 'Bingo' takes the prize!\n" +
        "Good Luck! | መልካም እድል!",
    );
  });

  // /contact
  bot.onText(/\/contact/, async (msg) => {
    resetConversationState(msg.from.id); // Cancel any previous unfinished command
    await bot.sendMessage(
      msg.chat.id,
      "For support, please contact us at: @Weyrabingosupportgroup",
    );
  });

  // Handle contact sharing
  bot.on("message", async (msg) => {
    if (msg.contact) {
      const tid = msg.from.id;
      const phone = msg.contact.phone_number || "";
      let player = await prisma.player.findUnique({
        where: { telegramId: BigInt(tid) },
      });
      if (!player) {
        try {
          player = await prisma.player.create({
            data: {
              telegramId: BigInt(tid),
              username: msg.from.username || "",
              phone,
            },
          });
        } catch (err) {
          if (err && err.code === "P2002") {
            player = await prisma.player.findUnique({
              where: { telegramId: BigInt(tid) },
            });
          } else {
            throw err;
          }
        }
      }

      const firstPhone = !player.phone && phone;
      if (firstPhone) {
        const bonus = new Decimal(10);
        // Atomic: only update if phone is still empty (prevents double bonus)
        const result = await prisma.player.updateMany({
          where: { id: player.id, phone: "" },
          data: {
            phone,
            username: msg.from.username || player.username || "",
            gift: { increment: parseFloat(bonus.toString()) },
          },
        });
        // Only create bonus transaction if the update actually matched (phone was empty)
        if (result.count > 0) {
          await prisma.transaction.create({
            data: {
              playerId: player.id,
              kind: "registration_bonus",
              amount: bonus.toNumber(),
              note: "Registration bonus for sharing phone number (Play Wallet)",
            },
          });
          const updated = await prisma.player.findUnique({
            where: { id: player.id },
          });
          await bot.sendMessage(
            msg.chat.id,
            "🎉 Welcome to Weyra Bingo! — እንኳን ወደ ወይራ ቢንጎ መጡ!\n" +
              "━━━━━━━━━━━━━━━━━━\n" +
              "✅ Registration Successful!\n" +
              "🎁 Bonus: You've received 10.00 ETB in your Play Wallet!\n" +
              `💰 Current Wallet: ${new Decimal(updated.wallet.toString()).toFixed(2)} ETB\n` +
              "━━━━━━━━━━━━━━━━━━\n" +
              "Good luck and have fun! / መልካም እድል!",
            { reply_markup: { remove_keyboard: true } },
          );

          // Reward referrer
          const state = getUserState(tid);
          const refTid = state.referrerTid;
          if (refTid && refTid !== tid) {
            const referrer = await prisma.player.findUnique({
              where: { telegramId: BigInt(refTid) },
            });
            if (referrer) {
              const refBonus = new Decimal(5);
              await prisma.player.update({
                where: { id: referrer.id },
                data: { gift: { increment: parseFloat(refBonus.toString()) } },
              });
              await prisma.transaction.create({
                data: {
                  playerId: referrer.id,
                  kind: "referral_bonus",
                  amount: refBonus.toNumber(),
                  note: `Referral bonus from ${player.username || "new player"} (#${player.id})`,
                },
              });
              try {
                await bot.sendMessage(
                  refTid,
                  "🎉 Referral bonus received!\n" +
                    "A new player joined using your link. +5.00 ETB\n" +
                    "Bonus added to Play Wallet.",
                );
              } catch (_) {}
            }
          }
        } else {
          // Duplicate contact message — phone was already set by a concurrent request
          await bot.sendMessage(
            msg.chat.id,
            "Registration completed. Thank you.",
            { reply_markup: { remove_keyboard: true } },
          );
        }
      } else {
        await prisma.player.update({
          where: { id: player.id },
          data: { phone, username: msg.from.username || player.username || "" },
        });
        await bot.sendMessage(
          msg.chat.id,
          "Registration completed. Thank you.",
          { reply_markup: { remove_keyboard: true } },
        );
      }

      await bot.sendMessage(
        msg.chat.id,
        "PLAY AND WIN! - ይጫወቱ ያሸንፉ!! > Pick your Weyra, join the game, and claim your win!\n\nወይራዎን ይምረጡ፣ ጨዋታውን ይቀላቀሉ እና ድልዎን ያረጋግጡ!",
        {
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: BUTTON_ROWS(tid) },
        },
      );
      return;
    }

    // Deposit amount step (after user selected a deposit method)
    if (msg.text && !msg.text.startsWith("/")) {
      const tid = msg.from && msg.from.id;
      const chatId = msg.chat && msg.chat.id;
      if (tid && chatId) {
        const state = getUserState(tid);
        if (state && state.awaitingDepositAmount) {
          const text = String(msg.text || "").trim();
          const amt = parsePositiveAmount(text);
          if (!amt) {
            await bot.sendMessage(
              chatId,
              "Please enter a valid deposit amount (number).",
            );
            return;
          }

          state.depositAmount = amt.toFixed(2);
          state.awaitingDepositAmount = false;
          state.awaitingBankReference = true;
          await bot.sendMessage(
            chatId,
            `📋 Enter Bank Reference / Transaction ID — የባንክ ማጣቀሻ ቁጥር ያስገቡ\n\n` +
              `Copy the reference/transaction ID from your bank SMS or receipt and paste it here.\n` +
              `ከባንክ መልዕክት ወይም ደረሰኝ ላይ ያለውን ማጣቀሻ ቁጥር ኮፒ አድርገው እዚህ ይለጥፉ\n\n` +
              `Type \"skip\" to send receipt manually instead.\n` +
              `ለማለፍ \"skip\" ይጻፉ`,
            {
              reply_markup: { remove_keyboard: true },
            },
          );
          return;
        }

        // Bank reference step
        if (state && state.awaitingBankReference) {
          const text = String(msg.text || "").trim();
          state.awaitingBankReference = false;

          if (text.toLowerCase() === "skip" || text === "") {
            // Skip reference — fall back to manual receipt flow
            state.bankReference = null;
            state.awaitingDepositReceipt = true;
            await bot.sendMessage(
              chatId,
              `📸 Send your receipt screenshot/photo or SMS text.\nየደረሰኙን ስክሪንሹት ወይም ፎቶ ወይም መልዕክት ይላኩ።`,
              { reply_markup: { remove_keyboard: true } },
            );
            return;
          }

          // Store the reference
          state.bankReference = text;

          // Create deposit request with bank reference
          const player = await prisma.player.findUnique({
            where: { telegramId: BigInt(tid) },
          });
          if (!player) {
            await bot.sendMessage(chatId, "Please /start first to register.");
            return;
          }

          const amount = parsePositiveAmount(state.depositAmount);
          const method = String(state.lastDepositMethod || "");

          const depositReq = await prisma.depositRequest.create({
            data: {
              playerId: player.id,
              telegramId: BigInt(tid),
              method,
              amount: amount ? amount.toNumber() : undefined,
              bankReference: text,
              status: "pending",
            },
          });

          await bot.sendMessage(
            chatId,
            `⏳ Deposit claim received!\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `Amount: ${state.depositAmount} ETB\n` +
              `Reference: ${text}\n` +
              `Status: Waiting for bank confirmation...\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `Your deposit will be automatically verified when the bank confirms it.`,
          );

          // Check if a matching bank SMS already arrived
          const matchResult = await tryMatchDepositToSms(
            { ...depositReq, player, amount: amount ? amount.toNumber() : null },
            bot,
          );

          if (matchResult.matched) {
            // Already auto-credited — player was notified by autoVerify
            console.log(`[Deposit] Auto-matched deposit #${depositReq.id} immediately`);
          } else {
            // Notify entertainers about the pending claim
            try {
              await notifyEntertainers(bot,
                `💳 Deposit Claim #${depositReq.id} (auto-verify pending)\n` +
                  `━━━━━━━━━━━━━━━━━━\n` +
                  `User: @${player.username || "-"} (id: ${tid})\n` +
                  `Amount: ${state.depositAmount} ETB\n` +
                  `Reference: ${text}\n` +
                  `Method: ${method || "-"}\n` +
                  `Waiting for bank SMS match...`,
                {
                  reply_markup: {
                    inline_keyboard: [
                      [
                        { text: "✅ Approve", callback_data: `approve_deposit:${depositReq.id}` },
                        { text: "❌ Reject", callback_data: `reject_deposit:${depositReq.id}` },
                      ],
                    ],
                  },
                },
              );
            } catch (_) {}
          }

          // Clear deposit state
          state.lastDepositMethod = null;
          state.depositAmount = null;
          state.bankReference = null;
          return;
        }
      }
    }

    // Deposit receipt step (text/SMS receipt)
    if (msg.text && !msg.text.startsWith("/")) {
      const tid = msg.from && msg.from.id;
      const chatId = msg.chat && msg.chat.id;
      if (tid && chatId) {
        const state = getUserState(tid);
        if (state && state.awaitingDepositReceipt) {
          await forwardReceipt(msg);
          return;
        }
      }
    }

    if (!msg.text || msg.text.startsWith("/")) return;
    const chatId = msg.chat.id;
    const text = msg.text.trim();

    if (text === "Cancel") {
      await bot.sendMessage(chatId, "Cancelled.", {
        reply_markup: { remove_keyboard: true },
      });
      return;
    }

    if (text === "💰 Balance") {
      bot.emit("text", msg, [null, null]); // trigger /balance
      const tid = msg.from.id;
      const player = await prisma.player.findUnique({
        where: { telegramId: BigInt(tid) },
      });
      if (!player) return bot.sendMessage(chatId, "Please /start first.");
      const wallet = new Decimal(player.wallet.toString()).toFixed(2);
      const gift = new Decimal(player.gift.toString()).toFixed(2);
      return bot.sendMessage(
        chatId,
        `💰 Wallet: ${wallet} ETB | Play Wallet: ${gift} ETB | Wins: ${player.wins}`,
      );
    }

    if (text === "💳 Deposit") {
      return bot.processUpdate({ message: { ...msg, text: "/deposit" } });
    }
    if (text === "📤 Withdraw") {
      return bot.processUpdate({ message: { ...msg, text: "/withdraw" } });
    }
    if (text === "🎁 Invite") {
      return bot.processUpdate({ message: { ...msg, text: "/invite" } });
    }
    if (text === "📋 Instruction") {
      return bot.processUpdate({ message: { ...msg, text: "/instruction" } });
    }
  });

  // Inline button callbacks (menu, deposit, etc.)
  bot.on("callback_query", async (query) => {
    const data = query.data || "";
    const chatId = query.message && query.message.chat && query.message.chat.id;
    const tid = query.from && query.from.id;
    if (!chatId || !tid) return;

    if (data.startsWith("copy_tid:")) {
      const tidToCopy = data.split(":", 2)[1];
      try {
        await bot.answerCallbackQuery(query.id, {
          text: `User ID: ${tidToCopy}`,
          show_alert: true,
        });
      } catch (_) {}
      return;
    }

    const player = await prisma.player.findUnique({
      where: { telegramId: BigInt(tid) },
    });
    const registered = await ensurePhoneRegistered(bot, chatId, player);
    if (!registered) {
      await bot.answerCallbackQuery(query.id).catch(() => {});
      return;
    }

    if (data.startsWith("deposit_")) {
      await bot.answerCallbackQuery(query.id).catch(() => {});
      const state = getUserState(tid);
      state.lastDepositMethod = data.replace(/^deposit_/, "");
      state.awaitingDepositAmount = true;
      state.awaitingDepositReceipt = false;
      state.depositAmount = null;
      await handleDepositSelection(bot, chatId, data);
      await bot.sendMessage(
        chatId,
        "💰 Enter Deposit Amount — የገንዘብ መጠን ያስገቡ\n",
        {
          reply_markup: {
            remove_keyboard: true,
          },
        },
      );
      return;
    }

    if (data === "play_now") {
      await bot.answerCallbackQuery(query.id).catch(() => {});
      await bot.sendMessage(chatId, "🎮 Tap 'Play Now' to open Weyra Bingo.", {
        reply_markup: buildPlayNowWebAppKeyboard(tid),
      });
      return;
    }

    if (data === "deposit") {
      await bot.answerCallbackQuery(query.id).catch(() => {});
      await bot.sendMessage(
        chatId,
        "🏦 Select Your Bank - ባንክዎን ይምረጡ\nPlease choose your preferred bank to complete the deposit.\nክፍያውን ለመፈጸም የሚጠቀሙበትን ባንክ ይምረጡ።",
        {
          reply_markup: buildDepositKeyboard(),
        },
      );
      return;
    }

    if (data === "check_balance") {
      await bot.answerCallbackQuery(query.id).catch(() => {});
      const player = await prisma.player.findUnique({
        where: { telegramId: BigInt(tid) },
      });
      if (!player) {
        await bot.sendMessage(
          chatId,
          "Unable to retrieve your balance at the moment.",
        );
        return;
      }
      const wallet = new Decimal(player.wallet.toString()).toFixed(2);
      const gift = new Decimal(player.gift.toString()).toFixed(2);
      await bot.sendMessage(
        chatId,
        "```\n" +
          `Username:      ${player.username || "-"}\n` +
          `Wallet:        ${wallet} ETB\n` +
          `Play Wallet:   ${gift} ETB\n` +
          "```",
        { parse_mode: "Markdown" },
      );
      return;
    }

    if (data === "support") {
      await bot.answerCallbackQuery(query.id).catch(() => {});
      await bot.sendMessage(
        chatId,
        /* "Telegram - @username\nPhone - phone" */
      );
      return;
    }

    if (data === "instructions") {
      await bot.answerCallbackQuery(query.id).catch(() => {});
      await bot.sendMessage(
        chatId,
        "<b>🎰 WEYRA BINGO | ወይራ ቢንጎ 🎰</b>\n" +
          "<i>Fast • Fair • Fun</i>\n\n" +
          "<b>GET STARTED | አጀማመር</b>\n" +
          "• <b>REGISTER</b>: Hit 'Register' to link your number.\n" +
          "  መመዝገቢያ፦ 'Register' በመጫን ስልክዎን ያገናኙ።\n" +
          "• <b>DEPOSIT</b>: Use 'Deposit Fund' to add balance.\n" +
          "  ገንዘብ ለመሙላት፦ 'Deposit Fund' በመጠቀም ሂሳብ ይሙሉ፡፡\n" +
          "• <b>PLAY</b>: Click 'Start Play' and set your bet.\n" +
          "  ለመጫወት፦ 'Start Play' በመጫን መወራረጃ ይምረጡ።\n\n" +
          "<b>HOW TO WIN | የአሸናፊነት መንገዶች</b>\n" +
          "• <b>Pick & Accept</b>: Select your lucky numbers.\n" +
          "  መምረጥ፦ የሚወዱትን የቁጥር ካርቴላ መርጠው 'Accept' ይበሉ።\n" +
          "• <b>Mark Your Card</b>: Watch the draw and mark matching numbers.\n" +
          "  ማቅለም፦ የሚወጡትን ቁጥሮች ካርቴላዎ ላይ ያቅልሙ።\n" +
          "• <b>Call BINGO</b>: Win by completing:\n" +
          "  ቢንጎ ለማለት፦ እነዚህን ሲያጠናቅቁ ያሸንፋሉ፡\n" +
          "   - Horizontal / Vertical Row (ወደ ጎን ወይም ወደ ታች)\n" +
          "   - Diagonal Line (ጋድም መስመር)\n" +
          "   - The 4 Corners (አራቱ ጠርዞች)\n\n" +
          "<b>⚠️ RULES | ህግጋት</b>\n" +
          "• <b>Don't Rush</b>: Clicking 'Bingo' by mistake will disqualify you.\n" +
          "  ጥንቃቄ፦ ሳይሞሉ 'Bingo' ቢሉ ከጨዋታው ይባረራሉ።\n" +
          "• <b>Minimum Players</b>: A round needs 2+ players to start.\n" +
          "  ተጫዋች፦ ጨዋታ ለመጀመር ቢያንስ 2 ተጫዋች ያስፈልጋል።\n" +
          "• <b>Be Fast</b>: The first person to hit 'Bingo' takes the prize!\n" +
          "  ፍጥነት፦ ቀድሞ 'Bingo' ያለ ተጫዋች አሸናፊ ይሆናል።\n\n" +
          "<b>Good Luck! | መልካም እድል!</b>",
        { parse_mode: "HTML" },
      );
      return;
    }

    if (data === "invite") {
      await bot.answerCallbackQuery(query.id).catch(() => {});
      const botInfo = await bot.getMe();
      const link = `https://t.me/${botInfo.username}?start=ref_${tid}`;
      await bot.sendMessage(
        chatId,
        `🎁 *Invite Friends*\n\nShare your referral link:\n\`${link}\`\n\nYou'll receive *5 ETB* for each new player who joins using your link!`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "📣 Share Link / ሊንክ ያጋሩ",
                  switch_inline_query: `Join weyra Bingo! ${link}`,
                },
              ],
            ],
          },
        },
      );
      return;
    }

    if (data === "win_patterns") {
      await bot.answerCallbackQuery(query.id).catch(() => {});
      const caption =
        "🎯 Master the Pattern — ዘዴውን ይወቁ!\n" +
        "From straight lines to 4 corners—every pattern is a path to winning big!\n" +
        "ከቀጥታ መስመር እስከ አራቱ ማዕዘኖች—እያንዳንዱ ቅርፅ የታላቅ ድል መንገድ ነው!\n\n" +
        "💡 Play smart and shout BINGO! — በብልሃት ይጫወቱ፣ ቢንጎ ይበሉ!";
      const imgUrl = process.env.WIN_PATTERNS_IMAGE_URL;
      const imgPath = process.env.WIN_PATTERNS_IMAGE_PATH;
      if (imgUrl) {
        try {
          await bot.sendPhoto(chatId, imgUrl, { caption });
          return;
        } catch (_) {}
      } else if (imgPath) {
        try {
          const resolved = path.isAbsolute(imgPath)
            ? imgPath
            : path.join(process.cwd(), imgPath);
          if (fs.existsSync(resolved)) {
            await bot.sendPhoto(chatId, resolved, { caption });
            return;
          }
        } catch (_) {}
      }
      await bot.sendMessage(chatId, caption);
    }
  });

  // Register sub-modules
  setupWithdraw(bot, userState);
  setupInvite(bot);
  setupReport(bot);

  async function forwardReceipt(msg) {
    const entertainerIds = getEntertainerIds();
    if (entertainerIds.length === 0) return;
    const tid = msg.from.id;
    const state = getUserState(tid);
    if (!state || !state.lastDepositMethod) {
      return; // ignore non-deposit photos
    }
    if (state.awaitingDepositAmount || !state.depositAmount) {
      return; // require amount before accepting receipt
    }
    const player = await prisma.player.findUnique({
      where: { telegramId: BigInt(tid) },
    });
    const username =
      player && player.username
        ? player.username
        : msg.from && msg.from.username
          ? msg.from.username
          : "-";
    const phone = player && player.phone ? player.phone : "-";
    const caption = msg.caption || msg.text || "";
    const depositAmountStr = state.depositAmount;
    const depositMethod = state.lastDepositMethod;

    let depositRequestId = null;
    try {
      if (player) {
        const method = String(depositMethod || "");
        const amount = depositAmountStr
          ? parsePositiveAmount(depositAmountStr)
          : null;
        const depositReq = await prisma.depositRequest.create({
          data: {
            playerId: player.id,
            telegramId: BigInt(tid),
            method,
            amount: amount ? amount.toNumber() : undefined,
            caption,
            bankReference: state.bankReference || "",
            telegramMessageId: msg.message_id,
            status: "pending",
          },
        });
        depositRequestId = depositReq.id;
        state.lastDepositMethod = null;
        state.depositAmount = null;
        state.awaitingDepositReceipt = false;
      }
    } catch (err) {
      console.error("deposit request persist error:", err);
    }

    // Forward the receipt image to all entertainers
    await forwardToEntertainers(bot, msg.chat.id, msg.message_id);

    const meta =
      `💳 Deposit Request #${depositRequestId || "N/A"}\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `User: @${username} (id: <code>${tid}</code>)\n` +
      `Phone: ${phone}\n` +
      `Amount: ${depositAmountStr || "N/A"} ETB\n` +
      `Method: ${depositMethod || "N/A"}\n` +
      `Caption: ${caption}`;

    const replyMarkup = depositRequestId
      ? {
          inline_keyboard: [
            [
              {
                text: "✅ Approve",
                callback_data: `approve_deposit:${depositRequestId}`,
              },
              {
                text: "❌ Reject",
                callback_data: `reject_deposit:${depositRequestId}`,
              },
            ],
            [
              { text: "Open User", url: `tg://user?id=${tid}` },
              { text: "Copy ID", callback_data: `copy_tid:${tid}` },
            ],
          ],
        }
      : {
          inline_keyboard: [
            [
              { text: "Open User", url: `tg://user?id=${tid}` },
              { text: "Copy ID", callback_data: `copy_tid:${tid}` },
            ],
          ],
        };

    await notifyEntertainers(bot, meta, {
      parse_mode: "HTML",
      reply_markup: replyMarkup,
    });

    try {
      await bot.sendMessage(
        msg.chat.id,
        "Your receipt has been forwarded for verification. Thank you.",
      );
    } catch (_) {}
  }

  // Handle receipt photos, image documents, or text/SMS receipts (deposit confirmation)
  bot.on("photo", forwardReceipt);
  bot.on("document", async (msg) => {
    if (
      msg.document &&
      msg.document.mime_type &&
      msg.document.mime_type.startsWith("image/")
    ) {
      await forwardReceipt(msg);
    }
  });
}

module.exports = { setupCommands, userState };
