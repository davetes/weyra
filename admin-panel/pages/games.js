import { useEffect, useMemo, useState } from "react";
import RequireAuth from "../components/RequireAuth";
import AdminShell from "../components/AdminShell";
import Card from "../components/Card";
import Badge from "../components/Badge";
import Button from "../components/Button";
import { apiFetch } from "../lib/api";
import { saveToken } from "../lib/auth";
import { togglePlayerForceWin } from "../lib/requests";
import { IconRefresh } from "../components/Icons";

function hasPerm(admin, perm) {
  if (admin?.role === "super_admin") return true;
  const perms = Array.isArray(admin?.permissions) ? admin.permissions : [];
  return perms.includes(perm);
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

function normalizeName(p) {
  if (!p) return "-";
  return (
    p.username ||
    p.phone ||
    (p.telegramId ? `Player ${p.telegramId}` : "Player")
  );
}

export default function GamesPage() {
  return (
    <RequireAuth>
      {({ token, admin }) => <GamesInner token={token} admin={admin} />}
    </RequireAuth>
  );
}

function GamesInner({ token, admin }) {
  const canRead = useMemo(() => hasPerm(admin, "games.read"), [admin]);

  const stakes = [10, 20, 50];
  const [stake, setStake] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [games, setGames] = useState([]);
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const [selectedGameId, setSelectedGameId] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detail, setDetail] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [hideBots, setHideBots] = useState(true);
  const [sortKey, setSortKey] = useState("priority");
  const [sortDir, setSortDir] = useState("desc");

  async function loadGames(nextStake = stake) {
    if (!canRead) return;
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(
        `/api/admin/games?stake=${encodeURIComponent(nextStake)}&limit=100`,
        { token },
      );
      const rows = Array.isArray(res.games) ? res.games : [];
      setGames(rows);
      setPage(1);
      if (!rows.length) {
        setSelectedGameId(null);
        setDetail(null);
      } else if (
        !selectedGameId ||
        !rows.some((g) => g.id === selectedGameId)
      ) {
        setSelectedGameId(rows[0].id);
      }
    } catch (err) {
      if (err?.status === 401) {
        saveToken(null);
        window.location.href = "/login";
        return;
      }
      setError(err?.message || "Failed to load games");
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(gameId) {
    if (!canRead) return;
    if (!gameId) return;
    setDetailLoading(true);
    setDetailError("");
    try {
      const res = await apiFetch(`/api/admin/games/${gameId}`, { token });
      setDetail(res);
    } catch (err) {
      if (err?.status === 401) {
        saveToken(null);
        window.location.href = "/login";
        return;
      }
      setDetailError(err?.message || "Failed to load game detail");
    } finally {
      setDetailLoading(false);
    }
  }

  async function toggleForceWin(selection) {
    if (!selection?.playerId) return;
    setDetailError("");
    setTogglingId(selection.playerId);
    try {
      await togglePlayerForceWin(token, selection.playerId, {
        enabled: !selection.forceWinEnabled,
      });
      await loadDetail(selectedGameId);
    } catch (err) {
      if (err?.status === 401) {
        saveToken(null);
        window.location.href = "/login";
        return;
      }
      setDetailError(err?.message || "Failed to update force win");
    } finally {
      setTogglingId(null);
    }
  }

  useEffect(() => {
    loadGames(stake);
  }, [canRead]);

  useEffect(() => {
    setSelectedGameId(null);
    setDetail(null);
    setPage(1);
    loadGames(stake);
  }, [stake]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(games.length / pageSize));
  }, [games.length]);

  const pageGames = useMemo(() => {
    const start = (page - 1) * pageSize;
    return games.slice(start, start + pageSize);
  }, [games, page]);

  useEffect(() => {
    if (!pageGames.length) return;
    if (selectedGameId && pageGames.some((g) => g.id === selectedGameId))
      return;
    setSelectedGameId(pageGames[0].id);
  }, [page, games.length]);

  useEffect(() => {
    if (!selectedGameId) return;
    loadDetail(selectedGameId);
  }, [selectedGameId]);

  const selectionsRaw = Array.isArray(detail?.selections) ? detail.selections : [];
  const winners = Array.isArray(detail?.winners) ? detail.winners : [];
  const accepted = selectionsRaw.filter((s) => !!s.accepted);
  const acceptedPlayers = new Set(accepted.map((s) => String(s.playerId))).size;
  const canForceWin = !!detail?.game?.active && !detail?.game?.startedAt;

  // Filter and sort selections
  const selections = useMemo(() => {
    let list = selectionsRaw;
    if (hideBots) {
      list = list.filter((s) => !s.stats?.isBiasBot);
    }
    if (sortKey) {
      list = [...list].sort((a, b) => {
        let av, bv;
        switch (sortKey) {
          case "wins": av = a.stats?.wins ?? 0; bv = b.stats?.wins ?? 0; break;
          case "gamesPlayed": av = a.stats?.gamesPlayed ?? 0; bv = b.stats?.gamesPlayed ?? 0; break;
          case "winRate": av = a.stats?.winRate ?? 0; bv = b.stats?.winRate ?? 0; break;
          case "totalDeposited": av = a.stats?.totalDeposited ?? 0; bv = b.stats?.totalDeposited ?? 0; break;
          case "wallet": av = a.stats?.wallet ?? 0; bv = b.stats?.wallet ?? 0; break;
          case "priority": av = a.stats?.priority ?? 0; bv = b.stats?.priority ?? 0; break;
          default: av = 0; bv = 0;
        }
        return sortDir === "asc" ? av - bv : bv - av;
      });
    }
    return list;
  }, [selectionsRaw, hideBots, sortKey, sortDir]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortHeader({ label, field, className = "" }) {
    const active = sortKey === field;
    return (
      <th
        className={`pr-3 py-3 cursor-pointer select-none hover:text-slate-300 transition-colors ${className}`}
        onClick={() => handleSort(field)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active && (
            <span className="text-accent text-[10px]">
              {sortDir === "asc" ? "▲" : "▼"}
            </span>
          )}
        </span>
      </th>
    );
  }

  function PriorityBadge({ value }) {
    let color = "bg-emerald-500/20 text-emerald-400";
    if (value >= 20) color = "bg-red-500/20 text-red-400";
    else if (value >= 10) color = "bg-amber-500/20 text-amber-400";
    return (
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
        {value}
      </span>
    );
  }

  return (
    <AdminShell
      admin={admin}
      title="Games"
      onLogout={() => {
        saveToken(null);
        window.location.href = "/login";
      }}
    >
      {!canRead ? (
        <Card title="No access">
          <div className="text-sm text-muted">
            You do not have permission to view games.
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-4 space-y-3">
            <Card title="Stake">
              <div className="flex gap-2 flex-wrap">
                {stakes.map((s) => (
                  <Button
                    key={s}
                    variant={stake === s ? "primary" : "outline"}
                    size="sm"
                    onClick={() => setStake(s)}
                  >
                    {s} ETB
                  </Button>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => loadGames(stake)}
                  loading={loading}
                >
                  <span className="inline-flex items-center gap-2">
                    <IconRefresh size={16} /> Refresh
                  </span>
                </Button>
              </div>
              {error && (
                <div className="mt-3 bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger">
                  {error}
                </div>
              )}
            </Card>

            <Card title={`Games (${games.length})`}>
              <div className="space-y-2">
                {pageGames.map((g) => {
                  const isActive = !!g.active;
                  const isStarted = !!g.startedAt;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setSelectedGameId(g.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-colors ${
                        selectedGameId === g.id
                          ? "border-accent/50 bg-white/5"
                          : "border-border hover:bg-white/5"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-slate-100">
                          Game #{g.id}
                        </div>
                        {isActive ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="default">Ended</Badge>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {isStarted ? "Started" : "Waiting"} · Cards:{" "}
                        {g.selectionsCount || 0}
                      </div>
                      <div className="mt-1 text-[11px] text-muted">
                        {formatDateTime(g.createdAt)}
                      </div>
                    </button>
                  );
                })}
                {games.length === 0 && !loading && (
                  <div className="text-sm text-muted">No games found.</div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 mt-3">
                <div className="text-xs text-muted">
                  Page {page} of {totalPages}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={loading || page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </Card>
          </div>

          <div className="lg:col-span-8 space-y-3">
            <Card
              title={
                selectedGameId
                  ? `Game #${selectedGameId} Details`
                  : "Select a game"
              }
            >
              {detailError && (
                <div className="bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger mb-3">
                  {detailError}
                </div>
              )}

              {!selectedGameId ? (
                <div className="text-sm text-muted">
                  Select a game from the left.
                </div>
              ) : detailLoading ? (
                <div className="text-sm text-muted">Loading...</div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="text-sm">
                      <span className="text-muted">Stake:</span>{" "}
                      {detail?.game?.stake ?? stake} ETB
                    </div>
                    <div className="text-sm">
                      <span className="text-muted">Status:</span>{" "}
                      {detail?.game?.active ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="default">Ended</Badge>
                      )}
                    </div>
                    <div className="text-sm">
                      <span className="text-muted">Created:</span>{" "}
                      {formatDateTime(detail?.game?.createdAt)}
                    </div>
                    <div className="text-sm">
                      <span className="text-muted">Started:</span>{" "}
                      {formatDateTime(detail?.game?.startedAt)}
                    </div>
                    <div className="text-sm">
                      <span className="text-muted">Accepted players:</span>{" "}
                      {acceptedPlayers}
                    </div>
                    <div className="text-sm">
                      <span className="text-muted">Accepted cards:</span>{" "}
                      {accepted.length}
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-medium text-muted mb-2 uppercase tracking-wider">
                      Winners ({winners.length})
                    </div>
                    {winners.length ? (
                      <div className="space-y-2">
                        {winners.map((w) => (
                          <div
                            key={w.id}
                            className="p-3 rounded-xl border border-border bg-bg-secondary"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="font-semibold text-slate-100">
                                {w.name}
                              </div>
                              <div className="text-sm font-semibold text-success">
                                {w.amount} ETB
                              </div>
                            </div>
                            <div className="mt-1 text-xs text-muted">
                              {formatDateTime(w.createdAt)}
                            </div>
                            <div className="mt-1 text-xs text-muted break-words">
                              {w.note}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted">
                        No winner recorded.
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-medium text-muted uppercase tracking-wider">
                        Players / Cards ({selections.length})
                      </div>
                      <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                        <span className="text-xs text-muted">Hide Bots</span>
                        <button
                          onClick={() => setHideBots((v) => !v)}
                          className={`relative inline-flex h-6 w-10 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-300 ease-in-out focus:outline-none ${
                            hideBots
                              ? "bg-gradient-to-r from-accent to-accent/80"
                              : "bg-slate-700"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform duration-300 ease-in-out ${
                              hideBots ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </label>
                    </div>
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs font-medium text-muted uppercase tracking-wider border-b border-border">
                            <th className="px-4 py-3">Player</th>
                            <th className="pr-3 py-3">Telegram ID</th>
                            <th className="pr-3 py-3">Slot</th>
                            <th className="pr-3 py-3">Card</th>
                            <SortHeader label="Wins" field="wins" />
                            <SortHeader label="Games" field="gamesPlayed" />
                            <SortHeader label="Win%" field="winRate" />
                            <SortHeader label="Deposited" field="totalDeposited" />
                            <SortHeader label="Wallet" field="wallet" />
                            <SortHeader label="Priority" field="priority" />
                            <th className="pr-3 py-3">Force Win</th>
                            <th className="pr-4 py-3">Auto</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selections.map((s) => (
                            <tr
                              key={s.id}
                              className={`border-b border-border/40 ${
                                s.stats?.isBiasBot ? "opacity-50" : ""
                              }`}
                            >
                              <td className="px-4 py-3 text-slate-200">
                                <div className="flex items-center gap-2">
                                  {normalizeName(s.player)}
                                  {s.stats?.isBiasBot && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">BOT</span>
                                  )}
                                </div>
                              </td>
                              <td className="pr-3 py-3 text-muted text-xs font-mono">
                                {s.player?.telegramId != null
                                  ? String(s.player.telegramId)
                                  : "-"}
                              </td>
                              <td className="pr-3 py-3 text-muted">{s.slot}</td>
                              <td className="pr-3 py-3 text-muted">
                                {s.index}
                              </td>
                              <td className="pr-3 py-3 text-slate-300 font-medium">
                                {s.stats?.wins ?? "-"}
                              </td>
                              <td className="pr-3 py-3 text-muted">
                                {s.stats?.gamesPlayed ?? "-"}
                              </td>
                              <td className="pr-3 py-3 text-muted">
                                {s.stats?.winRate != null ? `${s.stats.winRate}%` : "-"}
                              </td>
                              <td className="pr-3 py-3 text-muted">
                                {s.stats?.totalDeposited != null ? `${s.stats.totalDeposited}` : "-"}
                              </td>
                              <td className="pr-3 py-3 text-muted">
                                {s.stats?.wallet != null ? `${s.stats.wallet}` : "-"}
                              </td>
                              <td className="pr-3 py-3">
                                {s.stats?.isBiasBot ? (
                                  <span className="text-xs text-muted">-</span>
                                ) : (
                                  <PriorityBadge value={s.stats?.priority ?? 0} />
                                )}
                              </td>
                              <td className="pr-3 py-3">
                                {canForceWin && s.accepted ? (
                                  <div className="flex items-center gap-2">
                                    <button
                                      disabled={togglingId === s.playerId}
                                      onClick={() => toggleForceWin(s)}
                                      className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-300 ease-in-out focus:outline-none ${
                                        s.forceWinEnabled
                                          ? "bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-[0_0_12px_rgba(16,185,129,0.4)]"
                                          : "bg-slate-700"
                                      }`}
                                    >
                                      <span
                                        className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition-transform duration-300 ease-in-out ${
                                          s.forceWinEnabled
                                            ? "translate-x-5"
                                            : "translate-x-0"
                                        }`}
                                      />
                                    </button>
                                    <span className="text-xs text-muted">
                                      {s.forceWinEnabled ? "ON" : "OFF"}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted">-</span>
                                )}
                              </td>
                              <td className="pr-4 py-3">
                                {s.autoEnabled ? (
                                  <Badge variant="accent">On</Badge>
                                ) : (
                                  <Badge variant="default">Off</Badge>
                                )}
                              </td>
                            </tr>
                          ))}
                          {selections.length === 0 && (
                            <tr>
                              <td
                                colSpan={12}
                                className="text-center py-10 text-muted text-sm"
                              >
                                No selections
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
