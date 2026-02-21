import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

/* ── Deterministic card generator (same as server/utils.js) ── */
function mulberry32(seed) {
    seed = seed & 0xFFFFFFFF;
    return function () {
        seed = (seed + 0x6D2B79F5) & 0xFFFFFFFF;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function shuffleArr(arr, seed) {
    const p = mulberry32(seed); const r = arr.slice();
    for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(p() * (i + 1));[r[i], r[j]] = [r[j], r[i]]; }
    return r;
}
const RANGES = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
function buildCard(seed) {
    const cols = RANGES.map(([s, e], idx) => {
        const a = []; for (let n = s; n <= e; n++) a.push(n);
        return shuffleArr(a, seed + idx * 1000).slice(0, 5);
    });
    return Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => (r === 2 && c === 2 ? 'FREE' : cols[c][r])));
}

const LETTER_BG = { B: 'bg-green-bingo', I: 'bg-red-bingo', N: 'bg-yellow-bingo', G: 'bg-blue-bingo', O: 'bg-pink-bingo' };
const LETTERS = ['B', 'I', 'N', 'G', 'O'];

export default function PlayPage() {
    const router = useRouter();
    const { stake: stakeQ, tid: tidQ } = router.query;
    const STAKE = parseInt(stakeQ || '10', 10);
    const TID = tidQ || '';

    const [splashVisible, setSplashVisible] = useState(true);
    const [taken, setTaken] = useState(new Set());
    const [acceptedCount, setAcceptedCount] = useState(0);
    const [totalGames, setTotalGames] = useState('-');
    const [wallet, setWallet] = useState(0);
    const [gift, setGift] = useState(0);
    const [countdown, setCountdown] = useState('-');
    const [showTopbar, setShowTopbar] = useState(false);
    const [modalIndex, setModalIndex] = useState(null);
    const [showInsufficient, setShowInsufficient] = useState(false);

    const countdownTimerRef = useRef(null);
    const pollRef = useRef(null);
    const firstLoad = useRef(true);
    const lastPlayState = useRef({});

    const numbers = Array.from({ length: 200 }, (_, i) => i + 1);

    const refreshState = useCallback(async () => {
        if (!TID) return;
        try {
            const res = await fetch(`/api/game_state?stake=${STAKE}&tid=${encodeURIComponent(TID)}`);
            if (!res.ok) return;
            const data = await res.json();
            lastPlayState.current = data;

            if (firstLoad.current && data.my_index != null && !data.countdown_started_at && !data.started) {
                try {
                    await fetch('/api/abandon', {
                        method: 'POST', body: `tid=${encodeURIComponent(TID)}&stake=${STAKE}`,
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    });
                } catch (_) { }
                firstLoad.current = false;
                return refreshState();
            }
            firstLoad.current = false;

            setTotalGames(data.total_games ?? '-');
            setTaken(new Set((data.taken || []).map(String)));
            setAcceptedCount(data.accepted_count || 0);
            if (typeof data.wallet === 'number') setWallet(data.wallet);
            if (typeof data.gift === 'number') setGift(data.gift);
            setShowTopbar((data.accepted_count || 0) >= 2);

            if (data.countdown_started_at && !countdownTimerRef.current) {
                startCountdown(data.countdown_started_at);
            }
            if (data.started) {
                router.push(`/game?stake=${STAKE}&tid=${encodeURIComponent(TID)}`);
            }

            setSplashVisible(false);
        } catch (_) { }
    }, [STAKE, TID, router]);

    function startCountdown(iso) {
        const start = new Date(iso).getTime();
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = setInterval(() => {
            const rem = Math.max(0, 30 - Math.floor((Date.now() - start) / 1000));
            setCountdown(rem <= 0 ? 'Starting...' : String(rem));
            if (rem <= 0) {
                clearInterval(countdownTimerRef.current);
                countdownTimerRef.current = null;
            }
        }, 500);
    }

    useEffect(() => {
        if (!router.isReady) return;
        refreshState();
        pollRef.current = setInterval(refreshState, 3000);
        return () => { if (pollRef.current) clearInterval(pollRef.current); if (countdownTimerRef.current) clearInterval(countdownTimerRef.current); };
    }, [router.isReady, refreshState]);

    useEffect(() => {
        const handle = () => {
            const s = lastPlayState.current;
            if (s.my_index != null && !s.countdown_started_at && !s.started) {
                const payload = `tid=${encodeURIComponent(TID)}&stake=${STAKE}`;
                navigator.sendBeacon('/api/abandon', new Blob([payload], { type: 'application/x-www-form-urlencoded' }));
            }
        };
        window.addEventListener('beforeunload', handle);
        return () => window.removeEventListener('beforeunload', handle);
    }, [TID, STAKE]);

    async function handleAccept() {
        if (!TID || !modalIndex) return;
        const totalBalance = wallet + gift;
        if (totalBalance < STAKE) {
            setModalIndex(null);
            setShowInsufficient(true);
            return;
        }
        const form = new URLSearchParams();
        form.set('tid', TID); form.set('stake', String(STAKE)); form.set('index', String(modalIndex)); form.set('action', 'accept');
        const res = await fetch('/api/select', { method: 'POST', body: form });
        if (res.ok) {
            const data = await res.json();
            setTaken(new Set((data.taken || []).map(String)));
            setAcceptedCount(data.accepted_count || 0);
            if (data.countdown_started_at) startCountdown(data.countdown_started_at);
            await refreshState();
        } else if (res.status === 409) {
            alert('This card has just been taken by another player.');
            await refreshState();
        }
        setModalIndex(null);
    }

    const derash = Math.max(0, acceptedCount * STAKE * 0.8);
    const cardRows = modalIndex ? buildCard(modalIndex) : null;

    return (
        <>
            <Head><title>luckybet Bingo - Play</title></Head>

            {/* Splash */}
            {splashVisible && (
                <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-bg text-muted font-extrabold text-base transition-opacity duration-300">
                    <div className="flex flex-col items-center gap-3">
                        <div className="flex gap-1.5">
                            {[0, 1, 2].map(i => (
                                <div key={i} className="w-2 h-2 rounded-full bg-purple-glow animate-pulse3" style={{ animationDelay: `${i * 0.15}s` }} />
                            ))}
                        </div>
                        <div>Loading...</div>
                    </div>
                </div>
            )}

            <div className="max-w-[420px] mx-auto p-3">
                <div className="bg-panel border border-border rounded-xl shadow-lg flex flex-col max-h-[600px] overflow-hidden">
                    {/* Topbar */}
                    {showTopbar && (
                        <div className="sticky top-0 z-10 flex justify-center gap-3 px-2 pt-2" style={{ background: 'linear-gradient(180deg,rgba(64,24,92,.8),rgba(64,24,92,0))' }}>
                            <div className="bg-purple-dark text-white border border-white/20 rounded-full px-3.5 py-1.5 font-extrabold inline-flex items-center gap-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]">
                                <span>💸</span><span>Derash {Math.round(derash)} ETB</span>
                            </div>
                            <div className="bg-purple-mid text-white border border-white/20 rounded-full px-3.5 py-1.5 font-extrabold inline-flex items-center gap-2">
                                <span>Starting On {countdown}</span>
                            </div>
                        </div>
                    )}

                    {/* Header pills */}
                    <div className="flex justify-between items-center font-bold mx-auto gap-2 flex-wrap px-3 w-full my-2">
                        {[
                            { label: 'Game', value: totalGames },
                            { label: 'Bet', value: `${STAKE} ETB` },
                            { label: 'Players', value: acceptedCount },
                            { label: 'Wallet', value: `${wallet.toFixed(2)} ETB` },
                            { label: 'Gift', value: `${gift.toFixed(2)} ETB` },
                        ].map(p => (
                            <div key={p.label} className="flex flex-col items-center border border-border text-white px-2.5 py-2 rounded-[10px] text-xs flex-1 text-center bg-purple-bright whitespace-nowrap">
                                <div className="text-[10px] text-muted">{p.label}</div>
                                <div className="font-bold mt-0.5">{p.value}</div>
                            </div>
                        ))}
                    </div>

                    {/* Card number grid */}
                    <div className="grid grid-cols-10 gap-1 p-3 overflow-y-auto flex-grow">
                        {numbers.map(n => (
                            <div key={n}
                                className={`font-bold rounded-lg aspect-square flex items-center justify-center select-none text-sm
                  ${taken.has(String(n))
                                        ? 'bg-gray-500 border-gray-500 text-slate-300 cursor-not-allowed pointer-events-none'
                                        : 'bg-accent text-stone-400 border border-accent-hover cursor-pointer hover:brightness-110 active:scale-95'
                                    }`}
                                onClick={() => !taken.has(String(n)) && setModalIndex(n)}>
                                {n}
                            </div>
                        ))}
                    </div>

                    <div className="p-3.5 border-t border-border flex justify-center">
                        <button className="bg-blue-bingo border border-[#1d6fe6] text-white px-4 py-2.5 rounded-full font-semibold cursor-pointer hover:brightness-110 active:scale-95 transition" onClick={() => location.reload()}>
                            Refresh
                        </button>
                    </div>
                </div>
                <div className="text-muted text-xs text-center mt-3">Copyright © roha Bingo 2025</div>
            </div>

            {/* Card Preview Modal */}
            {modalIndex && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] backdrop-blur-lg">
                    <div className="w-[360px] max-w-[95vw] rounded-2xl shadow-2xl p-3.5" style={{ background: 'linear-gradient(180deg,#f6a623,#d8890b)' }}>
                        <div className="w-9 h-9 rounded-full bg-[#ffcc33] flex items-center justify-center mx-auto mb-2 font-extrabold text-[#7a4b00] border-2 border-[#f0b000]">{modalIndex}</div>
                        <div className="bg-white text-black rounded-xl p-2">
                            <div className="grid grid-cols-5 gap-1.5 mb-1.5">
                                {LETTERS.map(l => <div key={l} className={`${LETTER_BG[l]} text-white font-extrabold text-center py-1.5 rounded-md`}>{l}</div>)}
                            </div>
                            <div className="bg-white rounded-[10px] p-2.5 grid grid-cols-5 gap-2">
                                {cardRows && cardRows.flat().map((val, i) => (
                                    <div key={i} className={`rounded-lg flex items-center justify-center h-11 font-bold border
                    ${val === 'FREE' ? 'bg-card-free border-card-free-border text-white' : 'bg-white border-gray-300 text-black'}`}>
                                        {val === 'FREE' ? '⭐' : val}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="flex gap-2.5 justify-center mt-2.5">
                            <button className="bg-green-bingo border-none text-[#04120a] px-4 py-2.5 rounded-full font-bold cursor-pointer hover:brightness-110 active:scale-95 transition" onClick={handleAccept}>Accept</button>
                            <button className="bg-gray-400 border-none text-gray-900 px-4 py-2.5 rounded-full font-bold cursor-pointer hover:brightness-110 active:scale-95 transition" onClick={() => setModalIndex(null)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Insufficient balance dialog */}
            {showInsufficient && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[9999] backdrop-blur-lg">
                    <div className="w-[360px] max-w-[90vw] bg-white text-gray-900 rounded-xl shadow-2xl p-4">
                        <div className="text-base leading-relaxed mb-3">Your balance is insufficient to complete this transaction.</div>
                        <button className="bg-gold-gradient-to text-white border-none rounded-lg px-3.5 py-2 font-bold cursor-pointer hover:brightness-110 transition" onClick={() => setShowInsufficient(false)}>Close</button>
                    </div>
                </div>
            )}
        </>
    );
}
