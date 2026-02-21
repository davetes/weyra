// In-memory cache — replacement for Django LocMem cache
const NodeCache = require('node-cache');

const cache = new NodeCache({ stdTTL: 0, checkperiod: 60 });

module.exports = cache;
