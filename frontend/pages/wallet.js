import { useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import {
  Gamepad2,
  History,
  RotateCw,
  User,
  Wallet as WalletIcon,
} from "lucide-react";

export default function WalletPage() {
  const router = useRouter();
  const tid = useMemo(() => {
    const raw = router.query?.tid;
    return raw != null ? String(raw) : "";
  }, [router.query]);

  const [activeTab, setActiveTab] = useState("balance");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [wallet, setWallet] = useState(0);
  const [gift, setGift] = useState(0);
  const [phone, setPhone] = useState("");

  const [action, setAction] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [account, setAccount] = useState("");
  const [caption, setCaption] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [depositAccounts, setDepositAccounts] = useState(null);

  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  async function refresh() {
    if (!tid) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/game_state?stake=10&tid=${encodeURIComponent(tid)}`,
      );
      if (!res.ok) {
        setError("Failed to load wallet");
        return;
      }
      const data = await res.json();
      setWallet(typeof data.wallet === "number" ? data.wallet : 0);
      setGift(typeof data.gift === "number" ? data.gift : 0);
      setPhone(typeof data.phone === "string" ? data.phone : "");
    } catch (e) {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [tid]);

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      if (!tid || activeTab !== "history") return;
      setHistoryLoading(true);
      setHistoryError("");
      try {
        const res = await fetch(
          `/api/wallet_requests?tid=${encodeURIComponent(tid)}`,
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) {
          if (!cancelled)
            setHistoryError(String(data?.error || "Failed to load history"));
          return;
        }
        if (!cancelled)
          setHistoryItems(Array.isArray(data.items) ? data.items : []);
      } catch (_) {
        if (!cancelled) setHistoryError("Network error");
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [tid, activeTab]);

  function statusColor(status) {
    switch (String(status || "").toLowerCase()) {
      case "approved":
        return "bg-emerald-500/15 border-emerald-400/25 text-emerald-200";
      case "rejected":
        return "bg-rose-500/15 border-rose-400/25 text-rose-200";
      default:
        return "bg-amber-500/15 border-amber-400/25 text-amber-200";
    }
  }

  function formatDate(v) {
    if (!v) return "-";
    try {
      return new Date(v).toLocaleString();
    } catch (_) {
      return "-";
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadDepositAccounts() {
      try {
        const res = await fetch("/api/deposit_accounts");
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok) return;
        if (!cancelled) setDepositAccounts(data);
      } catch (_) {
        // ignore
      }
    }
    loadDepositAccounts();
    return () => {
      cancelled = true;
    };
  }, []);

  const verified = String(phone || "").trim().length > 0;

  async function submitDeposit() {
    setError("");
    setNotice("");
    const amt = parseFloat(String(amount || "").trim());
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter a valid amount");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/deposit_request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tid,
          amount: amt,
          method,
          caption,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(String(data?.error || "Failed to submit deposit request"));
        return;
      }
      setNotice("Deposit request submitted");
      setAction("");
      setAmount("");
      setMethod("");
      setCaption("");
    } catch (_) {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitWithdraw() {
    setError("");
    setNotice("");
    const amt = parseFloat(String(amount || "").trim());
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter a valid amount");
      return;
    }
    if (!String(account || "").trim()) {
      setError("Enter your payout account");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/withdraw_request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tid,
          amount: amt,
          method,
          account,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError(String(data?.error || "Failed to submit withdraw request"));
        return;
      }
      setNotice("Withdraw request submitted");
      setAction("");
      setAmount("");
      setMethod("");
      setAccount("");
    } catch (_) {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Head>
        <title>Wallet</title>
      </Head>

      <div className="min-h-[100svh] w-full bg-gradient-to-b from-[#0a0f1a] via-[#0d1321] to-[#0a0f1a] text-white pb-24">
        <div className="px-4 pt-6">
          <div className="flex items-center justify-between">
            <div className="text-3xl font-black tracking-tight">Wallet</div>
            <button
              type="button"
              onClick={refresh}
              disabled={!tid || loading}
              className="w-10 h-10 border border-white/10 bg-white/5 flex items-center justify-center disabled:opacity-50"
              aria-label="Refresh"
            >
              <RotateCw
                className={`w-5 h-5 ${loading ? "animate-spin" : ""}`}
              />
            </button>
          </div>

          <div className="mt-5 rounded-none border border-white/10 bg-white/5 px-4 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 bg-slate-900/60 border border-white/10 flex items-center justify-center flex-none">
                <User className="w-5 h-5 text-white/80" />
              </div>
              <div className="font-black text-lg truncate">{phone || "—"}</div>
            </div>

            <div className="flex items-center gap-2 flex-none">
              {verified && (
                <div className="h-8 px-3 bg-emerald-500/15 border border-emerald-400/25 text-emerald-300 font-bold text-sm flex items-center">
                  Verified
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-none border border-white/10 bg-white/5 p-1">
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setActiveTab("balance")}
                className={`h-11 rounded-xl font-black ${
                  activeTab === "balance"
                    ? "bg-white/10 text-white"
                    : "text-white/60"
                }`}
              >
                Balance
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("history")}
                className={`h-11 rounded-xl font-black ${
                  activeTab === "history"
                    ? "bg-white/10 text-white"
                    : "text-white/60"
                }`}
              >
                History
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-none border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 font-semibold">
              {error}
            </div>
          )}

          {notice && (
            <div className="mt-4 rounded-none border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200 font-semibold">
              {notice}
            </div>
          )}

          {activeTab === "balance" ? (
            <div className="mt-8 space-y-4">
              <div className="rounded-none border border-white/10 bg-white/5 p-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNotice("");
                      setError("");
                      setAction((p) => (p === "deposit" ? "" : "deposit"));
                      setAmount("");
                      setMethod("");
                      setCaption("");
                    }}
                    disabled={!tid || submitting}
                    className="h-11 font-black bg-emerald-500/15 border border-emerald-400/25 text-emerald-200 disabled:opacity-50"
                  >
                    Deposit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNotice("");
                      setError("");
                      setAction((p) => (p === "withdraw" ? "" : "withdraw"));
                      setAmount("");
                      setMethod("");
                      setAccount("");
                    }}
                    disabled={!tid || submitting}
                    className="h-11 font-black bg-rose-500/15 border border-rose-400/25 text-rose-200 disabled:opacity-50"
                  >
                    Withdraw
                  </button>
                </div>

                {action === "deposit" && (
                  <div className="mt-2 border border-white/10 bg-slate-900/40 p-4 space-y-3">
                    <div className="text-sm font-black">Deposit Request</div>
                    <div className="text-xs text-white/70 leading-relaxed">
                      <div className="font-semibold text-white/80">
                        Accounts:
                      </div>
                      <div>
                        Telebirr:{" "}
                        {(depositAccounts?.telebirr?.phone || "—").trim()} —{" "}
                        {(depositAccounts?.telebirr?.name || "—").trim()}
                      </div>
                      <div>
                        CBE Birr:{" "}
                        {(depositAccounts?.cbeBirr?.phone || "—").trim()} —{" "}
                        {(depositAccounts?.cbeBirr?.name || "—").trim()}
                      </div>
                      <div className="h-2" />
                      <div className="font-semibold text-white/80">
                        To Verify:
                      </div>
                      <div>1. Send the payment using Telebirr / CBE Birr.</div>
                      <div>2. Copy the Receipt SMS (or take a screenshot).</div>
                      <div>
                        3. Paste the receipt text in the note field below.
                      </div>
                    </div>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode="decimal"
                      placeholder="Amount (ETB)"
                      className="w-full h-11 px-3 bg-white/5 border border-white/10 text-white outline-none"
                    />
                    <input
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                      placeholder="Method (e.g., Telebirr)"
                      className="w-full h-11 px-3 bg-white/5 border border-white/10 text-white outline-none"
                    />
                    <input
                      value={caption}
                      onChange={(e) => setCaption(e.target.value)}
                      placeholder="Receipt SMS / note (optional)"
                      className="w-full h-11 px-3 bg-white/5 border border-white/10 text-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={submitDeposit}
                      disabled={!tid || submitting}
                      className="w-full h-11 font-black bg-emerald-500/25 border border-emerald-400/25 text-emerald-100 disabled:opacity-50"
                    >
                      {submitting ? "Submitting..." : "Submit Deposit"}
                    </button>
                  </div>
                )}

                {action === "withdraw" && (
                  <div className="mt-2 border border-white/10 bg-slate-900/40 p-4 space-y-3">
                    <div className="text-sm font-black">Withdraw Request</div>
                    <div className="text-xs text-white/70 leading-relaxed">
                      <div className="font-semibold text-white/80">Steps:</div>
                      <div>1. Enter the amount you want to withdraw (ETB).</div>
                      <div>
                        2. Choose your method (Telebirr / CBE Birr / Bank).
                      </div>
                      <div>
                        3. Enter your receiving account/phone and submit.
                      </div>
                    </div>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode="decimal"
                      placeholder="Amount (ETB)"
                      className="w-full h-11 px-3 bg-white/5 border border-white/10 text-white outline-none"
                    />
                    <input
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                      placeholder="Method (e.g., Telebirr)"
                      className="w-full h-11 px-3 bg-white/5 border border-white/10 text-white outline-none"
                    />
                    <input
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      placeholder="Account / phone / bank (required)"
                      className="w-full h-11 px-3 bg-white/5 border border-white/10 text-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={submitWithdraw}
                      disabled={!tid || submitting}
                      className="w-full h-11 font-black bg-rose-500/25 border border-rose-400/25 text-rose-100 disabled:opacity-50"
                    >
                      {submitting ? "Submitting..." : "Submit Withdraw"}
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-none border border-white/10 bg-slate-900/40 px-5 py-6 flex items-center justify-between">
                <div className="text-xl font-semibold text-white/70">
                  Main Wallet
                </div>
                <div className="text-4xl font-black">
                  {Number(wallet || 0).toFixed(2)}
                </div>
              </div>

              <div className="rounded-none border border-white/10 bg-slate-900/40 px-5 py-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/5 border border-white/10 flex items-center justify-center">
                    <History className="w-5 h-5 text-white/70" />
                  </div>
                  <div className="text-xl font-semibold text-white/70">
                    Play Wallet
                  </div>
                </div>
                <div className="text-4xl font-black text-emerald-400">
                  {Number(gift || 0).toFixed(2)}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-8 space-y-3">
              {historyError && (
                <div className="rounded-none border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 font-semibold">
                  {historyError}
                </div>
              )}

              <div className="rounded-none border border-white/10 bg-white/5 p-5">
                <div className="text-sm font-black">Requests</div>
                <div className="mt-1 text-xs text-white/60">
                  Deposit and withdraw requests (pending/approved/rejected)
                </div>

                {historyLoading ? (
                  <div className="mt-4 text-center text-xs text-white/60">
                    Loading...
                  </div>
                ) : historyItems.length === 0 ? (
                  <div className="mt-4 text-center text-xs text-white/60">
                    No requests yet.
                  </div>
                ) : (
                  <div className="mt-4 space-y-2">
                    {historyItems.map((it) => (
                      <div
                        key={`${it.type}_${it.id}`}
                        className="border border-white/10 bg-slate-900/40 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-black truncate">
                              {String(it.type || "").toLowerCase() ===
                              "withdraw"
                                ? "Withdraw"
                                : "Deposit"}{" "}
                              #{it.id}
                            </div>
                            <div className="mt-0.5 text-xs text-white/60 truncate">
                              {formatDate(it.createdAt)}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-none">
                            <div
                              className={`h-8 px-3 border text-xs font-bold flex items-center ${statusColor(
                                it.status,
                              )}`}
                            >
                              {String(it.status || "pending").toUpperCase()}
                            </div>
                          </div>
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-3">
                          <div className="text-xs text-white/70 truncate">
                            {it.method ? `Method: ${it.method}` : ""}
                            {it.note
                              ? `${it.method ? " • " : ""}${it.note}`
                              : ""}
                          </div>
                          <div className="text-sm font-black flex-none">
                            {typeof it.amount === "number"
                              ? `${Number(it.amount).toFixed(2)} ETB`
                              : "-"}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(420px,calc(100vw-1.25rem))] z-[9999]">
          <div className="bg-slate-950/70 backdrop-blur border border-white/10 px-3 py-2 shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() =>
                  router.push(tid ? `/?tid=${encodeURIComponent(tid)}` : "/")
                }
                className="flex flex-col items-center justify-center py-2 text-white/70 hover:bg-white/5"
              >
                <Gamepad2 className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">Game</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    tid
                      ? `/history?tid=${encodeURIComponent(tid)}`
                      : "/history",
                  )
                }
                className="flex flex-col items-center justify-center py-2 rounded-xl text-white/70 hover:bg-white/5"
              >
                <History className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">History</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    tid ? `/wallet?tid=${encodeURIComponent(tid)}` : "/wallet",
                  )
                }
                className="flex flex-col items-center justify-center py-2 rounded-xl bg-sky-500/15 border border-sky-400/20 text-sky-200"
              >
                <WalletIcon className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">Wallet</div>
              </button>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    tid
                      ? `/profile?tid=${encodeURIComponent(tid)}`
                      : "/profile",
                  )
                }
                className="flex flex-col items-center justify-center py-2 rounded-xl text-white/70 hover:bg-white/5"
              >
                <User className="w-5 h-5" />
                <div className="mt-1 text-[11px] font-semibold">Profile</div>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
