import { useEffect, useMemo, useState } from 'react';
import RequireAuth from '../components/RequireAuth';
import AdminShell from '../components/AdminShell';
import Card from '../components/Card';
import { apiFetch } from '../lib/api';
import { saveToken } from '../lib/auth';

function hasPerm(admin, perm) {
    if (admin?.role === 'super_admin') return true;
    const perms = Array.isArray(admin?.permissions) ? admin.permissions : [];
    return perms.includes(perm);
}

function formatDate(v) {
    if (!v) return '-';
    try {
        return String(v).slice(0, 10);
    } catch (_) {
        return '-';
    }
}

function formatMoney(v) {
    if (v == null) return '-';
    const n = Number(v);
    if (Number.isNaN(n)) return String(v);
    return n.toFixed(2);
}

function saveLastPlayerId(id) {
    try {
        window.localStorage.setItem('admin_last_player_id', String(id));
    } catch (_) {
    }
}

function loadLastPlayerId() {
    try {
        const v = window.localStorage.getItem('admin_last_player_id');
        const n = parseInt(v || '', 10);
        return n || null;
    } catch (_) {
        return null;
    }
}

export default function PlayersPage() {
    return (
        <RequireAuth>
            {({ token, admin }) => <PlayersInner token={token} admin={admin} />}
        </RequireAuth>
    );
}

