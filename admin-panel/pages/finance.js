import { useEffect, useMemo, useState } from "react";
import RequireAuth from "../components/RequireAuth";
import AdminShell from "../components/AdminShell";
import Card from "../components/Card";
import Button from "../components/Button";
import { Input } from "../components/FormElements";
import { apiFetch } from "../lib/api";
import { saveToken } from "../lib/auth";
import { IconRefresh, IconTrendingUp } from "../components/Icons";

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

export default function FinancePage() {
  return (
    <RequireAuth>
      {({ token, admin }) => <FinanceInner token={token} admin={admin} />}
    </RequireAuth>
  );
}

function FinanceInner({ token, admin }) {
  const canRead = useMemo(() => hasPerm(admin, "finance.read"), [admin]);
  const [day, setDay] = useState(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  async function load() {
    if (!canRead) return;
    setLoading(true);
    setError("");
    try {
      const q = day ? `?day=${encodeURIComponent(day)}` : "";
      const res = await apiFetch(`/api/admin/finance/daily${q}`, { token });
      setData(res);
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
    load();
  }, [canRead]);

  const pendingCounts = { pendingDeposits: 0, pendingWithdraws: 0 };

  const totals = data?.totals || null;
  const profit = data?.profit || null;

  return (
    <AdminShell
      admin={admin}
      title="Finance Summary"
      pendingCounts={pendingCounts}
      onLogout={() => {
        saveToken(null);
        window.location.href = "/login";
      }}
    >
      {!canRead ? (
        <Card title="No access">
          <div className="text-sm text-muted">
            You do not have permission to view finance.
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card title="Daily Summary" icon={IconTrendingUp}>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[220px]">
                <div className="text-xs text-muted mb-2">Day</div>
                <Input
                  type="date"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
              </div>
              <Button variant="secondary" onClick={load} loading={loading}>
                <span className="inline-flex items-center gap-2">
                  <IconRefresh size={16} /> Refresh
                </span>
              </Button>
            </div>

            {error && (
              <div className="mt-4 bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger animate-fade-in">
                {error}
              </div>
            )}

            {totals && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
                {profit && (
                  <>
                    <div className="border border-border rounded-xl p-4 bg-bg-secondary/20">
                      <div className="text-xs text-muted">Profit (Daily)</div>
                      <div className="pt-1 text-lg font-semibold">
                        {formatMoney(profit.daily)}
                      </div>
                    </div>
                    <div className="border border-border rounded-xl p-4 bg-bg-secondary/20">
                      <div className="text-xs text-muted">Profit (Week)</div>
                      <div className="pt-1 text-lg font-semibold">
                        {formatMoney(profit.week)}
                      </div>
                    </div>
                    <div className="border border-border rounded-xl p-4 bg-bg-secondary/20">
                      <div className="text-xs text-muted">Profit (Month)</div>
                      <div className="pt-1 text-lg font-semibold">
                        {formatMoney(profit.month)}
                      </div>
                    </div>
                    <div className="border border-border rounded-xl p-4 bg-bg-secondary/20">
                      <div className="text-xs text-muted">Profit (Year)</div>
                      <div className="pt-1 text-lg font-semibold">
                        {formatMoney(profit.year)}
                      </div>
                    </div>
                  </>
                )}
                <div className="border border-border rounded-xl p-4 bg-bg-secondary/20">
                  <div className="text-xs text-muted">Deposits approved</div>
                  <div className="pt-1 text-lg font-semibold">
                    {formatMoney(totals.deposits)}
                  </div>
                  <div className="text-xs text-muted">
                    Count: {totals.depositCount || 0}
                  </div>
                </div>
                <div className="border border-border rounded-xl p-4 bg-bg-secondary/20">
                  <div className="text-xs text-muted">Withdrawals approved</div>
                  <div className="pt-1 text-lg font-semibold">
                    {formatMoney(totals.withdrawals)}
                  </div>
                  <div className="text-xs text-muted">
                    Count: {totals.withdrawCount || 0}
                  </div>
                </div>
                <div className="border border-border rounded-xl p-4 bg-bg-secondary/20">
                  <div className="text-xs text-muted">Net</div>
                  <div className="pt-1 text-lg font-semibold">
                    {formatMoney(totals.net)}
                  </div>
                </div>

                <div className="border border-border rounded-xl p-4 bg-bg-secondary/20">
                  <div className="text-xs text-muted">Stakes</div>
                  <div className="pt-1 text-lg font-semibold">
                    {formatMoney(totals.stakes)}
                  </div>
                </div>
                <div className="border border-border rounded-xl p-4 bg-bg-secondary/20">
                  <div className="text-xs text-muted">Payouts</div>
                  <div className="pt-1 text-lg font-semibold">
                    {formatMoney(totals.payouts)}
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}
    </AdminShell>
  );
}
