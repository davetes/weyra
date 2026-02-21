import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { fetchMe, loadToken, saveToken } from '../lib/auth';

export default function RequireAuth({ children }) {
    const router = useRouter();
    const [state, setState] = useState({ loading: true, token: null, admin: null, error: null });

    useEffect(() => {
        let mounted = true;
        async function run() {
            const token = loadToken();
            if (!token) {
                router.replace('/login');
                return;
            }
            try {
                const me = await fetchMe(token);
                if (!mounted) return;
                setState({ loading: false, token, admin: me.admin, error: null });
            } catch (err) {
                saveToken(null);
                if (!mounted) return;
                setState({ loading: false, token: null, admin: null, error: err?.message || 'Unauthorized' });
                router.replace('/login');
            }
        }
        run();
        return () => {
            mounted = false;
        };
    }, [router]);

    if (state.loading) {
        return (
            <div className="min-h-screen bg-bg text-slate-100 flex items-center justify-center">
                <div className="text-sm text-slate-400">Loading...</div>
            </div>
        );
    }

    return children({ token: state.token, admin: state.admin });
}