function PlayersInner({ token, admin }) {
    const [q, setQ] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [players, setPlayers] = useState([]);
    const [selected, setSelected] = useState(null);
    const [actionError, setActionError] = useState('');

    async function load() {
        setLoading(true);
        setError('');
        setActionError('');
        try {
            const res = await apiFetch(`/api/admin/players?q=${encodeURIComponent(q)}`, { token });
            const nextPlayers = res.players || [];
            setPlayers(nextPlayers);

            const lastId = loadLastPlayerId();
            if (lastId && !selected) {
                const found = nextPlayers.find((p) => p.id === lastId);
                if (found) setSelected(found);
            }
        } catch (err) {
            if (err?.status === 401) {
                saveToken(null);
                window.location.href = '/login';
                return;
            }
            setError(err?.message || 'Failed to load players');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, []);

    const canRead = useMemo(() => hasPerm(admin, 'players.read'), [admin]);
    const canModerate = useMemo(() => hasPerm(admin, 'players.ban'), [admin]);

    async function ban(p) {
        setActionError('');
        try {
            const reason = window.prompt('Ban reason (optional):', p?.banReason || '') || '';
            await apiFetch(`/api/admin/players/${p.id}/ban`, { token, method: 'PATCH', body: { reason } });
            await load();
        } catch (err) {
            setActionError(err?.message || 'Failed');
        }
    }

    async function unban(p) {
        setActionError('');
        try {
            await apiFetch(`/api/admin/players/${p.id}/unban`, { token, method: 'PATCH' });
            await load();
        } catch (err) {
            setActionError(err?.message || 'Failed');
        }
    }

    return (
        <AdminShell
            admin={admin}
            title="Players"
            onLogout={() => {
                saveToken(null);
                window.location.href = '/login';
            }}
        >
            <div className="space-y-4">
                {selected ? (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                        <div className="w-full max-w-2xl bg-panel border border-border rounded-2xl p-5">
                            <div className="flex items-center justify-between">
                                <div className="font-semibold">Player #{selected.id}</div>
                                <button
                                    className="text-xs px-2 py-1 rounded border border-border hover:bg-white/10"
                                    onClick={() => setSelected(null)}
                                >
                                    Close
                                </button>
                            </div>

                            <div className="mt-4 grid md:grid-cols-2 gap-3 text-sm">
                                <div className="border border-border rounded-xl p-3">
                                    <div className="text-xs text-slate-400">Telegram ID</div>
                                    <div className="mt-1 text-slate-200 break-all">{selected.telegramId || '-'}</div>
                                </div>
                                <div className="border border-border rounded-xl p-3">
                                    <div className="text-xs text-slate-400">Username</div>
                                    <div className="mt-1 text-slate-200 break-all">{selected.username || '-'}</div>
                                </div>
                                <div className="border border-border rounded-xl p-3">
                                    <div className="text-xs text-slate-400">Phone</div>
                                    <div className="mt-1 text-slate-200 break-all">{selected.phone || '-'}</div>
                                </div>
                                <div className="border border-border rounded-xl p-3">
                                    <div className="text-xs text-slate-400">Created</div>
                                    <div className="mt-1 text-slate-200">{formatDate(selected.createdAt)}</div>
                                </div>
                                <div className="border border-border rounded-xl p-3">
                                    <div className="text-xs text-slate-400">Wallet</div>
                                    <div className="mt-1 text-slate-200">{formatMoney(selected.wallet)}</div>
                                </div>
                                <div className="border border-border rounded-xl p-3">
                                    <div className="text-xs text-slate-400">Gift</div>
                                    <div className="mt-1 text-slate-200">{formatMoney(selected.gift)}</div>
                                </div>
                                <div className="border border-border rounded-xl p-3">
                                    <div className="text-xs text-slate-400">Wins</div>
                                    <div className="mt-1 text-slate-200">{selected.wins ?? 0}</div>
                                </div>
                                <div className="border border-border rounded-xl p-3">
                                    <div className="text-xs text-slate-400">Banned</div>
                                    <div className="mt-1">
                                        {selected.bannedAt ? (
                                            <div className="text-red-300">Yes</div>
                                        ) : (
                                            <div className="text-emerald-300">No</div>
                                        )}
                                        {selected.bannedAt && selected.banReason ? (
                                            <div className="text-xs text-slate-400 mt-1">Reason: {selected.banReason}</div>
                                        ) : null}
                                    </div>
                                </div>
                            </div>

                            {actionError ? <div className="text-sm text-red-300 mt-4">{actionError}</div> : null}

                            <div className="mt-5 flex items-center justify-end gap-2">
                                {!canModerate ? (
                                    <span className="text-xs text-slate-500">No access</span>
                                ) : selected.bannedAt ? (
                                    <button
                                        className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-white/10 disabled:opacity-60"
                                        disabled={loading}
                                        onClick={() => unban(selected)}
                                    >
                                        Unban
                                    </button>
                                ) : (
                                    <button
                                        className="text-sm px-3 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white disabled:opacity-60"
                                        disabled={loading}
                                        onClick={() => ban(selected)}
                                    >
                                        Ban
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ) : null}

                <Card
                    title="Search"
                    right={
                        <button
                            className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-white/10 disabled:opacity-60"
                            disabled={loading}
                            onClick={load}
                        >
                            {loading ? 'Loading...' : 'Refresh'}
                        </button>
                    }
                >
                    <div className="flex gap-2">
                        <input
                            className="flex-1 bg-transparent border border-border rounded-lg px-3 py-2 text-sm"
                            placeholder="Search by username or phone"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                        />
                        <button
                            className="bg-accent hover:bg-accent-hover transition text-white rounded-lg px-4 py-2 text-sm font-semibold"
                            onClick={load}
                        >
                            Search
                        </button>
                    </div>
                    {error ? <div className="text-sm text-red-300 mt-3">{error}</div> : null}
                </Card>

                {!canRead ? (
                    <Card title="No access">
                        <div className="text-sm text-slate-300">You do not have permission to view players.</div>
                    </Card>
                ) : (
                    <Card title={`Players (${players.length})`}>
                    <div className="overflow-auto">
                        <table className="w-full text-sm">
                            <thead className="text-left text-slate-400">
                                <tr className="border-b border-border">
                                    <th className="py-2 pr-3">ID</th>
                                    <th className="pr-3">Username</th>
                                    <th className="pr-3">Phone</th>
                                    <th className="pr-3">Wallet</th>
                                    <th className="pr-3">Gift</th>
                                    <th className="pr-3">Wins</th>
                                    <th className="pr-3">Banned</th>
                                    <th className="pr-3">Created</th>
                                    <th className="text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {players.map((p) => {
                                    const banned = !!p.bannedAt;
                                    return (
                                        <tr key={p.id} className="border-b border-border/60">
                                            <td className="py-2 pr-3 text-slate-300">{p.id}</td>
                                            <td className="pr-3">{p.username || '-'}</td>
                                            <td className="pr-3 text-slate-300">{p.phone || '-'}</td>
                                            <td className="pr-3 text-slate-300">{formatMoney(p.wallet)}</td>
                                            <td className="pr-3 text-slate-300">{formatMoney(p.gift)}</td>
                                            <td className="pr-3 text-slate-300">{p.wins ?? 0}</td>
                                            <td className="pr-3">
                                                {banned ? (
                                                    <span className="text-red-300">Yes</span>
                                                ) : (
                                                    <span className="text-emerald-300">No</span>
                                                )}
                                            </td>
                                            <td className="pr-3 text-slate-400">{formatDate(p.createdAt)}</td>
                                            <td className="py-2">
                                                <div className="flex justify-end gap-2">
                                                    <button
                                                        className="text-xs px-2 py-1 rounded border border-border hover:bg-white/10"
                                                        onClick={() => {
                                                            setSelected(p);
                                                            saveLastPlayerId(p.id);
                                                        }}
                                                    >
                                                        Edit
                                                    </button>
                                                </div>
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
        </AdminShell>
    );
}
