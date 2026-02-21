import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { io } from 'socket.io-client';

/* ── Deterministic card (same as play.js / server) ── */
function mulberry32(seed) {
    seed = seed & 0xFFFFFFFF;
    return function () { seed = (seed + 0x6D2B79F5) & 0xFFFFFFFF; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffleArr(arr, seed) { const p = mulberry32(seed); const r = arr.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(p() * (i + 1));[r[i], r[j]] = [r[j], r[i]]; } return r; }
const RANGES_DEF = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
function buildCard(seed) { const cols = RANGES_DEF.map(([s, e], idx) => { const a = []; for (let n = s; n <= e; n++) a.push(n); return shuffleArr(a, seed + idx * 1000).slice(0, 5); }); return Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => (r === 2 && c === 2 ? 'FREE' : cols[c][r]))); }
function letterFor(n) { n = Number(n); if (n >= 1 && n <= 15) return 'B'; if (n <= 30) return 'I'; if (n <= 45) return 'N'; if (n <= 60) return 'G'; return 'O'; }

const LETTER_BG = { B: 'bg-green-bingo', I: 'bg-red-bingo', N: 'bg-yellow-bingo', G: 'bg-blue-bingo', O: 'bg-pink-bingo' };
const LETTER_RING = { B: '#2ecc71', I: '#e74c3c', N: '#f39c12', G: '#2d89ff', O: '#d81b60' };
const LETTERS = ['B', 'I', 'N', 'G', 'O'];

