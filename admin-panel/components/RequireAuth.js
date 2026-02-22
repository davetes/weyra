import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { fetchMe, loadToken, saveToken } from '../lib/auth';

export default function RequireAuth({ children }) {
    const router = useRouter();
    const [state, setState] = useState({ loading: true, token: null, admin: null });

    useEffect(() => {
        let active = true;

        async function init() {
            const token = loadToken();
            if (!token) {
                router.replace('/login');
                return;
            }

            try {
                const res = await fetchMe(token);
                if (!active) return;
                setState({ loading: false, token, admin: res ? .admin || null });
            } catch (_) {
                saveToken(null);
                if (active) setState({ loading: false, token: null, admin: null });
                router.replace('/login');
            }
        }

        init();
        return () => {
            active = false;
        };
    }, [router]);

    if (state.loading) {
        return ( <
            div className = "min-h-screen bg-bg text-slate-100 flex items-center justify-center p-6" >
            <
            div className = "text-sm text-muted" > Checking session... < /div> <
            /div>
        );
    }

    if (!state.token || !state.admin) {
        return null;
    }

    return typeof children === 'function' ?
        children({ token: state.token, admin: state.admin }) :
        children;
}