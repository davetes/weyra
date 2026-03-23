import { useEffect, useState, useCallback } from "react";
import RequireAuth from "../components/RequireAuth";
import AdminShell from "../components/AdminShell";
import Card from "../components/Card";
import Badge from "../components/Badge";
import Button from "../components/Button";
import { Input } from "../components/FormElements";
import { apiFetch } from "../lib/api";
import { saveToken } from "../lib/auth";
import { IconRefresh } from "../components/Icons";

function hasPerm(admin, perm) {
  if (admin?.role === "super_admin") return true;
  const perms = Array.isArray(admin?.permissions) ? admin.permissions : [];
  return perms.includes(perm);
}

export default function BiasControlPage() {
  return (
    <RequireAuth>
      {({ token, admin }) => <BiasInner token={token} admin={admin} />}
    </RequireAuth>
  );
}

function BiasInner({ token, admin }) {
  const canControl = hasPerm(admin, "game.control");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [savingRange, setSavingRange] = useState(false);
  const [error, setError] = useState("");
  const [rangeMin, setRangeMin] = useState("");
  const [rangeMax, setRangeMax] = useState("");

  const loadStatus = useCallback(async () => {
    if (!canControl) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/admin/bias/status", { token });
      setStatus(res);
      if (res?.cardRangeMin != null) {
        setRangeMin(String(res.cardRangeMin));
      }
      if (res?.cardRangeMax != null) {
        setRangeMax(String(res.cardRangeMax));
      }
    } catch (err) {
      if (err?.status === 401) {
        saveToken(null);
        window.location.href = "/login";
        return;
      }
      setError(err?.message || "Failed to load bias status");
    } finally {
      setLoading(false);
    }
  }, [canControl, token]);

  useEffect(() => {
    loadStatus();
    const iv = setInterval(loadStatus, 5000);
    return () => clearInterval(iv);
  }, [loadStatus]);

  async function handleToggle(enabled) {
    setToggling(true);
    setError("");
    try {
      const res = await apiFetch("/api/admin/bias/toggle", {
        token,
        body: { enabled },
      });
      setStatus(res);
    } catch (err) {
      if (err?.status === 401) {
        saveToken(null);
        window.location.href = "/login";
        return;
      }
      setError(err?.message || "Failed to toggle");
    } finally {
      setToggling(false);
    }
  }

  async function handleSaveRange() {
    const minVal = parseInt(rangeMin, 10);
    const maxVal = parseInt(rangeMax, 10);
    if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) {
      setError("Please enter valid min and max values");
      return;
    }

    setSavingRange(true);
    setError("");
    try {
      const res = await apiFetch("/api/admin/bias/card-range", {
        token,
        body: { min: minVal, max: maxVal },
      });
      setStatus(res);
      if (res?.cardRangeMin != null) {
        setRangeMin(String(res.cardRangeMin));
      }
      if (res?.cardRangeMax != null) {
        setRangeMax(String(res.cardRangeMax));
      }
    } catch (err) {
      if (err?.status === 401) {
        saveToken(null);
        window.location.href = "/login";
        return;
      }
      setError(err?.message || "Failed to update card range");
    } finally {
      setSavingRange(false);
    }
  }

  async function handleReset() {
    if (!confirm("Reset all bias stats and pattern cycle?")) return;
    setResetting(true);
    setError("");
    try {
      const res = await apiFetch("/api/admin/bias/reset", {
        token,
        body: {},
      });
      setStatus(res);
    } catch (err) {
      if (err?.status === 401) {
        saveToken(null);
        window.location.href = "/login";
        return;
      }
      setError(err?.message || "Failed to reset");
    } finally {
      setResetting(false);
    }
  }

  const enabled = status?.enabled ?? false;
  const adminWins = status?.adminWins ?? 0;
  const totalRounds = status?.totalRounds ?? 0;
  const patternName = status?.currentPatternName ?? "-";
  const patternIndex = status?.currentPatternIndex ?? 0;
  const recentWinners = Array.isArray(status?.recentWinners)
    ? status.recentWinners
    : [];
  const allPatterns = Array.isArray(status?.allPatterns)
    ? status.allPatterns
    : [];

  return (
    <AdminShell
      admin={admin}
      title="Bias Control"
      onLogout={() => {
        saveToken(null);
        window.location.href = "/login";
      }}
    >
      {!canControl ? (
        <Card title="No access">
          <div className="text-sm text-muted">
            You do not have permission to control bias settings.
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Toggle & Status */}
          <div className="lg:col-span-5 space-y-4">
            <Card title="Toggle Control">
              {error && (
                <div className="mb-3 bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger">
                  {error}
                </div>
              )}
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <div className="text-sm font-medium text-slate-200">
                    Bias Mode
                  </div>
                  <div className="text-xs text-muted mt-1">
                    When ON, admin always wins with a fake name
                  </div>
                </div>
                <button
                  disabled={toggling}
                  onClick={() => handleToggle(!enabled)}
                  className={`relative inline-flex h-8 w-14 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300 ease-in-out focus:outline-none ${
                    enabled
                      ? "bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-[0_0_12px_rgba(16,185,129,0.4)]"
                      : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-7 w-7 transform rounded-full bg-white shadow-lg ring-0 transition-transform duration-300 ease-in-out ${
                      enabled ? "translate-x-6" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={enabled ? "success" : "default"}>
                  {enabled ? "● ACTIVE" : "○ INACTIVE"}
                </Badge>
                <span className="text-xs text-muted">
                  {enabled
                    ? "Admin will win next round"
                    : "Fair gameplay active"}
                </span>
              </div>
            </Card>

            <Card title="Bias Card Range">
              <div className="text-xs text-muted">
                Bias Bot will select a random number of cards between 2 and 10
                for each round.
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-muted mb-1">Minimum cards</div>
                  <Input
                    type="number"
                    min="2"
                    max="10"
                    value={rangeMin}
                    onChange={(e) => setRangeMin(e.target.value)}
                  />
                </div>
                <div>
                  <div className="text-xs text-muted mb-1">Maximum cards</div>
                  <Input
                    type="number"
                    min="2"
                    max="10"
                    value={rangeMax}
                    onChange={(e) => setRangeMax(e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveRange}
                  loading={savingRange}
                >
                  Save Range
                </Button>
                <span className="text-xs text-muted">
                  Current: {rangeMin || "–"} to {rangeMax || "–"}
                </span>
              </div>
            </Card>

            {/* Stats */}
            <Card title="Statistics">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-white/5 border border-border">
                  <div className="text-2xl font-bold text-emerald-400">
                    {adminWins}
                  </div>
                  <div className="text-xs text-muted mt-1">Admin Wins</div>
                </div>
                <div className="p-4 rounded-xl bg-white/5 border border-border">
                  <div className="text-2xl font-bold text-accent-light">
                    {totalRounds}
                  </div>
                  <div className="text-xs text-muted mt-1">Total Rounds</div>
                </div>
                <div className="col-span-2 p-4 rounded-xl bg-white/5 border border-border">
                  <div className="text-xs text-muted">Win Rate</div>
                  <div className="text-xl font-bold text-amber-400 mt-1">
                    {totalRounds > 0
                      ? `${((adminWins / totalRounds) * 100).toFixed(1)}%`
                      : "–"}
                  </div>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={loadStatus}
                  loading={loading}
                >
                  <span className="inline-flex items-center gap-2">
                    <IconRefresh size={14} /> Refresh
                  </span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  loading={resetting}
                >
                  Reset Stats
                </Button>
              </div>
            </Card>
          </div>

          {/* Pattern & Winners */}
          <div className="lg:col-span-7 space-y-4">
            {/* Current Pattern */}
            <Card title="Current Pattern">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-bold text-slate-100">
                    {patternName}
                  </div>
                  <div className="text-xs text-muted mt-1">
                    Pattern #{patternIndex + 1} of {allPatterns.length} in cycle
                  </div>
                </div>
                <div className="text-3xl font-bold text-accent-light/30 font-mono">
                  #{patternIndex + 1}
                </div>
              </div>

              {/* Pattern cycle list */}
              <div className="mt-4">
                <div className="text-xs font-medium text-muted mb-2 uppercase tracking-wider">
                  Pattern Cycle
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1 pr-2">
                  {allPatterns.map((p) => (
                    <div
                      key={p.index}
                      className={`flex items-center gap-3 text-xs px-3 py-2 rounded-lg transition-colors ${
                        p.index === patternIndex
                          ? "bg-accent/15 text-accent-light border border-accent/30"
                          : "text-slate-400 hover:bg-white/5"
                      }`}
                    >
                      <span className="w-6 text-right font-mono text-muted">
                        {p.index + 1}
                      </span>
                      <span
                        className={
                          p.index === patternIndex ? "font-semibold" : ""
                        }
                      >
                        {p.name}
                      </span>
                      {p.index === patternIndex && (
                        <Badge variant="accent">Current</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* Recent Winners */}
            <Card title="Recent Winners (Fake Names)">
              {recentWinners.length === 0 ? (
                <div className="text-sm text-muted">No recent winners.</div>
              ) : (
                <div className="space-y-2">
                  {[...recentWinners].reverse().map((name, i) => (
                    <div
                      key={`${name}-${i}`}
                      className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-border"
                    >
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/30 to-amber-600/30 flex items-center justify-center text-amber-400 font-bold text-xs ring-1 ring-white/10">
                        {recentWinners.length - i}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-slate-200">
                          {name}
                        </div>
                        <div className="text-[10px] text-muted">
                          Round #{totalRounds - i > 0 ? totalRounds - i : "-"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 text-[10px] text-muted">
                Names shown as winners in the game. Same name cannot repeat
                within 10 rounds.
              </div>
            </Card>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