export default function GamePage() {
    const router = useRouter();
    const { stake: stakeQ, tid: tidQ } = router.query;
    const STAKE = parseInt(stakeQ || '10', 10);
    const TID = tidQ || '';

    const [players, setPlayers] = useState(0);
    const [callCount, setCallCount] = useState('-');
    const [totalGames, setTotalGames] = useState('-');
    const [currentCall, setCurrentCall] = useState(null);
    const [recentCalls, setRecentCalls] = useState([]);
    const [calledSet, setCalledSet] = useState(new Set());
    const [myCard, setMyCard] = useState(null);
    const [myIndex, setMyIndex] = useState(null);
    const [picks, setPicks] = useState(new Set());
    const [winner, setWinner] = useState(null);
    const [audioOn, setAudioOn] = useState(false);
    const [autoPickOn, setAutoPickOn] = useState(false);
    const [suppressCalls, setSuppressCalls] = useState(false);

    const socketRef = useRef(null);
    const audioRef = useRef(null);
    const audioPlayingRef = useRef(false);
    const lastAudioCallRef = useRef(null);
    const winCountdownRef = useRef(null);

    const derash = Math.max(0, players * STAKE * 0.8);

    useEffect(() => {
        if (myIndex == null) return;
        try {
            const raw = localStorage.getItem(`bingo_picks_${STAKE}_${myIndex}`);
            if (raw) setPicks(new Set(JSON.parse(raw).map(String)));
        } catch (_) { }
    }, [myIndex, STAKE]);

    function savePicks(newPicks) {
        try { localStorage.setItem(`bingo_picks_${STAKE}_${myIndex}`, JSON.stringify([...newPicks])); } catch (_) { }
    }

    function togglePick(val) {
        setPicks(prev => {
            const ns = new Set(prev);
            if (ns.has(val)) ns.delete(val); else ns.add(val);
            savePicks(ns);
            return ns;
        });
    }

    function autoPick(n) {
        if (!autoPickOn || n == null) return;
        const val = String(n);
        setPicks(prev => {
            if (!myCard) return prev;
            const flat = myCard.flat().map(String);
            if (!flat.includes(val)) return prev;
            if (prev.has(val)) return prev;
            const ns = new Set(prev);
            ns.add(val);
            savePicks(ns);
            return ns;
        });
    }

    function playNumber(num) {
        if (suppressCalls || !audioOn || audioPlayingRef.current) return;
        num = Number(num);
        if (!Number.isFinite(num) || num < 1 || num > 75) return;
        if (!audioRef.current) return;
        audioPlayingRef.current = true;
        lastAudioCallRef.current = String(num);
        audioRef.current.src = `/static/audio/${num}.mp3`;
        audioRef.current.currentTime = 0;
        audioRef.current.onended = () => { audioPlayingRef.current = false; };
        audioRef.current.onerror = () => { audioPlayingRef.current = false; };
        audioRef.current.play().catch(() => { audioPlayingRef.current = false; });
    }

    const refresh = useCallback(async () => {
        if (!TID) return;
        try {
            const res = await fetch(`/api/game_state?stake=${STAKE}&tid=${encodeURIComponent(TID)}`);
            if (!res.ok) return;
            const data = await res.json();

            setPlayers(data.players ?? 0);
            setTotalGames(data.total_games ?? '-');
            setCallCount(data.call_count ?? 0);

            if (data.current_call != null && String(data.current_call) !== lastAudioCallRef.current) {
                playNumber(data.current_call);
            }
            setCurrentCall(data.current_call);

            if (Array.isArray(data.called_numbers) && data.current_call != null) {
                const idx = data.called_numbers.indexOf(data.current_call);
                if (idx >= 0) setRecentCalls(data.called_numbers.slice(Math.max(0, idx - 4), idx).reverse());
            }

            const called = new Set((data.called_numbers || []).map(String));
            if (data.current_call != null) called.add(String(data.current_call));
            setCalledSet(called);

            if (data.my_card) setMyCard(data.my_card);
            if (data.my_index != null) setMyIndex(data.my_index);
            if (autoPickOn && data.current_call != null) autoPick(data.current_call);
        } catch (_) { }
    }, [STAKE, TID, autoPickOn, suppressCalls, audioOn]);

    useEffect(() => {
        if (!router.isReady) return;
        refresh();
        const iv = setInterval(refresh, 2000);
        return () => clearInterval(iv);
    }, [router.isReady, refresh]);

    useEffect(() => {
        if (!router.isReady || !STAKE) return;
        const socket = io(typeof window !== 'undefined' ? window.location.origin : '', {
            path: '/ws/',
            query: { stake: STAKE },
        });
        socketRef.current = socket;

        socket.on('message', (msg) => {
            if (msg.type === 'winner') {
                setSuppressCalls(true);
                setAudioOn(false);
                showWinner(msg.winner, msg.index, msg);
            } else if (msg.type === 'restarted' || msg.type === 'finished' || msg.type === 'disqualified') {
                try { localStorage.clear(); } catch (_) { }
                router.push(`/play?stake=${STAKE}&tid=${encodeURIComponent(TID)}`);
            }
        });

        const ping = setInterval(() => { socket.emit('message', { action: 'ping' }); }, 25000);
        return () => { socket.disconnect(); clearInterval(ping); };
    }, [router.isReady, STAKE, TID]);

    function showWinner(name, index, details) {
        setSuppressCalls(true);
        setWinner({ name: name || 'Player', index, details, countdown: 5 });
        let left = 5;
        if (winCountdownRef.current) clearInterval(winCountdownRef.current);
        winCountdownRef.current = setInterval(() => {
            left--;
            if (left <= 0) {
                clearInterval(winCountdownRef.current);
                try { localStorage.clear(); } catch (_) { }
                router.push(`/play?stake=${STAKE}&tid=${encodeURIComponent(TID)}`);
            }
            setWinner(prev => prev ? { ...prev, countdown: Math.max(0, left) } : null);
        }, 1000);
    }

    function claimBingo() {
        if (socketRef.current?.connected) {
            socketRef.current.emit('message', { action: 'claim_bingo', tid: TID, picks: [...picks] });
        }
        const form = new URLSearchParams();
        form.set('tid', TID); form.set('stake', String(STAKE)); form.set('picks', JSON.stringify([...picks]));
        fetch('/api/claim_bingo', { method: 'POST', body: form }).then(r => r.json()).then(data => {
            if (data.ok && myIndex != null) showWinner('You', myIndex, data);
        }).catch(() => { });
    }

    function isWinningCell(r, c, d) {
        if (!d) return false;
        if (d.pattern === 'row') return r === Number(d.row);
        if (d.pattern === 'col') return c === Number(d.col);
        if (d.pattern === 'diag_main') return r === c;
        if (d.pattern === 'diag_anti') return (r + c) === 4;
        if (d.pattern === 'four_corners') return (r === 0 && c === 0) || (r === 0 && c === 4) || (r === 4 && c === 0) || (r === 4 && c === 4);
        return false;
    }

    /* Ball component */
    function Ball({ n, size }) {
        const ltr = letterFor(n);
        const isLg = size === 'lg';
        return (
            <div className={`flex items-center justify-center rounded-full text-white shadow-lg border-2 border-white/90 ${isLg ? 'w-[88px] h-[88px]' : 'w-9 h-9'}`} style={{ background: LETTER_RING[ltr] }}>
                <div className="flex flex-col items-center leading-none">
                    <div className={`font-extrabold opacity-95 ${isLg ? 'text-xs -mt-0.5' : 'text-[10px]'}`}>{ltr}</div>
                    <div className={`font-black ${isLg ? 'text-[28px] mt-0.5' : 'text-sm mt-px'}`}>{n}</div>
                </div>
            </div>
        );
    }

    /* Top board rows */
    const boardRows = LETTERS.map((l, r) => {
        const start = r * 15 + 1;
        const nums = [];
        for (let n = start; n < start + 15; n++) nums.push(n);
        return { letter: l, nums };
    });

    const winCardRows = winner ? buildCard(Number(winner.index || 1)) : null;

    return (
        <>
            <Head><title>Bingo - Game</title></Head>
            <audio ref={audioRef} preload="auto" />

            <div className="max-w-[480px] mx-auto p-3">
                <div className="bg-panel border border-border rounded-xl shadow-lg p-2.5">

                    {/* Badges row */}
                    <div className="flex flex-col gap-0.5 mb-2.5 text-xs">
                        <div className="flex gap-2.5">
                            {[
                                { label: `Call ${callCount}` },
                                { label: `Players ${players}` },
                                { label: `Stake ${STAKE}` },
                                { label: `Derash ${Math.round(derash)}` },
                            ].map(b => (
                                <div key={b.label} className="bg-purple-dark text-white border border-white/20 rounded-full px-3.5 py-1.5 font-extrabold">{b.label}</div>
                            ))}
                        </div>
                        <div className="flex gap-2.5">
                            <div className="bg-purple-mid text-white border border-white/20 rounded-full px-3.5 py-1.5 font-extrabold">Game {totalGames}</div>
                            <div onClick={() => setAutoPickOn(p => !p)} className="bg-purple-mid text-white border border-white/20 rounded-full px-3.5 py-1.5 font-extrabold cursor-pointer flex items-center gap-1.5">
                                Auto
                                <div className={`w-11 h-6 rounded-full relative transition-colors ${autoPickOn ? 'bg-purple-glow' : 'bg-gray-300'}`}>
                                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${autoPickOn ? 'left-[22px]' : 'left-0.5'}`} />
                                </div>
                            </div>
                            <div onClick={() => setAudioOn(p => !p)} className="bg-purple-mid text-white border border-white/20 rounded-full px-3.5 py-1.5 font-extrabold cursor-pointer">
                                {audioOn ? '🔊' : '🔇'}
                            </div>
                        </div>
                    </div>

                    {/* Top board grid */}
                    <div className="bg-[#141824] border border-border rounded-[10px] p-2 mb-2.5 -ml-2.5">
                        <div className="grid gap-0.5 items-center -ml-2.5" style={{ gridTemplateColumns: '24px repeat(15, 1fr)' }}>
                            {boardRows.map(({ letter, nums }) => (
                                <div key={letter} className="contents">
                                    <div className="w-6 flex items-center justify-center font-extrabold -ml-1" style={{ color: LETTER_RING[letter] }}>{letter}</div>
                                    {nums.map(n => {
                                        const ns = String(n);
                                        const isCurrent = currentCall != null && ns === String(currentCall);
                                        const isCalled = calledSet.has(ns) && !isCurrent;
                                        return (
                                            <div key={n} className={`h-5 w-5 rounded-full flex items-center justify-center text-[11px] font-bold
                        ${isCurrent ? 'bg-green-bingo text-[#0b3018]' : isCalled ? 'bg-red-called text-white' : 'bg-board-cell text-slate-300'}`}>
                                                {n}
                                            </div>
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Current call & recent */}
                    <div className="flex items-center gap-2 my-2.5 justify-start">
                        {currentCall != null && <Ball n={currentCall} size="lg" />}
                        <div className="flex gap-2.5">
                            {recentCalls.map((n, i) => <Ball key={i} n={n} size="sm" />)}
                        </div>
                    </div>

                    {/* BINGO letter header */}
                    <div className="grid grid-cols-5 gap-2 my-2">
                        {LETTERS.map(l => <div key={l} className={`${LETTER_BG[l]} text-white font-extrabold text-center py-1.5 rounded-md`}>{l}</div>)}
                    </div>

                    {/* My card */}
                    <div className="bg-white rounded-[10px] p-2.5 grid grid-cols-5 gap-2">
                        {myCard ? myCard.flat().map((val, i) => {
                            const vs = String(val);
                            const isFree = val === 'FREE';
                            const isPicked = picks.has(vs);
                            return (
                                <div key={i} onClick={() => !isFree && togglePick(vs)}
                                    className={`rounded-lg flex items-center justify-center h-11 font-extrabold text-base border
                    ${isFree ? 'bg-purple-bright border-[#6a00b8] text-white cursor-default'
                                            : isPicked ? 'bg-purple-bright border-card-free-border text-white cursor-pointer'
                                                : 'bg-white border-gray-300 text-black cursor-pointer hover:bg-gray-50 active:scale-95 transition'}`}>
                                    {isFree ? '⭐' : val}
                                </div>
                            );
                        }) : (
                            <div className="col-span-5 text-center text-gray-400 py-5">No card — join from Play screen</div>
                        )}
                    </div>

                    {/* BINGO button */}
                    <div className="flex justify-center mt-3">
                        <button onClick={claimBingo} disabled={!myCard}
                            className={`bg-gold border border-gold-border text-[#1a1306] px-4 py-2.5 rounded-full font-bold transition
                ${myCard ? 'cursor-pointer hover:brightness-110 active:scale-95' : 'cursor-not-allowed opacity-60'}`}>
                            BINGO
                        </button>
                    </div>
                </div>
            </div>

            {/* Winner Modal */}
            {winner && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]">
                    <div className="bg-[#ede3f6] rounded-[14px] shadow-2xl p-3 max-w-[520px] w-[95vw]">
                        <div className="bg-accent text-white font-black text-center rounded-[10px] py-2.5 mb-2.5 text-xl">BINGO!</div>
                        <div className="flex items-center gap-2 justify-center my-2">
                            <span className="bg-green-bingo text-[#0b3018] font-extrabold rounded-lg px-2 py-0.5">{winner.name}</span>
                            <span className="text-gray-700">has won the game</span>
                        </div>
                        <div className="bg-[#d8c9ef] rounded-xl p-2 my-2">
                            <div className="grid grid-cols-5 gap-1.5 mb-1.5">
                                {LETTERS.map(l => <div key={l} className={`${LETTER_BG[l]} text-white font-extrabold text-center py-1.5 rounded-md`}>{l}</div>)}
                            </div>
                            <div className="bg-white rounded-[10px] p-2.5 grid grid-cols-5 gap-2">
                                {winCardRows && winCardRows.flat().map((val, i) => {
                                    const r = Math.floor(i / 5), c = i % 5;
                                    const isFree = val === 'FREE';
                                    const isWin = isWinningCell(r, c, winner.details);
                                    const winPicks = winner.details?.picks ? new Set(winner.details.picks.map(String)) : picks;
                                    const isP = !isFree && winPicks.has(String(val));
                                    return (
                                        <div key={i} className={`rounded-lg flex items-center justify-center h-11 font-bold border
                      ${isWin ? 'bg-card-free border-card-free-border text-white'
                                                : isP ? 'bg-yellow-300 border-yellow-500 text-gray-800'
                                                    : isFree ? 'bg-card-free border-card-free-border text-white'
                                                        : 'bg-white border-gray-300 text-black'}`}>
                                            {isFree ? '⭐' : val}
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="text-center mt-1.5 font-bold text-gray-700">Board number {winner.index}</div>
                        </div>
                        <div className="bg-accent text-white text-center font-black rounded-[10px] py-2.5 mt-2 text-xl">{winner.countdown ?? 5}</div>
                    </div>
                </div>
            )}
        </>
    );
}
