import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { bootstrapSuperAdmin, login, loadToken, saveToken, fetchMe } from '../lib/auth';
import Button from '../components/Button';
import { Input } from '../components/FormElements';
import { IconShield } from '../components/Icons';

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
            setError(err ? .message || 'Login failed');
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
            setError(err ? .message || 'Bootstrap failed');
        } finally {
            setLoading(false);
        }
    }

    function handleSubmit(e) {
        e.preventDefault();
        if (mode === 'login') onLogin();
        else onBootstrap();
    }

    return ( <
        div className = "min-h-screen bg-bg text-slate-100 flex items-center justify-center p-6" > { /* Background decoration */ } <
        div className = "fixed inset-0 overflow-hidden pointer-events-none" >
        <
        div className = "absolute top-1/4 left-1/4 w-96 h-96 bg-accent/5 rounded-full blur-3xl" / >
        <
        div className = "absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent-hover/5 rounded-full blur-3xl" / >
        <
        /div>

        <
        div className = "relative w-full max-w-md animate-slide-up" > { /* Logo */ } <
        div className = "text-center mb-8" >
        <
        div className = "inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-accent to-accent-hover shadow-glow-lg mb-4" >
        <
        span className = "text-2xl font-extrabold text-white" > W < /span> <
        /div> <
        h1 className = "text-2xl font-bold tracking-tight" > Weyra Bingo < /h1> <
        p className = "text-sm text-muted mt-1" > Admin Control Panel < /p> <
        /div>

        { /* Card */ } <
        div className = "bg-panel border border-border rounded-2xl shadow-card overflow-hidden" > { /* Tabs */ } <
        div className = "flex border-b border-border" >
        <
        button type = "button"
        className = { `flex-1 px-4 py-3.5 text-sm font-medium transition-colors ${
                                mode === 'login'
                                    ? 'text-accent-light border-b-2 border-accent bg-accent/5'
                                    : 'text-muted hover:text-slate-300'
                            }` }
        onClick = {
            () => { setError('');
                setMode('login'); } } >
        Sign In <
        /button> <
        button type = "button"
        className = { `flex-1 px-4 py-3.5 text-sm font-medium transition-colors ${
                                mode === 'bootstrap'
                                    ? 'text-accent-light border-b-2 border-accent bg-accent/5'
                                    : 'text-muted hover:text-slate-300'
                            }` }
        onClick = {
            () => { setError('');
                setMode('bootstrap'); } } >
        <
        span className = "flex items-center justify-center gap-1.5" >
        <
        IconShield size = { 14 }
        />
        Bootstrap <
        /span> <
        /button> <
        /div>

        { /* Form */ } <
        form onSubmit = { handleSubmit }
        className = "p-6 space-y-4" > {
            mode === 'bootstrap' && ( <
                div >
                <
                label className = "block text-xs font-medium text-muted mb-1.5 uppercase tracking-wider" >
                Bootstrap Token <
                /label> <
                Input placeholder = "Enter bootstrap token"
                value = { bootstrapToken }
                onChange = {
                    (e) => setBootstrapToken(e.target.value) }
                /> <
                /div>
            )
        }

        <
        div >
        <
        label className = "block text-xs font-medium text-muted mb-1.5 uppercase tracking-wider" >
        Username <
        /label> <
        Input placeholder = "Enter your username"
        value = { username }
        onChange = {
            (e) => setUsername(e.target.value) }
        autoComplete = "username" /
        >
        <
        /div>

        <
        div >
        <
        label className = "block text-xs font-medium text-muted mb-1.5 uppercase tracking-wider" >
        Password <
        /label> <
        Input type = "password"
        placeholder = "Enter your password"
        value = { password }
        onChange = {
            (e) => setPassword(e.target.value) }
        autoComplete = "current-password" /
        >
        <
        /div>

        {
            error && ( <
                div className = "bg-danger-muted border border-danger/20 rounded-xl px-4 py-3 text-sm text-danger animate-fade-in" > { error } <
                /div>
            )
        }

        <
        Button variant = "primary"
        className = "w-full !py-3"
        loading = { loading }
        type = "submit" >
        { mode === 'login' ? 'Sign In' : 'Create Super Admin' } <
        /Button> <
        /form> <
        /div>

        { /* Footer */ } <
        div className = "text-center mt-6 text-xs text-muted" >
        Secure admin access• API proxied through Next.js <
        /div> <
        /div> <
        /div>
    );
}