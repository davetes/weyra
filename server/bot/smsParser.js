// SMS Parser — extracts amount, reference, and bank from Ethiopian bank SMS messages

/**
 * Parse a bank SMS text to extract transaction details.
 * Returns { amount: number|null, reference: string, bank: string } or null if not a bank SMS.
 */
function parseBankSms(text) {
  if (!text || typeof text !== "string") return null;
  const t = text.trim();
  if (t.length < 10) return null;

  let amount = null;
  let reference = "";
  let bank = "";

  // --- Detect bank ---
  const tLower = t.toLowerCase();
  if (
    tLower.includes("commercial bank of ethiopia") ||
    tLower.includes("cbe") ||
    tLower.includes("ንግድ ባንክ")
  ) {
    bank = "CBE";
  } else if (tLower.includes("cbe birr") || tLower.includes("cbebirr")) {
    bank = "CBE Birr";
  } else if (tLower.includes("telebirr") || tLower.includes("tele birr")) {
    bank = "Telebirr";
  } else if (
    tLower.includes("bank of abyssinia") ||
    tLower.includes("boa") ||
    tLower.includes("abyssinia")
  ) {
    bank = "BOA";
  } else if (tLower.includes("awash") || tLower.includes("አዋሽ")) {
    bank = "Awash";
  } else if (tLower.includes("dashen")) {
    bank = "Dashen";
  } else if (tLower.includes("wegagen")) {
    bank = "Wegagen";
  } else if (tLower.includes("abay bank") || tLower.includes("abay")) {
    bank = "Abay";
  } else if (
    tLower.includes("cooperative bank") ||
    tLower.includes("oromia bank")
  ) {
    bank = "Cooperative/Oromia";
  }

  // --- Extract amount ---
  // Patterns: "ETB 500", "500 ETB", "Birr 500.00", "500.00 Birr", "ብር 500", "ETB500.00"
  const amountPatterns = [
    /(?:ETB|Birr|ብር)\s*([\d,]+(?:\.\d{1,2})?)/gi,
    /([\d,]+(?:\.\d{1,2})?)\s*(?:ETB|Birr|ብር)/gi,
    /amount[:\s]*([\d,]+(?:\.\d{1,2})?)/gi,
    /received[:\s]*([\d,]+(?:\.\d{1,2})?)/gi,
    /credited[:\s]*([\d,]+(?:\.\d{1,2})?)/gi,
    /deposited[:\s]*([\d,]+(?:\.\d{1,2})?)/gi,
  ];

  for (const pattern of amountPatterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(t);
    if (match && match[1]) {
      const parsed = parseFloat(match[1].replace(/,/g, ""));
      if (parsed > 0 && isFinite(parsed)) {
        amount = parsed;
        break;
      }
    }
  }

  // --- Extract reference / transaction ID ---
  const refPatterns = [
    /(?:ref(?:erence)?|txn\s*id|transaction\s*id|transaction\s*number\s*is|trans(?:action)?\s*(?:ref|no|number|#)|receipt\s*(?:no|number|#)|FT\d+)[:\s#]*([A-Za-z0-9]+)/gi,
    /\b(FT[A-Za-z0-9]{6,20})\b/gi,
    /\b(TRF[A-Za-z0-9]{6,20})\b/gi,
    /\b(CBE[A-Za-z0-9]{6,20})\b/gi,
    /\b(MP[A-Za-z0-9]{6,20})\b/gi,
  ];

  for (const pattern of refPatterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(t);
    if (match && match[1] && match[1].length >= 4) {
      reference = match[1].trim();
      break;
    }
  }

  // If we couldn't extract at least an amount, it's probably not a bank SMS
  if (amount === null && !reference) return null;

  // If no bank detected but has amount/reference, mark as unknown bank
  if (!bank && (amount || reference)) {
    bank = "Unknown";
  }

  return { amount, reference, bank };
}

/**
 * Check if a text message looks like a bank SMS.
 * Quick heuristic check before running full parser.
 */
function isBankSms(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.toLowerCase();
  const bankKeywords = [
    "etb",
    "birr",
    "ብር",
    "received",
    "credited",
    "deposited",
    "transferred",
    "transaction",
    "txn",
    "ref",
    "cbe",
    "telebirr",
    "boa",
    "awash",
    "dashen",
    "wegagen",
    "commercial bank",
    "bank of abyssinia",
  ];
  let matches = 0;
  for (const kw of bankKeywords) {
    if (t.includes(kw)) matches++;
  }
  // Need at least 2 bank-related keywords to consider it a bank SMS
  return matches >= 2;
}

module.exports = { parseBankSms, isBankSms };
