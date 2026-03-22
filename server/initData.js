/**
 * Telegram Mini App initData validation middleware.
 *
 * Validates that requests originate from the Telegram WebApp by verifying
 * the HMAC-SHA256 signature of initData using the bot token.
 *
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
const crypto = require("crypto");

const BOT_TOKEN = process.env.BOT_TOKEN || "";

/**
 * Parse and validate Telegram initData string.
 * Returns the parsed user object if valid, null otherwise.
 */
function validateInitData(initDataRaw) {
  if (!initDataRaw || !BOT_TOKEN) return null;

  try {
    const params = new URLSearchParams(initDataRaw);
    const hash = params.get("hash");
    if (!hash) return null;

    // Build the data-check-string: sorted key=value pairs (excluding hash)
    const entries = [];
    for (const [key, value] of params.entries()) {
      if (key === "hash") continue;
      entries.push([key, value]);
    }
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

    // secret_key = HMAC-SHA256("WebAppData", bot_token)
    const secretKey = crypto
      .createHmac("sha256", "WebAppData")
      .update(BOT_TOKEN)
      .digest();

    // computed_hash = HMAC-SHA256(secret_key, data_check_string)
    const computedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    if (computedHash !== hash) return null;

    // Check auth_date is not too old (allow 24 hours for long sessions)
    const authDate = parseInt(params.get("auth_date") || "0", 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > 86400) return null; // 24 hours

    // Parse user
    const userStr = params.get("user");
    if (!userStr) return null;

    const user = JSON.parse(userStr);
    return {
      id: user.id, // This is the Telegram user ID (tid)
      username: user.username || "",
      firstName: user.first_name || "",
      lastName: user.last_name || "",
      languageCode: user.language_code || "",
    };
  } catch (err) {
    console.error("initData validation error:", err.message);
    return null;
  }
}

/**
 * Express middleware: validates initData from header or query/body param.
 *
 * On success, sets:
 *   req.telegramUser  — parsed user object
 *   req.validatedTid  — BigInt of the user's Telegram ID
 *
 * On failure, returns 401.
 *
 * Pass `{ optional: true }` to allow unauthenticated requests through
 * (req.telegramUser will be null).
 */
function requireInitData(opts = {}) {
  const optional = opts.optional === true;

  return (req, res, next) => {
    // Accept initData from multiple sources:
    // 1. X-Telegram-Init-Data header (preferred)
    // 2. initData query parameter
    // 3. initData body parameter
    const initDataRaw =
      req.headers["x-telegram-init-data"] ||
      req.query?.initData ||
      req.body?.initData ||
      "";

    const user = validateInitData(initDataRaw);

    if (!user) {
      if (optional) {
        req.telegramUser = null;
        req.validatedTid = null;
        return next();
      }
      return res.status(401).json({ ok: false, error: "Invalid or missing Telegram authentication" });
    }

    req.telegramUser = user;
    try {
      req.validatedTid = BigInt(user.id);
    } catch (_) {
      return res.status(401).json({ ok: false, error: "Invalid Telegram user ID" });
    }

    next();
  };
}

module.exports = { validateInitData, requireInitData };
