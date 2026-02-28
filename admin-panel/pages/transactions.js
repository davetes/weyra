import { useEffect, useMemo, useState } from "react";
import RequireAuth from "../components/RequireAuth";
import AdminShell from "../components/AdminShell";
import Card from "../components/Card";
import Badge from "../components/Badge";
import Button from "../components/Button";
import { Input, Select } from "../components/FormElements";
import { apiFetch } from "../lib/api";
import { saveToken } from "../lib/auth";
import { IconRefresh, IconWallet } from "../components/Icons";

function hasPerm(admin, perm) {
  if (admin?.role === "super_admin") return true;
  const perms = Array.isArray(admin?.permissions) ? admin.permissions : [];
  return perms.includes(perm);
}

function formatMoney(v) {
  if (v == null) return "0.00";
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDateTime(v) {
  if (!v) return "-";
  try {
    const d = new Date(v);
    const date = d.toLocaleDateString("en-GB");
    const time = d.toLocaleTimeString("en-GB", { hour12: false });
    return `${date}, ${time}`;
  } catch (_) {
    return "-";
  }
}

function kindBadge(kind) {
  const k = String(kind || "").toLowerCase();
  if (k === "deposit") return { variant: "success", label: "Deposit" };
  if (k === "withdraw") return { variant: "danger", label: "Withdraw" };
  if (k === "stake") return { variant: "warning", label: "Stake" };
  if (k === "win") return { variant: "info", label: "Win" };
  if (k.includes("adjust")) return { variant: "accent", label: "Adjust" };
  if (k.includes("ref")) return { variant: "accent", label: "Referral" };
  return { variant: "default", label: kind || "Unknown" };
}

async function downloadCsv(token, url) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      msg = data?.error || msg;
    } catch (_) {}
    throw new Error(msg);
  }

  const blob = await res.blob();
  const a = document.createElement("a");
  const href = URL.createObjectURL(blob);
  a.href = href;
  a.download = `transactions_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}

export default function TransactionsPage() {
  return (
    <RequireAuth>
      {({ token, admin }) => <TransactionsInner token={token} admin={admin} />}
    </RequireAuth>
  );
}

function TransactionsInner({ token, admin }) {
  const canRead = useMemo(() => hasPerm(admin, "finance.read"), [admin]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(8);

  const [cursorId, setCursorId] = useState(null);
  const [cursorCreatedAt, setCursorCreatedAt] = useState(null);
  const [nextCursorId, setNextCursorId] = useState(null);
  const [nextCursorCreatedAt, setNextCursorCreatedAt] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [cursorStack, setCursorStack] = useState([]);

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(next = {}) {
    if (!canRead) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (kind) params.set("kind", kind);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (limit) params.set("limit", String(limit));

      const effectiveCursorId = Object.prototype.hasOwnProperty.call(
        next,
        "cursorId",
      )
        ? next.cursorId
        : cursorId;
      const effectiveCursorCreatedAt = Object.prototype.hasOwnProperty.call(
        next,
        "cursorCreatedAt",
      )
        ? next.cursorCreatedAt
        : cursorCreatedAt;

      if (effectiveCursorId != null && effectiveCursorCreatedAt) {
        params.set("cursorId", String(effectiveCursorId));
        params.set("cursorCreatedAt", String(effectiveCursorCreatedAt));
      }

      const res = await apiFetch(
        `/api/admin/transactions?${params.toString()}`,
        {
          token,
        },
      );
      setRows(Array.isArray(res.transactions) ? res.transactions : []);
      setCursorId(
        res.cursorId != null
          ? Number(res.cursorId)
          : (effectiveCursorId ?? null),
      );
      setCursorCreatedAt(
        res.cursorCreatedAt || effectiveCursorCreatedAt || null,
      );
      setNextCursorId(
        res.nextCursorId != null ? Number(res.nextCursorId) : null,
      );
      setNextCursorCreatedAt(res.nextCursorCreatedAt || null);
      setHasMore(!!res.hasMore);
    } catch (err) {
      if (err?.status === 401) {
        saveToken(null);
        window.location.href = "/login";
        return;
      }
      setError(err?.message || "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCursorId(null);
    setCursorCreatedAt(null);
    setNextCursorId(null);
    setNextCursorCreatedAt(null);
    setHasMore(false);
    setCursorStack([]);
    load({ cursorId: null, cursorCreatedAt: null });
  }, [canRead]);

  const pendingCounts = { pendingDeposits: 0, pendingWithdraws: 0 };

  return (
    <AdminShell
      admin={admin}
      title="Transactions"
      pendingCounts={pendingCounts}
      onLogout={() => {
        saveToken(null);
        window.location.href = "/login";
      }}
    >
      {!canRead ? (
        <Card title="No access">
          <div className="text-sm text-muted">
            You do not have permission to view transactions.
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card title="Filters" icon={IconWallet}>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <Input
                placeholder="Search (tid, phone, username, note)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">All kinds</option>
                <option value="deposit">deposit</option>
                <option value="withdraw">withdraw</option>
                <option value="stake">stake</option>
                <option value="win">win</option>
                <option value="adjust_wallet">adjust_wallet</option>
                <option value="referral_bonus">referral_bonus</option>
              </Select>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
              <Select
                value={String(limit)}
                onChange={(e) => setLimit(parseInt(e.target.value, 10) || 200)}
              >
                <option value="8">8 rows</option>
                <option value="20">20 rows</option>
                <option value="50">50 rows</option>
                <option value="200">200 rows</option>
              </Select>
            </div>

            <div className="pt-4 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setCursorId(null);
                  setCursorCreatedAt(null);
                  setNextCursorId(null);
                  setNextCursorCreatedAt(null);
                  setHasMore(false);
                  setCursorStack([]);
                  load({ cursorId: null, cursorCreatedAt: null });
                }}
                loading={loading}
              >
                <span className="inline-flex items-center gap-2">
                  <IconRefresh size={16} /> Apply
                </span>
              </Button>
              <Button
                variant="secondary"
                disabled={loading}
                onClick={async () => {
                  setError("");
                  try {
                    const params = new URLSearchParams();
                    if (q) params.set("q", q);
                    if (kind) params.set("kind", kind);
                    if (from) params.set("from", from);
                    if (to) params.set("to", to);
                    params.set("limit", "2000");
                    await downloadCsv(
                      token,
                      `/api/admin/transactions.csv?${params.toString()}`,
                    );
                  } catch (err) {
                    setError(err?.message || "Export failed");
                  }
                }}
              >
                Export CSV
              </Button>
            </div>
          </Card>

          {error && (
            <div className="bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger animate-fade-in">
              {error}
            </div>
          )}

          <Card title="Ledger">
            {loading ? (
              <div className="text-sm text-muted">Loading...</div>
            ) : !rows.length ? (
              <div className="text-sm text-muted">No transactions found.</div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted border-b border-border">
                      <th className="text-left py-2 pr-3">Time</th>
                      <th className="text-left py-2 pr-3">Kind</th>
                      <th className="text-left py-2 pr-3">Amount</th>
                      <th className="text-left py-2 pr-3">Player</th>
                      <th className="text-left py-2 pr-3">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => {
                      const badge = kindBadge(t.kind);
                      const amountNum = Number(t.amount);
                      return (
                        <tr key={t.id} className="border-b border-border/50">
                          <td className="py-2 pr-3 whitespace-nowrap">
                            {formatDateTime(t.createdAt)}
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap">
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap font-semibold">
                            {formatMoney(amountNum)}
                          </td>
                          <td className="py-2 pr-3">
                            <div className="text-slate-200">
                              {t.player?.username || t.player?.phone || "-"}
                            </div>
                            <div className="text-xs text-muted">
                              {t.player?.telegramId || "-"}
                            </div>
                          </td>
                          <td className="py-2 pr-3 max-w-[420px]">
                            <div className="truncate" title={t.note || ""}>
                              {t.note || "-"}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="pt-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-xs text-muted">
                Showing {rows.length} items
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={loading || cursorStack.length === 0}
                  onClick={async () => {
                    if (!cursorStack.length) return;
                    const prev = cursorStack[cursorStack.length - 1];
                    setCursorStack((s) => s.slice(0, -1));
                    setCursorId(prev?.cursorId ?? null);
                    setCursorCreatedAt(prev?.cursorCreatedAt ?? null);
                    await load({
                      cursorId: prev?.cursorId ?? null,
                      cursorCreatedAt: prev?.cursorCreatedAt ?? null,
                    });
                  }}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={
                    loading ||
                    !hasMore ||
                    nextCursorId == null ||
                    !nextCursorCreatedAt
                  }
                  onClick={async () => {
                    if (
                      !hasMore ||
                      nextCursorId == null ||
                      !nextCursorCreatedAt
                    )
                      return;
                    setCursorStack((s) => [
                      ...s,
                      { cursorId, cursorCreatedAt },
                    ]);
                    setCursorId(nextCursorId);
                    setCursorCreatedAt(nextCursorCreatedAt);
                    await load({
                      cursorId: nextCursorId,
                      cursorCreatedAt: nextCursorCreatedAt,
                    });
                  }}
                >
                  Next
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </AdminShell>
  );
}
