import RequireAuth from '../components/RequireAuth';
import AdminShell from '../components/AdminShell';
import Card from '../components/Card';
import { saveToken } from '../lib/auth';
import { decideDepositRequest, listDepositRequests } from '../lib/requests';
import { useEffect, useMemo, useState } from 'react';

function hasPerm(admin, perm) {
    if (admin?.role === 'super_admin') return true;
    const perms = Array.isArray(admin?.permissions) ? admin.permissions : [];
    return perms.includes(perm);
}

function formatDate(v) {
    if (!v) return '-';
    try {
        return String(v).slice(0, 19).replace('T', ' ');
    } catch (_) {
        return '-';
    }
}

function promptAmount() {
    const raw = window.prompt('Deposit amount (ETB):', '');
    if (raw == null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

export default function DepositRequestsPage() {
    return (
        <RequireAuth>
            {({ token, admin }) => (
                <AdminShell
                    admin={admin}
                    title="Deposit Requests"
                    onLogout={() => {
                        saveToken(null);
                        window.location.href = '/login';
                    }}
                >
                    <DepositInner token={token} admin={admin} />
                </AdminShell>
            )}
        </RequireAuth>
    );
}

function DepositInner({ token, admin }) {
    const canRead = useMemo(() => hasPerm(admin, 'deposit.read'), [admin]);
    const canDecide = useMemo(() => hasPerm(admin, 'deposit.decide'), [admin]);
    const [status, setStatus] = useState('pending');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [rows, setRows] = useState([]);

    async function load() {
        if (!canRead) return;
        setLoading(true);
        setError('');
        try {
            const res = await listDepositRequests(token, { status });
            setRows(res.requests || []);
        } catch (err) {
            if (err?.status === 401) {
                saveToken(null);
                window.location.href = '/login';
                return;
            }
            setError(err?.message || 'Failed');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, [status]);

    async function decide(id, decision) {
        let amount = undefined;
        if (decision === 'approved') {
            amount = promptAmount();
            if (amount == null) {
                setError('Approval requires a valid deposit amount.');
                return;
            }
        }
        const note = window.prompt('Note (optional):', '') || '';
        setLoading(true);
        setError('');
        try {
            await decideDepositRequest(token, id, { decision, note, amount });
            await load();
        } catch (err) {
            setError(err?.message || 'Failed');
        } finally {
            setLoading(false);
        }
    }

    if (!canRead) {
        return (
            <Card title="No access">
                <div className="text-sm text-slate-300">You do not have permission to view deposit requests.</div>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            <Card
                title="Filters"
                right={
                    <button
                        className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-white/10 disabled:opacity-60"
                        disabled={loading}
                        onClick={load}
                    >
                        Refresh
                    </button>
                }
            >
                <div className="flex gap-2">
                    <select
                        className="bg-transparent border border-border rounded-lg px-3 py-2 text-sm"
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                    >
                        <option value="pending">Pending</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                    </select>
                    <div className="text-xs text-slate-400 self-center">Showing latest 500</div>
                </div>
                {error ? <div className="text-sm text-red-300 mt-3">{error}</div> : null}
            </Card>

            <Card title={`Deposit Requests (${rows.length})`}>
                <div className="overflow-auto">
                    <table className="w-full text-sm">
                        <thead className="text-left text-slate-400">
                            <tr className="border-b border-border">
                                <th className="py-2 pr-3">ID</th>
                                <th className="pr-3">User</th>
                                <th className="pr-3">Wallet</th>
                                <th className="pr-3">Telegram ID</th>
                                <th className="pr-3">Method</th>
                                <th className="pr-3">Caption</th>
                                <th className="pr-3">Decision</th>
                                <th className="pr-3">Status</th>
                                <th className="pr-3">Created</th>
                                <th className="text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id} className="border-b border-border/60">
                                    <td className="py-2 pr-3 text-slate-300">{r.id}</td>
                                    <td className="pr-3">{r.player?.username || r.player?.phone || '-'}</td>
                                    <td className="pr-3 text-slate-300">{r.player?.wallet != null ? String(r.player.wallet) : '-'}</td>
                                    <td className="pr-3 text-slate-300">{r.telegramId || '-'}</td>
                                    <td className="pr-3 text-slate-300">{r.method || '-'}</td>
                                    <td className="pr-3 text-slate-400">{(r.caption || '').slice(0, 80)}</td>
                                    <td className="pr-3 text-slate-400">{r.decisionNote ? String(r.decisionNote).slice(0, 60) : '-'}</td>
                                    <td className="pr-3 text-slate-300">{r.status}</td>
                                    <td className="pr-3 text-slate-400">{formatDate(r.createdAt)}</td>
                                    <td className="py-2">
                                        <div className="flex justify-end gap-2">
                                            {!canDecide || r.status !== 'pending' ? (
                                                <span className="text-xs text-slate-500">-</span>
                                            ) : (
                                                <>
                                                    <button
                                                        className="text-xs px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60"
                                                        disabled={loading}
                                                        onClick={() => decide(r.id, 'approved')}
                                                    >
                                                        Approve
                                                    </button>
                                                    <button
                                                        className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-60"
                                                        disabled={loading}
                                                        onClick={() => decide(r.id, 'rejected')}
                                                    >
                                                        Reject
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}
