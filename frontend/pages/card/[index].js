import { useRouter } from 'next/router';
import Head from 'next/head';

/* ── Deterministic card ── */
function mulberry32(seed) {
    seed = seed & 0xFFFFFFFF;
    return function () { seed = (seed + 0x6D2B79F5) & 0xFFFFFFFF; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffleArr(arr, seed) { const p = mulberry32(seed); const r = arr.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(p() * (i + 1));[r[i], r[j]] = [r[j], r[i]]; } return r; }
const RANGES = [[1, 15], [16, 30], [31, 45], [46, 60], [61, 75]];
function buildCard(seed) { const cols = RANGES.map(([s, e], idx) => { const a = []; for (let n = s; n <= e; n++) a.push(n); return shuffleArr(a, seed + idx * 1000).slice(0, 5); }); return Array.from({ length: 5 }, (_, r) => Array.from({ length: 5 }, (_, c) => (r === 2 && c === 2 ? 'FREE' : cols[c][r]))); }

const LETTER_BG = { B: 'bg-green-bingo', I: 'bg-red-bingo', N: 'bg-yellow-bingo', G: 'bg-[#34495e]', O: 'bg-red-called' };
const LETTERS = ['B', 'I', 'N', 'G', 'O'];

export default function CardPage() {
    const router = useRouter();
    const { index: indexQ, stake: stakeQ, tid: tidQ } = router.query;
    const index = parseInt(indexQ || '1', 10);
    const stake = parseInt(stakeQ || '10', 10);
    const tid = tidQ || '';
    const rows = buildCard(index);

    async function handleAccept() {
        const form = new URLSearchParams();
        form.set('tid', tid); form.set('stake', String(stake)); form.set('index', String(index)); form.set('action', 'accept');
        const res = await fetch('/api/select', { method: 'POST', body: form });
        if (res.ok) {
            router.push(`/play?stake=${stake}&tid=${tid}`);
        } else if (res.status === 409) {
            alert('This card has been taken.');
            router.push(`/play?stake=${stake}&tid=${tid}`);
        }
    }

    return (
        <>
            <Head><title>Card {index} - {stake} ETB</title></Head>
            <div className="max-w-[420px] mx-auto p-3">
                <div className="rounded-2xl shadow-2xl p-3" style={{ background: 'linear-gradient(180deg,#f6a623,#d8890b)' }}>
                    {/* Card number badge */}
                    <div className="flex items-center justify-center mb-2">
                        <div className="w-9 h-9 rounded-full bg-[#ffcc33] flex items-center justify-center font-extrabold text-[#7a4b00] border-2 border-[#f0b000]">{index}</div>
                    </div>

                    {/* Card body */}
                    <div className="bg-[#e7cda3] rounded-xl p-2">
                        <div className="grid grid-cols-5 gap-1.5 mb-1.5">
                            {LETTERS.map(l => <div key={l} className={`${LETTER_BG[l]} text-white font-extrabold text-center py-1.5 rounded-md`}>{l}</div>)}
                        </div>
                        <div className="bg-bg rounded-[10px] p-2.5 grid grid-cols-5 gap-2">
                            {rows.flat().map((val, i) => (
                                <div key={i} className={`rounded-lg flex items-center justify-center h-11 font-bold border
                  ${val === 'FREE' ? 'bg-card-free border-card-free-border text-white' : 'bg-panel border-[#444] text-gray-100'}`}>
                                    {val === 'FREE' ? '⭐' : val}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 justify-center my-2.5">
                        <button onClick={handleAccept} className="border-none rounded-full px-4 py-2.5 font-bold cursor-pointer bg-green-bingo text-[#04120a] hover:brightness-110 active:scale-95 transition">Accept</button>
                        <button onClick={() => router.back()} className="border-none rounded-full px-4 py-2.5 font-bold cursor-pointer bg-gray-400 text-gray-900 hover:brightness-110 active:scale-95 transition">Cancel</button>
                    </div>
                </div>
            </div>
        </>
    );
}
