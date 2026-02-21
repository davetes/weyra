import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function Home() {
    const router = useRouter();
    useEffect(() => {
        router.replace('/play?stake=10');
    }, []);
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
            <p>Redirecting...</p>
        </div>
    );
}
