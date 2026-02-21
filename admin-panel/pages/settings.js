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

export default function SettingsPage() {
    return (
        <RequireAuth>
            {({ token, admin }) => <SettingsInner token={token} admin={admin} />}
        </RequireAuth>
    );
}

function SettingsInner({ token, admin }) {
    const canRead = useMemo(() => hasPerm(admin, 'settings.read'), [admin]);
    const canEdit = useMemo(() => hasPerm(admin, 'settings.write'), [admin]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [settings, setSettings] = useState([]);

    async function load() {
        setLoading(true);
        setError('');
        try {
            const res = await apiFetch('/api/admin/settings', { token });
            setSettings(res.settings || []);
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
        if (canRead) load();
    }, []);

    async function save() {
        setLoading(true);
        setError('');
        try {
            const payload = settings.map((s) => ({ key: s.key, value: s.value }));
            const res = await apiFetch('/api/admin/settings', { token, method: 'PUT', body: { settings: payload } });
            setSettings(res.settings || []);
        } catch (err) {
            setError(err?.message || 'Failed to save');
        } finally {
            setLoading(false);
        }
    }

    return (
        <AdminShell
            admin={admin}
            title="Settings"
            onLogout={() => {
                saveToken(null);
                window.location.href = '/login';
            }}
        >
            <div className="space-y-4">
                {!canRead ? (
                    <Card title="No access">
                        <div className="text-sm text-slate-300">You do not have permission to view settings.</div>
                    </Card>
                ) : null}

                {canRead ? (
                    <Card
                        title="App Settings"
                        right={
                            <div className="flex gap-2">
                                <button
                                    className="text-sm px-3 py-2 rounded-lg border border-border hover:bg-white/10 disabled:opacity-60"
                                    disabled={loading || !canEdit}
                                    onClick={() => setSettings((prev) => [...prev, { key: `setting_${prev.length + 1}`, value: '' }])}
                                >
                                    Add
                                </button>
                                <button
                                    className="text-sm px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white disabled:opacity-60"
                                    disabled={loading || !canEdit}
                                    onClick={save}
                                >
                                    Save
                                </button>
                            </div>
                        }
                    >
                        {error ? <div className="text-sm text-red-300 mb-3">{error}</div> : null}
                        <div className="space-y-2">
                            {settings.map((s, i) => (
                                <div key={i} className="grid md:grid-cols-2 gap-2">
                                    <input
                                        className="bg-transparent border border-border rounded-lg px-3 py-2 text-sm"
                                        value={s.key}
                                        disabled={!canEdit}
                                        onChange={(e) => {
                                            const next = [...settings];
                                            next[i] = { ...next[i], key: e.target.value };
                                            setSettings(next);
                                        }}
                                    />
                                    <input
                                        className="bg-transparent border border-border rounded-lg px-3 py-2 text-sm"
                                        value={s.value}
                                        disabled={!canEdit}
                                        onChange={(e) => {
                                            const next = [...settings];
                                            next[i] = { ...next[i], value: e.target.value };
                                            setSettings(next);
                                        }}
                                    />
                                </div>
                            ))}
                        </div>
                    </Card>
                ) : null}
            </div>
        </AdminShell>
    );
}
