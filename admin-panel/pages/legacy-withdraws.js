import { useEffect, useState, useCallback } from "react";
import RequireAuth from "../components/RequireAuth";
import AdminShell from "../components/AdminShell";
import Card from "../components/Card";
import Badge from "../components/Badge";
import Button from "../components/Button";
import { apiFetch } from "../lib/api";
import { saveToken } from "../lib/auth";

function hasPerm(admin, perm) {
  if (admin?.role === "super_admin") return true;
  const perms = Array.isArray(admin?.permissions) ? admin.permissions : [];
  return perms.includes(perm);
}

export default function LegacyWithdrawsPage() {
  return (
    <RequireAuth>
      {({ token, admin }) => <Inner token={token} admin={admin} />}
    </RequireAuth>
  );
}

function Inner({ token, admin }) {
  const canDecide = hasPerm(admin, "withdraw.decide");
  const [requests, setRequests] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState(null);
  const [error, setError] = useState("");

  const loadList = useCallback(async () => {
    if (!canDecide) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/admin/legacy-withdraws", { token });
      setRequests(Array.isArray(res.requests) ? res.requests : []);
      setCount(res.count || 0);
    } catch (err) {
      if (err?.status === 401) {
        saveToken(null);
        window.location.href = "/login";
        return;
      }
      setError(err?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [canDecide, token]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  async function handleFix() {
    if (
      !confirm(
        `⚠️ IMPORTANT: You are about to process ${count} legacy withdraw request(s).\n\n` +
          "FOR EACH REQUEST:\n" +
          "───────────────────────────\n" +
          "✅ If player's wallet >= requested amount:\n" +
          "   → Money will be DEDUCTED from wallet NOW (hold applied)\n" +
          "   → Request stays PENDING — you can approve/reject it normally later\n\n" +
          "❌ If player's wallet < requested amount:\n" +
          "   → Request is AUTO-REJECTED (status → rejected)\n" +
          "   → NO money added or removed (player already spent it)\n" +
          "   → Player will NOT get any refund\n\n" +
          "This action cannot be undone. Continue?"
      )
    )
      return;

    setFixing(true);
    setError("");
    setFixResult(null);
    try {
      const res = await apiFetch("/api/admin/legacy-withdraws/fix", {
        token,
        body: {},
      });
      setFixResult(res);
      await loadList();
    } catch (err) {
      if (err?.status === 401) {
        saveToken(null);
        window.location.href = "/login";
        return;
      }
      setError(err?.message || "Failed to fix");
    } finally {
      setFixing(false);
    }
  }

  // Compute summary stats
  const canHoldCount = requests.filter((r) => r.canApplyHold).length;
  const noHoldCount = requests.filter((r) => !r.canApplyHold).length;
  const totalAmount = requests.reduce(
    (sum, r) => sum + parseFloat(r.amount || 0),
    0
  );
  const holdableAmount = requests
    .filter((r) => r.canApplyHold)
    .reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);

  return (
    <AdminShell
      admin={admin}
      title="Legacy Withdraw Cleanup"
      onLogout={() => {
        saveToken(null);
        window.location.href = "/login";
      }}
    >
      {!canDecide ? (
        <Card title="No access">
          <div className="text-sm text-muted">
            You do not have permission to manage withdrawals.
          </div>
        </Card>
      ) : (
        <div className="space-y-5">
          {/* Explanation Banner */}
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-5 py-4 space-y-3">
            <div className="text-base font-bold text-amber-300">
              ⚠️ What is this page?
            </div>
            <div className="text-sm text-amber-100/80 leading-relaxed">
              Before the recent fix, when a player requested a withdrawal,{" "}
              <strong>their wallet was NOT deducted</strong>. The money stayed in
              their account and they could keep playing with it. Now we have
              pending requests where the money was never held.
            </div>
            <div className="text-sm text-amber-100/80 leading-relaxed">
              <strong>The problem:</strong>
            </div>
            <ul className="text-sm text-amber-100/80 list-disc list-inside space-y-1 pl-2">
              <li>
                If you <strong>Approve</strong> normally → player gets paid but
                their wallet was never deducted (they get free money)
              </li>
              <li>
                If you <strong>Reject</strong> normally → the code refunds money
                that was never taken (player gets free money added)
              </li>
              <li>
                Either way, the player benefits unfairly from the old bug
              </li>
            </ul>
          </div>

          {/* What Fix Does */}
          <div className="rounded-xl bg-sky-500/10 border border-sky-500/20 px-5 py-4 space-y-3">
            <div className="text-base font-bold text-sky-300">
              🔧 What does &quot;Fix All&quot; do?
            </div>
            <div className="text-sm text-sky-100/80 leading-relaxed">
              It goes through each legacy pending request and does one of two
              things:
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3">
                <div className="text-sm font-bold text-emerald-300 mb-1">
                  ✅ Player has enough wallet balance
                </div>
                <div className="text-xs text-emerald-200/70 space-y-1">
                  <p>→ Deducts the amount from their wallet NOW</p>
                  <p>→ Creates a &quot;withdraw_hold&quot; transaction record</p>
                  <p>→ Request stays &quot;pending&quot;</p>
                  <p>
                    → You can then Approve or Reject it normally from the
                    Withdrawals page
                  </p>
                  <p className="mt-2 text-emerald-300 font-semibold">
                    Example: Player has 200, requested 100 → Wallet becomes 100.
                    Then you approve (wallet stays 100) or reject (wallet goes
                    back to 200).
                  </p>
                </div>
              </div>
              <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-4 py-3">
                <div className="text-sm font-bold text-rose-300 mb-1">
                  ❌ Player does NOT have enough balance
                </div>
                <div className="text-xs text-rose-200/70 space-y-1">
                  <p>→ They already spent the money playing games</p>
                  <p>→ Request is auto-rejected (status → rejected)</p>
                  <p>→ NO money is refunded (nothing was ever held)</p>
                  <p>→ No further action needed</p>
                  <p className="mt-2 text-rose-300 font-semibold">
                    Example: Player had 200, requested 200, then played and lost
                    it all (wallet is 0). Request is rejected, wallet stays 0.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-danger-muted border border-danger/20 px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          {/* Summary Stats */}
          <Card title="Summary">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="p-4 rounded-xl bg-white/5 border border-border text-center">
                <div className="text-3xl font-bold text-slate-100">{count}</div>
                <div className="text-xs text-muted mt-1">
                  Total Legacy Requests
                </div>
              </div>
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                <div className="text-3xl font-bold text-emerald-400">
                  {canHoldCount}
                </div>
                <div className="text-xs text-muted mt-1">
                  Can Apply Hold
                </div>
                <div className="text-[10px] text-emerald-300/60 mt-1">
                  {holdableAmount.toFixed(2)} ETB total
                </div>
              </div>
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-center">
                <div className="text-3xl font-bold text-rose-400">
                  {noHoldCount}
                </div>
                <div className="text-xs text-muted mt-1">
                  Will Auto-Reject
                </div>
                <div className="text-[10px] text-rose-300/60 mt-1">
                  Insufficient balance
                </div>
              </div>
              <div className="p-4 rounded-xl bg-white/5 border border-border text-center">
                <div className="text-3xl font-bold text-amber-400">
                  {totalAmount.toFixed(2)}
                </div>
                <div className="text-xs text-muted mt-1">
                  Total Amount (ETB)
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={loadList}
                loading={loading}
              >
                🔄 Refresh List
              </Button>
              {count > 0 && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleFix}
                  loading={fixing}
                >
                  🔧 Fix All ({count} requests)
                </Button>
              )}
            </div>
            {count === 0 && !loading && (
              <div className="text-sm text-emerald-400 py-4 text-center font-semibold mt-2">
                ✅ No legacy requests found. Everything is clean!
              </div>
            )}
          </Card>

          {/* Fix Result */}
          {fixResult && (
            <Card title="✅ Fix Results — What Just Happened">
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                  <div className="text-2xl font-bold text-emerald-400">
                    {fixResult.applied || 0}
                  </div>
                  <div className="text-xs text-muted mt-1">Hold Applied</div>
                  <div className="text-[10px] text-emerald-300/60 mt-1">
                    Money deducted, request stays pending
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-center">
                  <div className="text-2xl font-bold text-rose-400">
                    {fixResult.rejected || 0}
                  </div>
                  <div className="text-xs text-muted mt-1">Auto-Rejected</div>
                  <div className="text-[10px] text-rose-300/60 mt-1">
                    No balance, no refund given
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-white/5 border border-border text-center">
                  <div className="text-2xl font-bold text-slate-400">
                    {fixResult.skipped || 0}
                  </div>
                  <div className="text-xs text-muted mt-1">Skipped</div>
                  <div className="text-[10px] text-slate-400/60 mt-1">
                    Already had hold (new code)
                  </div>
                </div>
              </div>

              {/* Detailed log */}
              {Array.isArray(fixResult.details) &&
                fixResult.details.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-muted mb-2 uppercase tracking-wider">
                      Detailed Log
                    </div>
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {fixResult.details.map((d, i) => (
                        <div
                          key={i}
                          className={`px-4 py-3 rounded-lg border ${
                            d.action === "hold_applied"
                              ? "bg-emerald-500/5 border-emerald-500/15"
                              : "bg-rose-500/5 border-rose-500/15"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-xs font-bold text-slate-300">
                              #{d.id}
                            </span>
                            <span className="text-sm font-semibold text-slate-200">
                              {d.username}
                            </span>
                            <span className="text-xs text-muted">
                              — {d.amount} ETB
                            </span>
                            <Badge
                              variant={
                                d.action === "hold_applied"
                                  ? "success"
                                  : "danger"
                              }
                            >
                              {d.action === "hold_applied"
                                ? "HOLD APPLIED"
                                : "AUTO-REJECTED"}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted">
                            {d.action === "hold_applied" ? (
                              <>
                                Wallet: {d.walletBefore} ETB →{" "}
                                <strong className="text-emerald-300">
                                  {d.walletAfter} ETB
                                </strong>{" "}
                                (deducted {d.amount} ETB). Go to Withdrawals
                                page to approve/reject.
                              </>
                            ) : (
                              <>
                                Wallet was only{" "}
                                <strong className="text-rose-300">
                                  {d.wallet} ETB
                                </strong>{" "}
                                (needed {d.amount} ETB). Player already spent the
                                money. Request rejected, no refund given.
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
            </Card>
          )}

          {/* Request Detail Table */}
          {requests.length > 0 && (
            <Card
              title={`All Legacy Requests (${requests.length})`}
            >
              <div className="text-xs text-muted mb-3">
                These are all pending withdraw requests that were created{" "}
                <strong>without deducting from wallet</strong>. The
                &quot;Can Hold?&quot; column shows whether the player currently
                has enough balance to apply the hold. If not, the request will
                be auto-rejected when you click Fix All.
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted border-b border-border text-left">
                      <th className="py-2 px-2">ID</th>
                      <th className="py-2 px-2">Player</th>
                      <th className="py-2 px-2">Telegram</th>
                      <th className="py-2 px-2 text-right">Requested</th>
                      <th className="py-2 px-2 text-right">Current Wallet</th>
                      <th className="py-2 px-2 text-center">Can Hold?</th>
                      <th className="py-2 px-2 text-center">Will Happen</th>
                      <th className="py-2 px-2">Method</th>
                      <th className="py-2 px-2">Account</th>
                      <th className="py-2 px-2">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => {
                      const walletNum = parseFloat(r.currentWallet || 0);
                      const amountNum = parseFloat(r.amount || 0);
                      const deficit = amountNum - walletNum;
                      return (
                        <tr
                          key={r.id}
                          className={`border-b border-border/50 ${
                            r.canApplyHold
                              ? "hover:bg-emerald-500/5"
                              : "hover:bg-rose-500/5 bg-rose-500/[0.02]"
                          }`}
                        >
                          <td className="py-2.5 px-2 font-mono font-bold">
                            #{r.id}
                          </td>
                          <td className="py-2.5 px-2 font-medium">
                            {r.username}
                          </td>
                          <td className="py-2.5 px-2 font-mono text-muted">
                            {r.telegramId}
                          </td>
                          <td className="py-2.5 px-2 text-right font-bold">
                            {r.amount} ETB
                          </td>
                          <td
                            className={`py-2.5 px-2 text-right font-bold ${
                              r.canApplyHold
                                ? "text-emerald-400"
                                : "text-rose-400"
                            }`}
                          >
                            {r.currentWallet} ETB
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            {r.canApplyHold ? (
                              <Badge variant="success">✅ Yes</Badge>
                            ) : (
                              <Badge variant="danger">❌ No</Badge>
                            )}
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            {r.canApplyHold ? (
                              <span className="text-emerald-300 text-[10px]">
                                Wallet → {(walletNum - amountNum).toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-rose-300 text-[10px]">
                                Reject (short {deficit.toFixed(2)})
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-2">{r.method}</td>
                          <td className="py-2.5 px-2 font-mono text-muted">
                            {r.account}
                          </td>
                          <td className="py-2.5 px-2 text-muted">
                            {new Date(r.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </AdminShell>
  );
}
