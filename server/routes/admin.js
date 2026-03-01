const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { Decimal } = require("decimal.js");
const TelegramBot = require("node-telegram-bot-api");
const multer = require("multer");
const { getBot } = require("../bot");
const cache = require("../cache");
const { generateGameId } = require("../utils");

const prisma = new PrismaClient();
const router = express.Router();

const PERMS = {
  players_read: "players.read",
  players_ban: "players.ban",
  admins_manage: "admins.manage",
  games_read: "games.read",
  settings_read: "settings.read",
  settings_write: "settings.write",
  game_control: "game.control",
  finance_read: "finance.read",
  audit_read: "audit.read",
  announce_send: "announce.send",
  deposit_read: "deposit.read",
  deposit_decide: "deposit.decide",
  withdraw_read: "withdraw.read",
  withdraw_decide: "withdraw.decide",
};

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[\n\r",]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const upload = multer({ storage: multer.memoryStorage() });

function parseDateInput(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function startOfWeekMonday(d) {
  const day = startOfDay(d);
  const jsDay = day.getDay();
  const diff = (jsDay + 6) % 7;
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() - diff,
    0,
    0,
    0,
    0,
  );
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function startOfYear(d) {
  return new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
}

async function computeFinanceTotals(start, end) {
  const [deposits, withdraws, stakes, wins, depositCount, withdrawCount] =
    await Promise.all([
      prisma.depositRequest.aggregate({
        where: { status: "approved", decidedAt: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      prisma.withdrawRequest.aggregate({
        where: { status: "approved", decidedAt: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { kind: "stake", createdAt: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { kind: "win", createdAt: { gte: start, lte: end } },
        _sum: { amount: true },
      }),
      prisma.depositRequest.count({
        where: { status: "approved", decidedAt: { gte: start, lte: end } },
      }),
      prisma.withdrawRequest.count({
        where: { status: "approved", decidedAt: { gte: start, lte: end } },
      }),
    ]);

  const totalDeposited = deposits._sum.amount
    ? new Decimal(deposits._sum.amount.toString())
    : new Decimal(0);
  const totalWithdrawn = withdraws._sum.amount
    ? new Decimal(withdraws._sum.amount.toString())
    : new Decimal(0);
  const totalStakes = stakes._sum.amount
    ? new Decimal(stakes._sum.amount.toString())
    : new Decimal(0);
  const totalPayouts = wins._sum.amount
    ? new Decimal(wins._sum.amount.toString())
    : new Decimal(0);

  const net = totalDeposited
    .minus(totalWithdrawn)
    .plus(totalStakes)
    .minus(totalPayouts);

  return {
    deposits: totalDeposited,
    withdrawals: totalWithdrawn,
    stakes: totalStakes,
    payouts: totalPayouts,
    net,
    depositCount,
    withdrawCount,
  };
}

async function audit(req, { action, entityType, entityId, before, after }) {
  try {
    await prisma.adminAuditLog.create({
      data: {
        adminId: req.adminUser.id,
        action: String(action || ""),
        entityType: String(entityType || ""),
        entityId: String(entityId || ""),
        before: before == null ? "" : JSON.stringify(before),
        after: after == null ? "" : JSON.stringify(after),
      },
    });
  } catch (err) {
    console.error("audit log error:", err);
  }
}

router.get(
  "/transactions",
  requireAuth(),
  requirePerm(PERMS.finance_read),
  async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const kind = String(req.query.kind || "").trim();
      const from = parseDateInput(req.query.from);
      const to = parseDateInput(req.query.to);
      const limit = Math.min(
        parseInt(String(req.query.limit || "200"), 10) || 200,
        1000,
      );
      const cursorIdRaw = String(
        req.query.cursorId || req.query.cursor || "",
      ).trim();
      const cursorId = cursorIdRaw ? parseInt(cursorIdRaw, 10) : null;
      const cursorCreatedAt = parseDateInput(req.query.cursorCreatedAt);

      const where = {};
      if (kind) where.kind = kind;
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = from;
        if (to) where.createdAt.lte = to;
      }

      if (q) {
        const or = [];
        or.push({ note: { contains: q, mode: "insensitive" } });
        if (/^\d+$/.test(q)) {
          try {
            or.push({ player: { telegramId: BigInt(q) } });
          } catch (_) {}
        }
        or.push({ player: { username: { contains: q, mode: "insensitive" } } });
        or.push({ player: { phone: { contains: q, mode: "insensitive" } } });
        where.OR = or;
      }

      if (cursorId && cursorCreatedAt) {
        where.AND = [
          {
            OR: [
              { createdAt: { lt: cursorCreatedAt } },
              {
                AND: [
                  { createdAt: { equals: cursorCreatedAt } },
                  { id: { lt: cursorId } },
                ],
              },
            ],
          },
        ];
      }

      const rows = await prisma.transaction.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        include: {
          player: {
            select: {
              id: true,
              telegramId: true,
              username: true,
              phone: true,
            },
          },
        },
      });

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const last = pageRows.length ? pageRows[pageRows.length - 1] : null;
      const nextCursorId = hasMore && last ? last.id : null;
      const nextCursorCreatedAt =
        hasMore && last && last.createdAt
          ? new Date(last.createdAt).toISOString()
          : null;

      return res.json({
        ok: true,
        cursorId: cursorId || null,
        cursorCreatedAt: cursorCreatedAt ? cursorCreatedAt.toISOString() : null,
        nextCursorId,
        nextCursorCreatedAt,
        hasMore,
        transactions: pageRows.map((t) => ({
          id: t.id,
          kind: t.kind,
          amount: t.amount != null ? String(t.amount) : "0",
          note: t.note,
          actorTid: t.actorTid != null ? String(t.actorTid) : null,
          createdAt: t.createdAt,
          player: {
            id: t.player.id,
            telegramId:
              t.player.telegramId != null ? String(t.player.telegramId) : null,
            username: t.player.username || "",
            phone: t.player.phone || "",
          },
        })),
      });
    } catch (err) {
      console.error("transactions error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.get(
  "/transactions.csv",
  requireAuth(),
  requirePerm(PERMS.finance_read),
  async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      const kind = String(req.query.kind || "").trim();
      const from = parseDateInput(req.query.from);
      const to = parseDateInput(req.query.to);
      const limit = Math.min(
        parseInt(String(req.query.limit || "2000"), 10) || 2000,
        10000,
      );

      const where = {};
      if (kind) where.kind = kind;
      if (from || to) {
        where.createdAt = {};
        if (from) where.createdAt.gte = from;
        if (to) where.createdAt.lte = to;
      }
      if (q) {
        const or = [];
        or.push({ note: { contains: q, mode: "insensitive" } });
        if (/^\d+$/.test(q)) {
          try {
            or.push({ player: { telegramId: BigInt(q) } });
          } catch (_) {}
        }
        or.push({ player: { username: { contains: q, mode: "insensitive" } } });
        or.push({ player: { phone: { contains: q, mode: "insensitive" } } });
        where.OR = or;
      }

      const rows = await prisma.transaction.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          player: {
            select: { telegramId: true, username: true, phone: true },
          },
        },
      });

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=transactions_${Date.now()}.csv`,
      );

      const header = [
        "id",
        "created_at",
        "kind",
        "amount",
        "actor_tid",
        "telegram_id",
        "username",
        "phone",
        "note",
      ].join(",");

      const lines = [header];
      for (const t of rows) {
        lines.push(
          [
            t.id,
            t.createdAt ? new Date(t.createdAt).toISOString() : "",
            t.kind,
            t.amount != null ? String(t.amount) : "0",
            t.actorTid != null ? String(t.actorTid) : "",
            t.player && t.player.telegramId != null
              ? String(t.player.telegramId)
              : "",
            t.player ? t.player.username || "" : "",
            t.player ? t.player.phone || "" : "",
            t.note || "",
          ]
            .map(csvEscape)
            .join(","),
        );
      }

      return res.send(lines.join("\n"));
    } catch (err) {
      console.error("transactions csv error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.get(
  "/finance/daily",
  requireAuth(),
  requirePerm(PERMS.finance_read),
  async (req, res) => {
    try {
      const day = parseDateInput(req.query.day) || new Date();
      const start = startOfDay(day);
      const end = endOfDay(day);

      const daily = await computeFinanceTotals(start, end);

      const week = await computeFinanceTotals(startOfWeekMonday(day), end);
      const month = await computeFinanceTotals(startOfMonth(day), end);
      const year = await computeFinanceTotals(startOfYear(day), end);

      return res.json({
        ok: true,
        day: start.toISOString().slice(0, 10),
        totals: {
          deposits: daily.deposits.toFixed(2),
          withdrawals: daily.withdrawals.toFixed(2),
          stakes: daily.stakes.toFixed(2),
          payouts: daily.payouts.toFixed(2),
          net: daily.net.toFixed(2),
          depositCount: daily.depositCount,
          withdrawCount: daily.withdrawCount,
        },
        profit: {
          daily: daily.net.toFixed(2),
          week: week.net.toFixed(2),
          month: month.net.toFixed(2),
          year: year.net.toFixed(2),
        },
      });
    } catch (err) {
      console.error("finance daily error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.get(
  "/audit_logs",
  requireAuth(),
  requirePerm(PERMS.audit_read),
  async (req, res) => {
    try {
      const limit = Math.min(
        parseInt(String(req.query.limit || "200"), 10) || 200,
        1000,
      );
      const entityType = String(req.query.entityType || "").trim();
      const entityId = String(req.query.entityId || "").trim();

      const where = {
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
      };

      const rows = await prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          admin: { select: { id: true, username: true, role: true } },
        },
      });

      return res.json({
        ok: true,
        logs: rows.map((l) => ({
          id: l.id,
          createdAt: l.createdAt,
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId,
          before: l.before,
          after: l.after,
          admin: l.admin,
        })),
      });
    } catch (err) {
      console.error("audit logs error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.get(
  "/health",
  requireAuth(),
  requirePerm(PERMS.settings_read),
  async (req, res) => {
    try {
      const dbOk = await prisma.player
        .count()
        .then(() => true)
        .catch(() => false);
      const redisOk = await cache
        .set(`health_${Date.now()}`, 1, 5)
        .then(() => true)
        .catch(() => false);
      return res.json({ ok: true, dbOk, redisOk, serverTime: Date.now() });
    } catch (err) {
      console.error("health error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.post(
  "/announce",
  requireAuth(),
  requirePerm(PERMS.announce_send),
  upload.single("image"),
  async (req, res) => {
    try {
      const legacyText = String(req.body?.text || "").trim();
      const message = String(req.body?.message || "").trim();
      const caption = String(req.body?.caption || "").trim();
      const photo = String(req.body?.photo || "").trim();
      const max = Math.min(
        parseInt(String(req.body?.max || "500"), 10) || 500,
        5000,
      );

      let uploadedPath = "";
      if (req.file && req.file.buffer && req.file.size > 0) {
        const uploadsDir = path.join(
          __dirname,
          "..",
          "..",
          "public",
          "uploads",
        );
        fs.mkdirSync(uploadsDir, { recursive: true });

        const safeExt = (() => {
          const m = String(req.file.mimetype || "").toLowerCase();
          if (m.includes("png")) return ".png";
          if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
          if (m.includes("webp")) return ".webp";
          return ".jpg";
        })();

        const fname = `announce_${Date.now()}_${Math.random().toString(16).slice(2)}${safeExt}`;
        uploadedPath = path.join(uploadsDir, fname);
        fs.writeFileSync(uploadedPath, req.file.buffer);
      }

      const hasAnyImage = !!(uploadedPath || photo);
      const hasAnyText = !!(message || caption || legacyText);
      if (!hasAnyText && !hasAnyImage) {
        return res
          .status(400)
          .json({ ok: false, error: "Missing text or photo" });
      }

      const players = await prisma.player.findMany({
        select: { telegramId: true },
        take: max,
        orderBy: { id: "asc" },
      });
      const tids = players
        .map((p) => (p.telegramId != null ? Number(p.telegramId) : null))
        .filter(Boolean);

      let sent = 0;
      let failed = 0;
      const liveBot = getBot();
      if (!liveBot) {
        return res
          .status(500)
          .json({ ok: false, error: "Bot is not running on this server" });
      }

      for (const tid of tids) {
        try {
          if (uploadedPath) {
            const useCaption = caption || legacyText || "";
            await liveBot.sendPhoto(tid, uploadedPath, {
              caption: useCaption || undefined,
              parse_mode: "Markdown",
            });
            if (message || (legacyText && !caption)) {
              const followUp = message || legacyText;
              if (followUp) {
                await liveBot.sendMessage(tid, followUp, {
                  parse_mode: "Markdown",
                  disable_web_page_preview: false,
                });
              }
            }
          } else if (photo) {
            const useCaption = caption || legacyText || "";
            await liveBot.sendPhoto(tid, photo, {
              caption: useCaption || undefined,
              parse_mode: "Markdown",
            });
            if (message || (legacyText && !caption)) {
              const followUp = message || legacyText;
              if (followUp) {
                await liveBot.sendMessage(tid, followUp, {
                  parse_mode: "Markdown",
                  disable_web_page_preview: false,
                });
              }
            }
          } else {
            const useMessage = message || legacyText;
            await liveBot.sendMessage(tid, useMessage, {
              parse_mode: "Markdown",
              disable_web_page_preview: false,
            });
          }
          sent += 1;
          await new Promise((r) => setTimeout(r, 20));
        } catch (_) {
          failed += 1;
        }
      }

      await audit(req, {
        action: "announce.send",
        entityType: "announcement",
        entityId: String(Date.now()),
        before: null,
        after: { sent, failed, max, hasImage: !!(uploadedPath || photo) },
      });

      return res.json({ ok: true, sent, failed });
    } catch (err) {
      console.error("announce error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

async function getPauseState(gameId) {
  const keys = [`pause_${gameId}`, `pause_at_${gameId}`, `pause_ms_${gameId}`];
  const row = await cache.mget(keys);
  const paused = row[keys[0]] === 1 || row[keys[0]] === true;
  const pauseAt = row[keys[1]] != null ? Number(row[keys[1]]) : null;
  const pauseMs = row[keys[2]] != null ? Number(row[keys[2]]) : 0;
  const extra = paused && pauseAt ? Math.max(0, Date.now() - pauseAt) : 0;
  return { paused, pauseAt, pauseMs: Math.max(0, pauseMs + extra) };
}

async function pauseGame(gameId) {
  const keys = [`pause_${gameId}`, `pause_at_${gameId}`, `pause_ms_${gameId}`];
  const row = await cache.mget(keys);
  const paused = row[keys[0]] === 1 || row[keys[0]] === true;
  const pauseAt = row[keys[1]] != null ? Number(row[keys[1]]) : null;
  if (paused && pauseAt) return await getPauseState(gameId);

  await cache.set(keys[0], 1);
  await cache.set(keys[1], Date.now());
  if (row[keys[2]] == null) await cache.set(keys[2], 0);
  return await getPauseState(gameId);
}

async function resumeGame(gameId) {
  const keys = [`pause_${gameId}`, `pause_at_${gameId}`, `pause_ms_${gameId}`];
  const row = await cache.mget(keys);
  const paused = row[keys[0]] === 1 || row[keys[0]] === true;
  const pauseAt = row[keys[1]] != null ? Number(row[keys[1]]) : null;
  const prevPauseMs = row[keys[2]] != null ? Number(row[keys[2]]) : 0;

  if (paused && pauseAt) {
    const add = Math.max(0, Date.now() - pauseAt);
    const next = Math.max(0, prevPauseMs + add);
    await cache.set(keys[2], next);
  }

  await cache.set(keys[0], 0);
  await cache.del(keys[1]);
  return await getPauseState(gameId);
}

function parsePermissions(adminUser) {
  try {
    const permsRaw =
      adminUser && adminUser.permissions ? adminUser.permissions : "[]";
    const arr = JSON.parse(permsRaw);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch (_) {
    return [];
  }
}

function hasPerm(adminUser, perm) {
  if (!adminUser) return false;
  if (adminUser.role === "super_admin") return true;
  const perms = parsePermissions(adminUser);
  return perms.includes(perm);
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!hasPerm(req.adminUser, perm))
      return res.status(403).json({ ok: false, error: "Forbidden" });
    return next();
  };
}

function serializePlayer(player) {
  return {
    ...player,
    telegramId: player.telegramId != null ? String(player.telegramId) : null,
  };
}

function serializeDepositRequest(row) {
  return {
    ...row,
    telegramId: row.telegramId != null ? String(row.telegramId) : null,
  };
}

function serializeWithdrawRequest(row) {
  return {
    ...row,
    telegramId: row.telegramId != null ? String(row.telegramId) : null,
  };
}

async function tryNotifyTelegram(chatId, text) {
  try {
    const liveBot = getBot();
    if (liveBot) {
      await liveBot.sendMessage(chatId, text);
      return;
    }
  } catch (_) {}

  try {
    const token = process.env.BOT_TOKEN;
    if (!token || token === "your-telegram-bot-token") return;
    const bot = new TelegramBot(token, { polling: false });
    await bot.sendMessage(chatId, text);
  } catch (err) {
    console.error("telegram notify error:", err ? err.message : err);
  }
}

function nowPlusDays(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function makePasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash || typeof passwordHash !== "string") return false;
  const parts = passwordHash.split("$");
  if (parts.length !== 3) return false;
  const [algo, salt, hash] = parts;
  if (algo !== "scrypt") return false;
  const nextHash = hashPassword(password, salt);
  return crypto.timingSafeEqual(
    Buffer.from(hash, "hex"),
    Buffer.from(nextHash, "hex"),
  );
}

function makeSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getEnvSuperAdminCreds() {
  const username = String(process.env.SUPER_ADMIN_USERNAME || "").trim();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || "");
  if (!username || !password) return null;
  return { username, password };
}

async function ensureEnvSuperAdminUser() {
  const creds = getEnvSuperAdminCreds();
  if (!creds) return null;

  const admin = await prisma.adminUser.upsert({
    where: { username: creds.username },
    update: {
      role: "super_admin",
      passwordHash: makePasswordHash(creds.password),
    },
    create: {
      username: creds.username,
      passwordHash: makePasswordHash(creds.password),
      role: "super_admin",
    },
  });

  return admin;
}

async function getSessionFromReq(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ")
    ? auth.slice("Bearer ".length).trim()
    : null;
  if (!token) return null;

  const session = await prisma.adminSession.findUnique({
    where: { token },
    include: { admin: true },
  });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;

  return session;
}

function requireAuth() {
  return async (req, res, next) => {
    try {
      const session = await getSessionFromReq(req);
      if (!session)
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      req.adminSession = session;
      req.adminUser = session.admin;
      return next();
    } catch (err) {
      console.error("admin auth error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  };
}

function requireRole(roles) {
  const set = new Set(Array.isArray(roles) ? roles : [roles]);
  return (req, res, next) => {
    const role = req.adminUser ? req.adminUser.role : null;
    if (!role || !set.has(role))
      return res.status(403).json({ ok: false, error: "Forbidden" });
    return next();
  };
}

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password)
      return res
        .status(400)
        .json({ ok: false, error: "Missing username or password" });

    const envSuper = getEnvSuperAdminCreds();
    if (
      envSuper &&
      String(username).trim() === envSuper.username &&
      String(password) === envSuper.password
    ) {
      const admin = await ensureEnvSuperAdminUser();
      if (!admin) {
        return res
          .status(500)
          .json({ ok: false, error: "Super admin not configured" });
      }

      const token = makeSessionToken();
      const session = await prisma.adminSession.create({
        data: {
          token,
          adminId: admin.id,
          expiresAt: nowPlusDays(14),
        },
        select: { token: true, expiresAt: true },
      });

      return res.json({
        ok: true,
        token: session.token,
        expiresAt: session.expiresAt,
        admin: {
          id: admin.id,
          username: admin.username,
          role: admin.role,
          permissions: parsePermissions(admin),
        },
      });
    }

    const admin = await prisma.adminUser.findUnique({
      where: { username: String(username).trim() },
    });
    if (!admin || !verifyPassword(String(password), admin.passwordHash)) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }

    const token = makeSessionToken();
    const session = await prisma.adminSession.create({
      data: {
        token,
        adminId: admin.id,
        expiresAt: nowPlusDays(14),
      },
      select: { token: true, expiresAt: true },
    });

    return res.json({
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      admin: {
        id: admin.id,
        username: admin.username,
        role: admin.role,
        permissions: parsePermissions(admin),
      },
    });
  } catch (err) {
    console.error("login error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get(
  "/rooms",
  requireAuth(),
  requirePerm(PERMS.settings_read),
  async (req, res) => {
    try {
      const stakes = [10, 20, 50];
      const rooms = [];

      for (const stake of stakes) {
        const game = await prisma.game.findFirst({
          where: { stake, active: true },
          orderBy: { createdAt: "desc" },
        });
        if (!game) {
          rooms.push({
            stake,
            game: null,
            selections: { players: 0, cards: 0 },
            lastCall: null,
            winner: null,
            pause: { paused: false, pauseMs: 0, pauseAt: null },
          });
          continue;
        }

        const sels = await prisma.selection.findMany({
          where: { gameId: game.id, accepted: true },
          select: { playerId: true },
        });
        const cards = sels.length;
        const players = new Set(sels.map((s) => String(s.playerId))).size;

        const [lastCall, winner, pause] = await Promise.all([
          cache.get(`call_${game.id}`),
          cache.get(`winner_${stake}`),
          getPauseState(game.id),
        ]);

        rooms.push({
          stake,
          game: {
            id: game.id,
            active: game.active,
            finished: game.finished,
            createdAt: game.createdAt,
            countdownStartedAt: game.countdownStartedAt,
            startedAt: game.startedAt,
          },
          selections: { players, cards },
          lastCall: lastCall != null ? String(lastCall) : null,
          winner: winner || null,
          pause,
        });
      }

      return res.json({ ok: true, rooms, serverTime: Date.now() });
    } catch (err) {
      console.error("rooms error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.post(
  "/rooms/:stake/pause",
  requireAuth(),
  requirePerm(PERMS.settings_write),
  async (req, res) => {
    try {
      const stake = parseInt(req.params.stake || "0", 10);
      if (![10, 20, 50].includes(stake)) {
        return res.status(400).json({ ok: false, error: "Invalid stake" });
      }

      const game = await prisma.game.findFirst({
        where: { stake, active: true },
        orderBy: { createdAt: "desc" },
        select: { id: true, startedAt: true },
      });
      if (!game)
        return res.status(404).json({ ok: false, error: "No active game" });
      if (!game.startedAt)
        return res.status(400).json({ ok: false, error: "Game not started" });

      const before = await getPauseState(game.id);
      const after = await pauseGame(game.id);
      await audit(req, {
        action: "game.pause",
        entityType: "game",
        entityId: String(game.id),
        before,
        after,
      });

      return res.json({ ok: true, stake, gameId: game.id, pause: after });
    } catch (err) {
      console.error("pause error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.post(
  "/rooms/:stake/resume",
  requireAuth(),
  requirePerm(PERMS.settings_write),
  async (req, res) => {
    try {
      const stake = parseInt(req.params.stake || "0", 10);
      if (![10, 20, 50].includes(stake)) {
        return res.status(400).json({ ok: false, error: "Invalid stake" });
      }

      const game = await prisma.game.findFirst({
        where: { stake, active: true },
        orderBy: { createdAt: "desc" },
        select: { id: true, startedAt: true },
      });
      if (!game)
        return res.status(404).json({ ok: false, error: "No active game" });
      if (!game.startedAt)
        return res.status(400).json({ ok: false, error: "Game not started" });

      const before = await getPauseState(game.id);
      const after = await resumeGame(game.id);
      await audit(req, {
        action: "game.resume",
        entityType: "game",
        entityId: String(game.id),
        before,
        after,
      });

      return res.json({ ok: true, stake, gameId: game.id, pause: after });
    } catch (err) {
      console.error("resume error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.post(
  "/rooms/:stake/restart",
  requireAuth(),
  requirePerm(PERMS.settings_write),
  async (req, res) => {
    try {
      const stake = parseInt(req.params.stake || "0", 10);
      if (![10, 20, 50].includes(stake)) {
        return res.status(400).json({ ok: false, error: "Invalid stake" });
      }

      const game = await prisma.game.findFirst({
        where: { stake, active: true },
        orderBy: { createdAt: "desc" },
      });
      if (!game)
        return res.status(404).json({ ok: false, error: "No active game" });

      const before = {
        gameId: game.id,
        startedAt: game.startedAt,
        countdownStartedAt: game.countdownStartedAt,
      };

      const nextGame = await prisma.$transaction(async (tx) => {
        await tx.game.update({
          where: { id: game.id },
          data: { active: false, finished: true },
        });
        await tx.selection.deleteMany({ where: { gameId: game.id } });
        const created = await tx.game.create({
          data: { id: generateGameId(), stake },
        });
        return created;
      });

      // Clear related cache keys
      await Promise.all([
        cache.del(`call_${game.id}`),
        cache.del(`pause_${game.id}`),
        cache.del(`pause_at_${game.id}`),
        cache.del(`pause_ms_${game.id}`),
        cache.del(`winner_${stake}`),
      ]);

      const after = { gameId: nextGame.id };
      await audit(req, {
        action: "game.restart",
        entityType: "stake_room",
        entityId: String(stake),
        before,
        after,
      });

      return res.json({
        ok: true,
        stake,
        oldGameId: game.id,
        newGameId: nextGame.id,
      });
    } catch (err) {
      console.error("restart error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.get("/me", requireAuth(), async (req, res) => {
  return res.json({
    ok: true,
    admin: {
      id: req.adminUser.id,
      username: req.adminUser.username,
      role: req.adminUser.role,
      permissions: parsePermissions(req.adminUser),
    },
  });
});

router.get("/stats", requireAuth(), async (req, res) => {
  try {
    const [
      totalPlayers,
      bannedPlayers,
      totalGames,
      activeGames,
      pendingDeposits,
      pendingWithdraws,
      todayPlayers,
      depositStats,
      withdrawStats,
      recentTransactions,
    ] = await Promise.all([
      prisma.player.count(),
      prisma.player.count({ where: { bannedAt: { not: null } } }),
      prisma.game.count(),
      prisma.game.count({ where: { active: true, finished: false } }),
      prisma.depositRequest.count({ where: { status: "pending" } }),
      prisma.withdrawRequest.count({ where: { status: "pending" } }),
      prisma.player.count({
        where: {
          createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        },
      }),
      prisma.depositRequest.aggregate({
        where: { status: "approved" },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.withdrawRequest.aggregate({
        where: { status: "approved" },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.transaction.findMany({
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { player: { select: { id: true, username: true } } },
      }),
    ]);

    return res.json({
      ok: true,
      stats: {
        totalPlayers,
        bannedPlayers,
        totalGames,
        activeGames,
        pendingDeposits,
        pendingWithdraws,
        todayPlayers,
        totalDeposited: depositStats._sum.amount
          ? String(depositStats._sum.amount)
          : "0",
        depositCount: depositStats._count,
        totalWithdrawn: withdrawStats._sum.amount
          ? String(withdrawStats._sum.amount)
          : "0",
        withdrawCount: withdrawStats._count,
        recentTransactions: recentTransactions.map((t) => ({
          ...t,
          amount: t.amount != null ? String(t.amount) : "0",
          actorTid: t.actorTid != null ? String(t.actorTid) : null,
        })),
      },
    });
  } catch (err) {
    console.error("stats error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get(
  "/games",
  requireAuth(),
  requirePerm(PERMS.games_read),
  async (req, res) => {
    try {
      const stake = parseInt(String(req.query.stake || "0"), 10);
      if (![10, 20, 50].includes(stake)) {
        return res.status(400).json({ ok: false, error: "Invalid stake" });
      }

      const limit = Math.min(
        Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50),
        200,
      );

      const games = await prisma.game.findMany({
        where: { stake },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          stake: true,
          active: true,
          finished: true,
          createdAt: true,
          countdownStartedAt: true,
          startedAt: true,
          stakesCharged: true,
          chargedCount: true,
        },
      });

      const ids = games.map((g) => g.id);
      const counts = await prisma.selection.groupBy({
        by: ["gameId"],
        where: { gameId: { in: ids } },
        _count: { _all: true },
      });
      const countByGameId = new Map(
        counts.map((r) => [r.gameId, r._count._all]),
      );

      return res.json({
        ok: true,
        stake,
        games: games.map((g) => ({
          ...g,
          selectionsCount: countByGameId.get(g.id) || 0,
        })),
      });
    } catch (err) {
      console.error("games list error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.get(
  "/games/:id",
  requireAuth(),
  requirePerm(PERMS.games_read),
  async (req, res) => {
    try {
      const id = parseInt(String(req.params.id || "0"), 10);
      if (!id) return res.status(400).json({ ok: false, error: "Invalid id" });

      const game = await prisma.game.findUnique({
        where: { id },
        select: {
          id: true,
          stake: true,
          active: true,
          finished: true,
          createdAt: true,
          countdownStartedAt: true,
          startedAt: true,
          stakesCharged: true,
          chargedCount: true,
        },
      });
      if (!game) return res.status(404).json({ ok: false, error: "Not found" });

      const selections = await prisma.selection.findMany({
        where: { gameId: id },
        orderBy: [{ accepted: "desc" }, { id: "asc" }],
        select: {
          id: true,
          gameId: true,
          playerId: true,
          slot: true,
          index: true,
          accepted: true,
          autoEnabled: true,
          player: {
            select: {
              id: true,
              telegramId: true,
              username: true,
              phone: true,
            },
          },
        },
      });

      const mappedSelections = selections.map((s) => ({
        ...s,
        player: s.player
          ? {
              ...s.player,
              telegramId:
                s.player.telegramId != null
                  ? String(s.player.telegramId)
                  : null,
            }
          : null,
      }));

      const winnerTx = await prisma.transaction.findMany({
        where: {
          kind: "win",
          note: { contains: `Won game #${id}` },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          playerId: true,
          amount: true,
          note: true,
          createdAt: true,
          player: {
            select: {
              telegramId: true,
              username: true,
              phone: true,
            },
          },
        },
      });

      return res.json({
        ok: true,
        game,
        selections: mappedSelections,
        winners: winnerTx.map((t) => ({
          id: t.id,
          playerId: t.playerId,
          telegramId:
            t.player?.telegramId != null ? String(t.player.telegramId) : null,
          name:
            t.player?.username ||
            t.player?.phone ||
            (t.player?.telegramId != null
              ? `Player ${String(t.player.telegramId)}`
              : "Player"),
          amount: t.amount != null ? String(t.amount) : "0",
          note: t.note || "",
          createdAt: t.createdAt,
        })),
      });
    } catch (err) {
      console.error("games detail error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.get(
  "/players",
  requireAuth(),
  requirePerm(PERMS.players_read),
  async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();

      const page = Math.max(
        1,
        parseInt(String(req.query.page || "1"), 10) || 1,
      );
      const pageSize = Math.min(
        Math.max(1, parseInt(String(req.query.pageSize || "8"), 10) || 8),
        100,
      );

      let qTid = null;
      if (q && /^\d+$/.test(q)) {
        try {
          qTid = BigInt(q);
        } catch (_) {
          qTid = null;
        }
      }

      const where = q
        ? {
            OR: [
              { username: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
              ...(qTid != null ? [{ telegramId: qTid }] : []),
            ],
          }
        : undefined;

      const players = await prisma.player.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 2000,
        select: {
          id: true,
          telegramId: true,
          username: true,
          phone: true,
          wallet: true,
          gift: true,
          wins: true,
          bannedAt: true,
          banReason: true,
          createdAt: true,
        },
      });

      const tids = players
        .map((p) => (p.telegramId != null ? String(p.telegramId) : null))
        .filter(Boolean);
      const seenKeys = tids.map((t) => `seen_${t}`);
      const seenMap = await cache.mget(seenKeys);

      const ids = players.map((p) => p.id);
      const lastStakes = await prisma.transaction.findMany({
        where: { playerId: { in: ids }, kind: "stake" },
        orderBy: { createdAt: "desc" },
        distinct: ["playerId"],
        select: { playerId: true, amount: true, createdAt: true },
      });
      const lastStakeByPlayerId = new Map(
        lastStakes.map((t) => [t.playerId, t]),
      );

      const out = players.map((p) => {
        const base = serializePlayer(p);
        const tidStr = p.telegramId != null ? String(p.telegramId) : null;
        const lastSeen = tidStr ? seenMap[`seen_${tidStr}`] : null;
        const lastStake = lastStakeByPlayerId.get(p.id) || null;
        return {
          ...base,
          lastSeen: lastSeen != null ? Number(lastSeen) : null,
          lastStake: lastStake
            ? {
                amount:
                  lastStake.amount != null ? String(lastStake.amount) : "0",
                createdAt: lastStake.createdAt,
              }
            : null,
        };
      });

      out.sort((a, b) => {
        const as = a.lastSeen != null ? Number(a.lastSeen) : -1;
        const bs = b.lastSeen != null ? Number(b.lastSeen) : -1;
        if (as !== bs) return bs - as;
        const ac = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bc = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bc - ac;
      });

      const total = out.length;
      const start = (page - 1) * pageSize;
      const pageRows = out.slice(start, start + pageSize);

      return res.json({
        ok: true,
        page,
        pageSize,
        total,
        players: pageRows,
      });
    } catch (err) {
      console.error("players error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.get(
  "/players/:id/transactions",
  requireAuth(),
  requirePerm(PERMS.players_read),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id)
        return res.status(400).json({ ok: false, error: "Invalid player id" });

      const player = await prisma.player.findUnique({
        where: { id },
        select: { id: true, telegramId: true, wallet: true, username: true },
      });
      if (!player)
        return res.status(404).json({ ok: false, error: "Not found" });

      const limit = Math.min(
        parseInt(String(req.query.limit || "200"), 10) || 200,
        500,
      );

      const rows = await prisma.transaction.findMany({
        where: { playerId: id },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          kind: true,
          amount: true,
          note: true,
          createdAt: true,
        },
      });

      let running = new Decimal(player.wallet.toString());
      const mapped = rows.map((t) => {
        const amt = new Decimal(t.amount.toString());
        const balanceAfter = running;
        const balanceBefore = running.minus(amt);
        running = balanceBefore;
        return {
          id: t.id,
          kind: t.kind,
          note: t.note,
          amount: amt.toNumber(),
          createdAt: t.createdAt,
          balanceBefore: balanceBefore.toNumber(),
          balanceAfter: balanceAfter.toNumber(),
        };
      });

      const referralTotal = mapped
        .filter((t) =>
          String(t.kind || "")
            .toLowerCase()
            .includes("ref"),
        )
        .reduce(
          (acc, t) => acc.plus(new Decimal(String(t.amount))),
          new Decimal(0),
        );

      return res.json({
        ok: true,
        player: {
          id: player.id,
          telegramId: String(player.telegramId),
          username: player.username || "",
        },
        referralTotal: referralTotal.toNumber(),
        transactions: mapped,
      });
    } catch (err) {
      console.error("player transactions error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.patch(
  "/players/:id/ban",
  requireAuth(),
  requirePerm(PERMS.players_ban),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const reason = String((req.body && req.body.reason) || "");
      if (!id)
        return res.status(400).json({ ok: false, error: "Invalid player id" });

      const player = await prisma.player.update({
        where: { id },
        data: { bannedAt: new Date(), banReason: reason },
        select: { id: true, bannedAt: true, banReason: true },
      });
      return res.json({ ok: true, player });
    } catch (err) {
      console.error("ban error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.patch(
  "/players/:id/unban",
  requireAuth(),
  requirePerm(PERMS.players_ban),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id)
        return res.status(400).json({ ok: false, error: "Invalid player id" });

      const player = await prisma.player.update({
        where: { id },
        data: { bannedAt: null, banReason: "" },
        select: { id: true, bannedAt: true, banReason: true },
      });
      return res.json({ ok: true, player });
    } catch (err) {
      console.error("unban error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.patch(
  "/players/:id/wallet",
  requireAuth(),
  requirePerm(PERMS.players_ban),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const walletRaw = req.body && req.body.wallet;
      const deltaRaw = req.body && req.body.delta;
      const noteRaw = req.body && req.body.note;
      if (!id)
        return res.status(400).json({ ok: false, error: "Invalid player id" });

      const note = String(noteRaw || "").trim();
      const hasDelta =
        deltaRaw !== undefined &&
        deltaRaw !== null &&
        String(deltaRaw).trim() !== "";
      const hasWallet =
        walletRaw !== undefined &&
        walletRaw !== null &&
        String(walletRaw).trim() !== "";
      if (!hasDelta && !hasWallet) {
        return res
          .status(400)
          .json({ ok: false, error: "Provide delta or wallet" });
      }

      let parsedDelta = null;
      if (hasDelta) {
        try {
          parsedDelta = new Decimal(String(deltaRaw));
        } catch (_) {
          parsedDelta = null;
        }
        if (!parsedDelta || !parsedDelta.isFinite()) {
          return res.status(400).json({ ok: false, error: "Invalid delta" });
        }
      }

      let parsedWallet = null;
      if (hasWallet) {
        try {
          parsedWallet = new Decimal(String(walletRaw));
        } catch (_) {
          parsedWallet = null;
        }
        if (!parsedWallet || !parsedWallet.isFinite() || parsedWallet.lt(0)) {
          return res.status(400).json({ ok: false, error: "Invalid wallet" });
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
        const player = await tx.player.findUnique({ where: { id } });
        if (!player) return null;

        const prevWallet = new Decimal(player.wallet.toString());
        const nextWallet = parsedWallet
          ? parsedWallet
          : prevWallet.plus(parsedDelta);
        if (!nextWallet.isFinite() || nextWallet.lt(0)) {
          throw new Error("Invalid next wallet");
        }
        const delta = nextWallet.minus(prevWallet);

        const out = await tx.player.update({
          where: { id },
          data: { wallet: nextWallet.toNumber() },
          select: {
            id: true,
            telegramId: true,
            username: true,
            phone: true,
            wallet: true,
            gift: true,
            wins: true,
            bannedAt: true,
            banReason: true,
            createdAt: true,
          },
        });

        if (!delta.isZero()) {
          const extra = note ? ` | ${note}` : "";
          await tx.transaction.create({
            data: {
              playerId: id,
              kind: "adjust_wallet",
              amount: delta.toNumber(),
              note: `Wallet adjusted by ${req.adminUser.username} (#${req.adminUser.id})${extra}`,
            },
          });
        }

        return out;
      });

      if (!updated)
        return res.status(404).json({ ok: false, error: "Not found" });
      return res.json({ ok: true, player: serializePlayer(updated) });
    } catch (err) {
      console.error("wallet adjust error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.get(
  "/admins",
  requireAuth(),
  requireRole(["super_admin"]),
  async (req, res) => {
    try {
      const admins = await prisma.adminUser.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          username: true,
          role: true,
          permissions: true,
          roomStake: true,
          createdAt: true,
        },
      });
      const mapped = admins.map((a) => ({
        ...a,
        permissions: parsePermissions(a),
      }));
      return res.json({ ok: true, admins: mapped });
    } catch (err) {
      console.error("admins list error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.post(
  "/admins",
  requireAuth(),
  requireRole(["super_admin"]),
  async (req, res) => {
    try {
      const { username, password, role, permissions, roomStake } =
        req.body || {};
      if (!username || !password || !role)
        return res
          .status(400)
          .json({ ok: false, error: "Missing username, password, or role" });

      const normalizedRole = String(role).trim();
      if (!["admin", "entertainer", "super_admin"].includes(normalizedRole)) {
        return res.status(400).json({ ok: false, error: "Invalid role" });
      }
      if (normalizedRole === "super_admin") {
        return res
          .status(400)
          .json({ ok: false, error: "Cannot create another super_admin" });
      }

      const nextPerms = Array.isArray(permissions)
        ? permissions.map(String).filter(Boolean)
        : [];

      const stakeRaw =
        roomStake == null || String(roomStake).trim() === ""
          ? null
          : parseInt(String(roomStake), 10);
      if (stakeRaw != null && ![10, 20, 50].includes(stakeRaw)) {
        return res.status(400).json({ ok: false, error: "Invalid room stake" });
      }

      const admin = await prisma.adminUser.create({
        data: {
          username: String(username).trim(),
          passwordHash: makePasswordHash(String(password)),
          role: normalizedRole,
          permissions: JSON.stringify(nextPerms),
          roomStake: stakeRaw,
        },
        select: {
          id: true,
          username: true,
          role: true,
          permissions: true,
          roomStake: true,
          createdAt: true,
        },
      });
      return res.json({
        ok: true,
        admin: { ...admin, permissions: parsePermissions(admin) },
      });
    } catch (err) {
      if (err && err.code === "P2002") {
        return res
          .status(409)
          .json({ ok: false, error: "Username already exists" });
      }
      console.error("admins create error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.patch(
  "/admins/:id",
  requireAuth(),
  requireRole(["super_admin"]),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id)
        return res.status(400).json({ ok: false, error: "Invalid admin id" });

      const admin = await prisma.adminUser.findUnique({ where: { id } });
      if (!admin)
        return res.status(404).json({ ok: false, error: "Not found" });
      if (admin.role === "super_admin")
        return res
          .status(400)
          .json({ ok: false, error: "Cannot edit super_admin" });

      const permissions = Array.isArray(req.body && req.body.permissions)
        ? req.body.permissions.map(String).filter(Boolean)
        : null;
      if (!permissions)
        return res
          .status(400)
          .json({ ok: false, error: "Missing permissions" });

      const updated = await prisma.adminUser.update({
        where: { id },
        data: { permissions: JSON.stringify(permissions) },
        select: {
          id: true,
          username: true,
          role: true,
          permissions: true,
          createdAt: true,
        },
      });

      return res.json({
        ok: true,
        admin: { ...updated, permissions: parsePermissions(updated) },
      });
    } catch (err) {
      console.error("admins update error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.delete(
  "/admins/:id",
  requireAuth(),
  requireRole(["super_admin"]),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!id)
        return res.status(400).json({ ok: false, error: "Invalid admin id" });

      const admin = await prisma.adminUser.findUnique({ where: { id } });
      if (!admin)
        return res.status(404).json({ ok: false, error: "Not found" });
      if (admin.role === "super_admin")
        return res
          .status(400)
          .json({ ok: false, error: "Cannot delete super_admin" });

      await prisma.adminSession.updateMany({
        where: { adminId: id },
        data: { revokedAt: new Date() },
      });
      await prisma.adminUser.delete({ where: { id } });

      return res.json({ ok: true });
    } catch (err) {
      console.error("admins delete error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.get(
  "/settings",
  requireAuth(),
  requirePerm(PERMS.settings_read),
  async (req, res) => {
    try {
      const settings = await prisma.appSetting.findMany({
        orderBy: { key: "asc" },
        select: { key: true, value: true, updatedAt: true },
      });
      return res.json({ ok: true, settings });
    } catch (err) {
      console.error("settings list error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.put(
  "/settings",
  requireAuth(),
  requirePerm(PERMS.settings_write),
  async (req, res) => {
    try {
      const settings =
        req.body && Array.isArray(req.body.settings) ? req.body.settings : null;
      if (!settings)
        return res.status(400).json({ ok: false, error: "Missing settings" });

      for (const row of settings) {
        const key = String((row && row.key) || "").trim();
        const value = String((row && row.value) || "");
        if (!key) continue;

        await prisma.appSetting.upsert({
          where: { key },
          create: { key, value },
          update: { value },
        });
      }

      const next = await prisma.appSetting.findMany({
        orderBy: { key: "asc" },
        select: { key: true, value: true, updatedAt: true },
      });
      return res.json({ ok: true, settings: next });
    } catch (err) {
      console.error("settings save error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.get(
  "/deposit_requests",
  requireAuth(),
  requirePerm(PERMS.deposit_read),
  async (req, res) => {
    try {
      const status = String(req.query.status || "pending");
      const where = status ? { status } : undefined;
      const rows = await prisma.depositRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 500,
        include: {
          player: {
            select: { id: true, username: true, phone: true, wallet: true },
          },
        },
      });
      return res.json({
        ok: true,
        requests: rows.map(serializeDepositRequest),
      });
    } catch (err) {
      console.error("deposit_requests list error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.patch(
  "/deposit_requests/:id/decide",
  requireAuth(),
  requirePerm(PERMS.deposit_decide),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const decision = String(
        (req.body && req.body.decision) || "",
      ).toLowerCase();
      const amountRaw = req.body && req.body.amount;
      const note = String((req.body && req.body.note) || "");
      if (!id)
        return res.status(400).json({ ok: false, error: "Invalid request id" });
      if (!["approved", "rejected"].includes(decision))
        return res.status(400).json({ ok: false, error: "Invalid decision" });

      const existing = await prisma.depositRequest.findUnique({
        where: { id },
      });
      if (!existing)
        return res.status(404).json({ ok: false, error: "Not found" });
      if (existing.status !== "pending")
        return res
          .status(409)
          .json({ ok: false, error: "Request already decided" });

      let amountDec = null;
      if (decision === "approved") {
        if (existing.amount != null) {
          amountDec = new Decimal(existing.amount.toString());
        } else {
          try {
            amountDec = new Decimal(String(amountRaw));
          } catch (_) {
            amountDec = null;
          }
          if (!amountDec || amountDec.lte(0))
            return res
              .status(400)
              .json({ ok: false, error: "Missing or invalid amount" });
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
        const reqRow = await tx.depositRequest.update({
          where: { id },
          data: {
            status: decision,
            decidedAt: new Date(),
            decidedByAdminId: req.adminUser.id,
            decisionNote: note,
            amount: amountDec ? amountDec.toNumber() : undefined,
          },
          include: {
            player: {
              select: { id: true, username: true, phone: true, wallet: true },
            },
          },
        });

        if (decision === "approved" && amountDec) {
          await tx.player.update({
            where: { id: reqRow.playerId },
            data: { wallet: { increment: amountDec.toNumber() } },
          });

          await tx.transaction.create({
            data: {
              playerId: reqRow.playerId,
              kind: "deposit",
              amount: amountDec.toNumber(),
              note:
                `Deposit approved by ${req.adminUser.username} (#${req.adminUser.id})` +
                (note ? `: ${note}` : ""),
            },
          });
        }

        return reqRow;
      });

      try {
        const chatId =
          updated.telegramId != null ? String(updated.telegramId) : null;
        if (chatId) {
          const amountText =
            updated.amount != null ? String(updated.amount) : "";
          const methodText = updated.method ? String(updated.method) : "";

          if (decision === "approved") {
            await tryNotifyTelegram(
              chatId,
              `✅ Deposit approved\nAmount: ${amountText} ETB\nMethod: ${methodText}` +
                (note ? `\nNote: ${note}` : ""),
            );
          } else {
            await tryNotifyTelegram(
              chatId,
              `❌ Deposit rejected\nAmount: ${amountText} ETB\nMethod: ${methodText}` +
                (note ? `\nReason: ${note}` : ""),
            );
          }
        }
      } catch (err) {
        console.error("deposit notify error:", err ? err.message : err);
      }

      return res.json({ ok: true, request: serializeDepositRequest(updated) });
    } catch (err) {
      console.error("deposit_requests decide error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.get(
  "/withdraw_requests",
  requireAuth(),
  requirePerm(PERMS.withdraw_read),
  async (req, res) => {
    try {
      const status = String(req.query.status || "pending");
      const where = status ? { status } : undefined;
      const rows = await prisma.withdrawRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 500,
        include: {
          player: {
            select: { id: true, username: true, phone: true, wallet: true },
          },
        },
      });
      return res.json({
        ok: true,
        requests: rows.map(serializeWithdrawRequest),
      });
    } catch (err) {
      console.error("withdraw_requests list error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

router.patch(
  "/withdraw_requests/:id/decide",
  requireAuth(),
  requirePerm(PERMS.withdraw_decide),
  async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const decision = String(
        (req.body && req.body.decision) || "",
      ).toLowerCase();
      const note = String((req.body && req.body.note) || "");
      if (!id)
        return res.status(400).json({ ok: false, error: "Invalid request id" });
      if (!["approved", "rejected"].includes(decision))
        return res.status(400).json({ ok: false, error: "Invalid decision" });

      const existing = await prisma.withdrawRequest.findUnique({
        where: { id },
      });
      if (!existing)
        return res.status(404).json({ ok: false, error: "Not found" });
      if (existing.status !== "pending")
        return res
          .status(409)
          .json({ ok: false, error: "Request already decided" });

      const updated = await prisma.$transaction(async (tx) => {
        const reqRow = await tx.withdrawRequest.update({
          where: { id },
          data: {
            status: decision,
            decidedAt: new Date(),
            decidedByAdminId: req.adminUser.id,
            decisionNote: note,
          },
          include: {
            player: {
              select: { id: true, username: true, phone: true, wallet: true },
            },
          },
        });

        if (decision === "approved") {
          const amountDec = new Decimal(reqRow.amount.toString());
          const player = await tx.player.findUnique({
            where: { id: reqRow.playerId },
          });
          if (!player) throw new Error("Player not found");
          const walletDec = new Decimal(player.wallet.toString());
          if (walletDec.lt(amountDec)) {
            throw new Error(
              "Insufficient wallet balance to approve withdrawal",
            );
          }

          await tx.player.update({
            where: { id: reqRow.playerId },
            data: { wallet: { decrement: amountDec.toNumber() } },
          });

          await tx.transaction.create({
            data: {
              playerId: reqRow.playerId,
              kind: "withdraw",
              amount: amountDec.negated().toNumber(),
              note:
                `Withdraw approved by ${req.adminUser.username} (#${req.adminUser.id})` +
                (note ? `: ${note}` : ""),
            },
          });
        }

        return reqRow;
      });

      try {
        const chatId =
          updated.telegramId != null ? String(updated.telegramId) : null;
        if (chatId) {
          const amountText =
            updated.amount != null ? String(updated.amount) : "";
          const methodText = updated.method ? String(updated.method) : "";
          const accountText = updated.account ? String(updated.account) : "";

          if (decision === "approved") {
            await tryNotifyTelegram(
              chatId,
              `✅ Withdrawal approved\nAmount: ${amountText} ETB\nMethod: ${methodText}\nAccount: ${accountText}` +
                (note ? `\nNote: ${note}` : ""),
            );
          } else {
            await tryNotifyTelegram(
              chatId,
              `❌ Withdrawal rejected\nAmount: ${amountText} ETB\nMethod: ${methodText}\nAccount: ${accountText}` +
                (note ? `\nReason: ${note}` : ""),
            );
          }
        }
      } catch (err) {
        console.error("withdraw notify error:", err ? err.message : err);
      }

      return res.json({ ok: true, request: serializeWithdrawRequest(updated) });
    } catch (err) {
      if (
        String((err && err.message) || "").includes(
          "Insufficient wallet balance",
        )
      ) {
        return res.status(400).json({ ok: false, error: err.message });
      }
      console.error("withdraw_requests decide error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Internal server error" });
    }
  },
);

module.exports = router;
