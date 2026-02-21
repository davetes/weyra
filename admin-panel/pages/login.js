import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Card from '../components/Card';
import { bootstrapSuperAdmin, login, loadToken, saveToken, fetchMe } from '../lib/auth';

export default function LoginPage() {
    const router = useRouter();
    const [mode, setMode] = useState('login');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const [bootstrapToken, setBootstrapToken] = useState('');

    useEffect(() => {
        async function redirectIfAuthed() {
            const token = loadToken();
            if (!token) return;
            try {
                await fetchMe(token);
                router.replace('/app');
            } catch (_) {
                saveToken(null);
            }
        }
        redirectIfAuthed();
    }, [router]);

    async function onLogin() {
        setLoading(true);
        setError('');
        try {
            const res = await login(username, password);
            saveToken(res.token);
            router.replace('/app');
        } catch (err) {
            setError(err?.message || 'Login failed');
        } finally {
            setLoading(false);
        }
    }

    async function onBootstrap() {
        setLoading(true);
        setError('');
        try {
            await bootstrapSuperAdmin(bootstrapToken, username, password);
            const res = await login(username, password);
            saveToken(res.token);
            router.replace('/app');
        } catch (err) {
            setError(err?.message || 'Bootstrap failed');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="min-h-screen bg-bg text-slate-100 flex items-center justify-center p-6">
            <div className="w-full max-w-lg space-y-4">
                <div className="text-center">
                    <div className="text-2xl font-extrabold">Admin Panel</div>
                    <div className="text-sm text-slate-400 mt-1">Login to manage players and admins</div>
                </div>

                <Card
                    title={mode === 'login' ? 'Login' : 'Bootstrap Super Admin'}
                    right={
                        <button
                            className="text-xs px-2 py-1 rounded border border-border hover:bg-white/10"
                            onClick={() => {
                                setError('');
                                setMode(mode === 'login' ? 'bootstrap' : 'login');
                            }}
                        >
                            {mode === 'login' ? 'Bootstrap' : 'Back to login'}
                        </button>
                    }
                >
                    <div className="space-y-3">
                        {mode === 'bootstrap' && (
                            <input
                                className="w-full bg-transparent border border-border rounded-lg px-3 py-2 text-sm"
                                placeholder="Bootstrap token"
                                value={bootstrapToken}
                                onChange={(e) => setBootstrapToken(e.target.value)}
                            />
                        )}

                        <input
                            className="w-full bg-transparent border border-border rounded-lg px-3 py-2 text-sm"
                            placeholder="Username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                        <input
                            className="w-full bg-transparent border border-border rounded-lg px-3 py-2 text-sm"
                            placeholder="Password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />

                        {error ? <div className="text-sm text-red-300">{error}</div> : null}

                        <button
                            className="w-full bg-accent hover:bg-accent-hover transition text-white rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-60"
                            disabled={loading}
                            onClick={mode === 'login' ? onLogin : onBootstrap}
                        >
                            {loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Create Super Admin'}
                        </button>

                        <div className="text-xs text-slate-400">
                            API Base: <span className="text-slate-300">/api</span> (proxied by Next rewrites)
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}
