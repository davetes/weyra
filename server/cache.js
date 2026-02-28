const Redis = require("ioredis");

const redisUrl = String(process.env.REDIS_URL || "").trim();
const redis = redisUrl ? new Redis(redisUrl) : new Redis();

redis.on("error", (err) => {
  console.error("redis error:", err ? err.message : err);
});

function encode(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return JSON.stringify(null);
  }
}

function decode(raw) {
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return undefined;
  }
}

const cache = {
  async get(key) {
    const raw = await redis.get(String(key));
    return decode(raw);
  },

  async set(key, value, ttlSeconds) {
    const k = String(key);
    const v = encode(value);
    const ttl = Number(ttlSeconds);
    if (Number.isFinite(ttl) && ttl > 0) {
      await redis.set(k, v, "EX", Math.floor(ttl));
      return true;
    }
    await redis.set(k, v);
    return true;
  },

  async del(key) {
    await redis.del(String(key));
    return true;
  },

  async mget(keys) {
    const ks = Array.isArray(keys) ? keys.map((k) => String(k)) : [];
    if (!ks.length) return {};
    const raws = await redis.mget(...ks);
    const out = {};
    for (let i = 0; i < ks.length; i += 1) {
      out[ks[i]] = decode(raws[i]);
    }
    return out;
  },
};

module.exports = cache;
