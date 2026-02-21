import { useEffect, useMemo, useState } from 'react';
import RequireAuth from '../components/RequireAuth';
import AdminShell from '../components/AdminShell';
import Card from '../components/Card';
import { apiFetch } from '../lib/api';
import { saveToken } from '../lib/auth';

const PERMS = [
    { id: 'players.read', label: 'View players' },
    { id: 'players.ban', label: 'Ban / Unban players' },
    { id: 'deposit.read', label: 'View deposit requests' },
    { id: 'deposit.decide', label: 'Approve / Reject deposit requests' },
    { id: 'withdraw.read', label: 'View withdraw requests' },
    { id: 'withdraw.decide', label: 'Approve / Reject withdraw requests' },
    { id: 'settings.read', label: 'View settings' },
    { id: 'settings.write', label: 'Edit settings' },
];

export default function AdminsPage() {
    return (
        <RequireAuth>
            {({ token, admin }) => <AdminsInner token={token} admin={admin} />}
        </RequireAuth>
    );
}

function AdminsInner({ token, admin }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [admins, setAdmins] = useState([]);

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('admin');
    const [permissions, setPermissions] = useState(['players.read']);

    const [editing, setEditing] = useState(null);
    const [editPerms, setEditPerms] = useState([]);

    const canManageAdmins = useMemo(() => admin?.role === 'super_admin', [admin]);

    async function load() {
        setLoading(true);
        setError('');
        try {
            const res = await apiFetch('/api/admin/admins', { token });
            setAdmins(res.admins || []);
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

    async function savePermissions() {
        if (!editing) return;
        setLoading(true);
        setError('');
        try {
            await apiFetch(`/api/admin/admins/${editing.id}`, { token, method: 'PATCH', body: { permissions: editPerms } });
            setEditing(null);
            setEditPerms([]);
            await load();
        } catch (err) {
            setError(err?.message || 'Failed to update permissions');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        load();
    }, []);

    async function createAdmin() {
        setLoading(true);
        setError('');
        try {
            await apiFetch('/api/admin/admins', { token, method: 'POST', body: { username, password, role, permissions } });
            setUsername('');
            setPassword('');
            setRole('admin');
            setPermissions(['players.read']);
            await load();
        } catch (err) {
            setError(err?.message || 'Failed to create');
        } finally {
            setLoading(false);
        }
    }

    async function removeAdmin(a) {
        if (!window.confirm(`Delete admin '${a.username}'?`)) return;
        setLoading(true);
        setError('');
        try {
            await apiFetch(`/api/admin/admins/${a.id}`, { token, method: 'DELETE' });
            await load();
        } catch (err) {
            setError(err?.message || 'Failed to delete');
        } finally {
            setLoading(false);
        }
    }

    return (
        <AdminShell
            admin={admin}
            title="Admins"
            onLogout={() => {
                saveToken(null);
                window.location.href = '/login';
            }}
        >
            <div className="space-y-4">
                {editing ? (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                        <div className="w-full max-w-xl bg-panel border border-border rounded-2xl p-5">
                            <div className="flex items-center justify-between">
                                <div className="font-semibold">Edit permissions: {editing.username}</div>
                                <button
                                    className="text-xs px-2 py-1 rounded border border-border hover:bg-white/10"
                                    onClick={() => {
                                        setEditing(null);
                                        setEditPerms([]);
                                    }}
                                >
                                    Close
                                </button>
                            </div>

                            <div className="mt-4 grid md:grid-cols-2 gap-2">
                                {PERMS.map((p) => (
                                    <label key={p.id} className="flex items-center gap-2 text-sm text-slate-300">
                                        <input
                                            type="checkbox"
                                            checked={editPerms.includes(p.id)}
                                            onChange={(e) => {
                                                const checked = e.target.checked;
                                                setEditPerms((prev) => {
                                                    if (checked) return [...new Set([...prev, p.id])];
                                                    return prev.filter((x) => x !== p.id);
                                                });
                                            }}
                                        />
                                        {p.label}
                                    </label>
                                ))}
                            </div>

                            <div className="mt-5 flex justify-end gap-2">
                                <button
                                    className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-white/10 disabled:opacity-60"
                                    disabled={loading}
                                    onClick={() => {
                                        setEditing(null);
                                        setEditPerms([]);
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="text-sm px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white disabled:opacity-60"
                                    disabled={loading}
                                    onClick={savePermissions}
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}

                {!canManageAdmins ? (
                    <Card title="No access">
                        <div className="text-sm text-slate-300">Only Super Admin can manage admin accounts.</div>
                    </Card>
                ) : (
                    <Card
                        title="Create Admin"
                        right={
                            <button
                                className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-white/10 disabled:opacity-60"
                                disabled={loading}
                                onClick={createAdmin}
                            >
                                Create
                            </button>
                        }
                    >
                        <div className="grid md:grid-cols-3 gap-2">
                            <input
                                className="bg-transparent border border-border rounded-lg px-3 py-2 text-sm"
                                placeholder="Username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                            />
                            <input
                                className="bg-transparent border border-border rounded-lg px-3 py-2 text-sm"
                                placeholder="Password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                            <select
                                className="bg-transparent border border-border rounded-lg px-3 py-2 text-sm"
                                value={role}
                                onChange={(e) => setRole(e.target.value)}
                            >
                                <option value="admin">Admin</option>
                                <option value="entertainer">Entertainer</option>
                            </select>
                        </div>

                        <div className="mt-3 grid md:grid-cols-2 gap-2">
                            {PERMS.map((p) => (
                                <label key={p.id} className="flex items-center gap-2 text-sm text-slate-300">
                                    <input
                                        type="checkbox"
                                        checked={permissions.includes(p.id)}
                                        onChange={(e) => {
                                            const checked = e.target.checked;
                                            setPermissions((prev) => {
                                                if (checked) return [...new Set([...prev, p.id])];
                                                return prev.filter((x) => x !== p.id);
                                            });
                                        }}
                                    />
                                    {p.label}
                                </label>
                            ))}
                        </div>
                        {error ? <div className="text-sm text-red-300 mt-3">{error}</div> : null}
                    </Card>
                )}

                <Card
                    title={`Admins (${admins.length})`}
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
                    {error ? <div className="text-sm text-red-300 mb-3">{error}</div> : null}
                    <div className="overflow-auto">
                        <table className="w-full text-sm">
                            <thead className="text-left text-slate-400">
                                <tr className="border-b border-border">
                                    <th className="py-2 pr-3">ID</th>
                                    <th className="pr-3">Username</th>
                                    <th className="pr-3">Role</th>
                                    <th className="pr-3">Permissions</th>
                                    <th className="pr-3">Created</th>
                                    <th className="text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {admins.map((a) => (
                                    <tr key={a.id} className="border-b border-border/60">
                                        <td className="py-2 pr-3 text-slate-300">{a.id}</td>
                                        <td className="pr-3">{a.username}</td>
                                        <td className="pr-3 text-slate-300">{a.role}</td>
                                        <td className="pr-3 text-slate-400">{Array.isArray(a.permissions) ? a.permissions.join(', ') : ''}</td>
                                        <td className="pr-3 text-slate-400">{String(a.createdAt).slice(0, 10)}</td>
                                        <td className="py-2">
                                            <div className="flex justify-end gap-2">
                                                {admin?.role === 'super_admin' && a.role !== 'super_admin' ? (
                                                    <>
                                                        <button
                                                            className="text-xs px-2 py-1 rounded border border-border hover:bg-white/10"
                                                            onClick={() => {
                                                                setEditing(a);
                                                                setEditPerms(Array.isArray(a.permissions) ? a.permissions : []);
                                                            }}
                                                        >
                                                            Edit
                                                        </button>
                                                        <button
                                                            className="text-xs px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white"
                                                            onClick={() => removeAdmin(a)}
                                                        >
                                                            Delete
                                                        </button>
                                                    </>
                                                ) : (
                                                    <span className="text-xs text-slate-500">-</span>
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
        </AdminShell>
    );
}
