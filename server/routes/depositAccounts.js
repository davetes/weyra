async function handleDepositAccounts(req, res) {
  try {
    const telebirrPhone = String(process.env.TELEBIRR_PHONE || "").trim();
    const telebirrName = String(process.env.TELEBIRR_NAME || "").trim();
    const cbeBirrPhone = String(process.env.CBE_BIRR_PHONE || "").trim();
    const cbeBirrName = String(process.env.CBE_BIRR_NAME || "").trim();

    return res.json({
      ok: true,
      telebirr: {
        phone: telebirrPhone,
        name: telebirrName,
      },
      cbeBirr: {
        phone: cbeBirrPhone,
        name: cbeBirrName,
      },
    });
  } catch (err) {
    console.error("deposit_accounts error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
}

module.exports = handleDepositAccounts;
