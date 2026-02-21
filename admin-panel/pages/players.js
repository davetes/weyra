import { useEffect, useMemo, useState } from 'react';
import RequireAuth from '../components/RequireAuth';
import AdminShell from '../components/AdminShell';
import Card from '../components/Card';
import Modal from '../components/Modal';
import Badge from '../components/Badge';
import Button from '../components/Button';
import { SearchInput } from '../components/FormElements';
import { apiFetch } from '../lib/api';
import { saveToken } from '../lib/auth';
import { IconUsers, IconSearch, IconRefresh, IconBan, IconCheck, IconEye } from '../components/Icons';

function hasPerm(admin, perm) {
    if (admin?.role === 'super_admin') return true;
    const perms = Array.isArray(admin?.permissions) ? admin.permissions : [];
    return perms.includes(perm);
}

function formatDate(v) {
    if (!v) return '-';
    try {
        return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (_) {
        return '-';
    }
}

function formatMoney(v) {
    if (v == null) return '-';
    const n = Number(v);
    if (Number.isNaN(n)) return String(v);
    return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function saveLastPlayerId(id) {
    try {
        window.localStorage.setItem('admin_last_player_id', String(id));
    } catch (_) {}
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
            setSelected(null);
        } catch (err) {
            setActionError(err?.message || 'Failed');
        }
    }

    async function unban(p) {
        setActionError('');
        try {
            await apiFetch(`/api/admin/players/${p.id}/unban`, { token, method: 'PATCH' });
            await load();
            setSelected(null);
        } catch (err) {
            setActionError(err?.message || 'Failed');
        }
    }

    function handleSearch(e) {
        e.preventDefault();
        load();
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
            <div className="space-y-5">
                {/* Player Detail Modal */}
                <Modal open={!!selected} onClose={() => setSelected(null)} title={`Player #${selected?.id}`}>
                    {selected && (
                        <>
                            <div className="grid grid-cols-2 gap-3">
                                {[
                                    { label: 'Telegram ID', value: selected.telegramId || '-' },
                                    { label: 'Username', value: selected.username || '-' },
                                    { label: 'Phone', value: selected.phone || '-' },
                                    { label: 'Created', value: formatDate(selected.createdAt) },
                                    { label: 'Wallet', value: `${formatMoney(selected.wallet)} ETB` },
                                    { label: 'Gift', value: `${formatMoney(selected.gift)} ETB` },
                                    { label: 'Wins', value: selected.wins ?? 0 },
                                    {
                                        label: 'Status',
                                        value: selected.bannedAt ? (
                                            <div>
                                                <Badge variant="danger" dot>Banned</Badge>
                                                {selected.banReason && (
                                                    <div className="text-xs text-muted mt-1">Reason: {selected.banReason}</div>
                                                )}
                                            </div>
                                        ) : (
                                            <Badge variant="success" dot>Active</Badge>
                                        ),
                                    },
                                ].map((item, i) => (
                                    <div key={i} className="bg-bg-secondary border border-border rounded-xl p-3.5">
                                        <div className="text-[10px] font-medium text-muted uppercase tracking-wider">{item.label}</div>
                                        <div className="mt-1.5 text-sm text-slate-200 break-all">{item.value}</div>
                                    </div>
                                ))}
                            </div>

                            {actionError && (
                                <div className="bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger mt-4">
                                    {actionError}
                                </div>
                            )}

                            <div className="mt-5 flex items-center justify-end gap-2">
                                {!canModerate ? (
                                    <span className="text-xs text-muted">No moderation access</span>
                                ) : selected.bannedAt ? (
                                    <Button variant="success" size="sm" icon={IconCheck} loading={loading} onClick={() => unban(selected)}>
                                        Unban Player
                                    </Button>
                                ) : (
                                    <Button variant="danger" size="sm" icon={IconBan} loading={loading} onClick={() => ban(selected)}>
                                        Ban Player
                                    </Button>
                                )}
                            </div>
                        </>
                    )}
                </Modal>

                {/* Search */}
                <Card title="Search Players" icon={IconSearch}>
                    <form onSubmit={handleSearch} className="flex gap-3">
                        <div className="flex-1">
                            <SearchInput
                                placeholder="Search by username, phone, or Telegram ID..."
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                            />
                        </div>
                        <Button variant="primary" type="submit" icon={IconSearch} loading={loading}>
                            Search
                        </Button>
                        <Button variant="outline" icon={IconRefresh} onClick={load} loading={loading}>
                            Refresh
                        </Button>
                    </form>
                    {error && (
                        <div className="bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger mt-3">
                            {error}
                        </div>
                    )}
                </Card>

                {/* Players Table */}
                {!canRead ? (
                    <Card title="No access">
                        <div className="text-sm text-muted">You do not have permission to view players.</div>
                    </Card>
                ) : (
                    <Card title={`Players (${players.length})`} icon={IconUsers} noPadding>
                        <div className="overflow-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-xs font-medium text-muted uppercase tracking-wider border-b border-border">
                                        <th className="px-5 py-3">ID</th>
                                        <th className="pr-3 py-3">Username</th>
                                        <th className="pr-3 py-3">Phone</th>
                                        <th className="pr-3 py-3">Wallet</th>
                                        <th className="pr-3 py-3">Gift</th>
                                        <th className="pr-3 py-3">Wins</th>
                                        <th className="pr-3 py-3">Status</th>
                                        <th className="pr-3 py-3">Joined</th>
                                        <th className="pr-5 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {players.map((p) => {
                                        const banned = !!p.bannedAt;
                                        return (
                                            <tr key={p.id} className="border-b border-border/40 transition-colors">
                                                <td className="px-5 py-3 text-muted font-mono text-xs">{p.id}</td>
                                                <td className="pr-3 py-3 font-medium text-slate-200">{p.username || '-'}</td>
                                                <td className="pr-3 py-3 text-slate-400 font-mono text-xs">{p.phone || '-'}</td>
                                                <td className="pr-3 py-3 text-slate-300">{formatMoney(p.wallet)}</td>
                                                <td className="pr-3 py-3 text-slate-300">{formatMoney(p.gift)}</td>
                                                <td className="pr-3 py-3 text-slate-300">{p.wins ?? 0}</td>
                                                <td className="pr-3 py-3">
                                                    {banned ? (
                                                        <Badge variant="danger" dot>Banned</Badge>
                                                    ) : (
                                                        <Badge variant="success" dot>Active</Badge>
                                                    )}
                                                </td>
                                                <td className="pr-3 py-3 text-muted text-xs">{formatDate(p.createdAt)}</td>
                                                <td className="pr-5 py-3">
                                                    <div className="flex justify-end">
                                                        <Button
                                                            variant="ghost"
                                                            size="xs"
                                                            icon={IconEye}
                                                            onClick={() => {
                                                                setSelected(p);
                                                                saveLastPlayerId(p.id);
                                                            }}
                                                        >
                                                            View
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {players.length === 0 && !loading && (
                                        <tr>
                                            <td colSpan={9} className="text-center py-12 text-muted text-sm">No players found</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </Card>
                )}
            </div>
        </AdminShell>
    );
}
