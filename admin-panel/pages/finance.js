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

  const [peopleTab, setPeopleTab] = useState("deposits");
  const [peopleRange, setPeopleRange] = useState("daily");
  const [peoplePage, setPeoplePage] = useState(1);
  const peoplePageSize = 8;

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
  const people = data?.people || null;
  const depositPeople = people?.deposits || null;
  const withdrawPeople = people?.withdrawals || null;

  const activePeopleList = useMemo(() => {
    const source = peopleTab === "withdrawals" ? withdrawPeople : depositPeople;
    const list = source?.[peopleRange];
    return Array.isArray(list) ? list : [];
  }, [depositPeople, withdrawPeople, peopleTab, peopleRange]);

  const peopleTotalPages = useMemo(() => {
    return Math.max(1, Math.ceil(activePeopleList.length / peoplePageSize));
  }, [activePeopleList.length]);

  const peoplePageRows = useMemo(() => {
    const start = (peoplePage - 1) * peoplePageSize;
    return activePeopleList.slice(start, start + peoplePageSize);
  }, [activePeopleList, peoplePage]);

  useEffect(() => {
    setPeoplePage(1);
  }, [peopleTab, peopleRange, day]);

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

          {(depositPeople || withdrawPeople) && (
            <Card title="Deposits & Withdrawals">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Button
                    variant={peopleTab === "deposits" ? "primary" : "outline"}
                    size="sm"
                    onClick={() => setPeopleTab("deposits")}
                  >
                    Deposits
                  </Button>
                  <Button
                    variant={
                      peopleTab === "withdrawals" ? "primary" : "outline"
                    }
                    size="sm"
                    onClick={() => setPeopleTab("withdrawals")}
                  >
                    Withdrawals
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant={peopleRange === "daily" ? "primary" : "outline"}
                    size="sm"
                    onClick={() => setPeopleRange("daily")}
                  >
                    Day
                  </Button>
                  <Button
                    variant={peopleRange === "week" ? "primary" : "outline"}
                    size="sm"
                    onClick={() => setPeopleRange("week")}
                  >
                    Week
                  </Button>
                  <Button
                    variant={peopleRange === "month" ? "primary" : "outline"}
                    size="sm"
                    onClick={() => setPeopleRange("month")}
                  >
                    Month
                  </Button>
                </div>
              </div>

              <div className="mt-4 border border-border rounded-xl bg-bg-secondary/20 overflow-hidden">
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-medium text-muted uppercase tracking-wider border-b border-border">
                        <th className="px-4 py-3">Player</th>
                        <th className="py-3">Count</th>
                        <th className="px-4 py-3 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {peoplePageRows.map((p) => (
                        <tr key={`${peopleTab}_${peopleRange}_${p.playerId}`}>
                          <td className="px-4 py-3 text-slate-200">{p.name}</td>
                          <td className="py-3 text-muted">{p.count || 0}</td>
                          <td className="px-4 py-3 text-right text-slate-100 font-medium tabular-nums">
                            {formatMoney(p.amount)}
                          </td>
                        </tr>
                      ))}
                      {peoplePageRows.length === 0 && (
                        <tr>
                          <td
                            colSpan={3}
                            className="px-4 py-10 text-center text-sm text-muted"
                          >
                            No rows.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
                  <div className="text-xs text-muted mr-2">
                    Page {peoplePage} of {peopleTotalPages}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={peoplePage <= 1}
                    onClick={() => setPeoplePage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={peoplePage >= peopleTotalPages}
                    onClick={() =>
                      setPeoplePage((p) => Math.min(peopleTotalPages, p + 1))
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </AdminShell>
  );
}
