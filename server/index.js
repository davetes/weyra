// Express + Socket.IO server entry point
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const handleGameState = require('./routes/gameState');
const handleSelect = require('./routes/select');
const handleClaimBingo = require('./routes/claimBingo');
const handleAbandon = require('./routes/abandon');
const setupSocket = require('./socket');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' },
    path: '/ws/',
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (audio, images) from root public/
app.use('/static', express.static(path.join(__dirname, '..', 'public')));

// API Routes
app.get('/api/game_state', (req, res) => handleGameState(req, res, io));
app.post('/api/select', (req, res) => handleSelect(req, res));
app.post('/api/claim_bingo', (req, res) => handleClaimBingo(req, res, io));
app.post('/api/abandon', (req, res) => handleAbandon(req, res));

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Socket.IO
setupSocket(io);

// Start Telegram bot (non-blocking)
try {
    const { startBot } = require('./bot/index');
    startBot();
    console.log('✅ Telegram bot started');
} catch (err) {
    console.warn('⚠️  Telegram bot disabled:', err.message);
}

const PORT = parseInt(process.env.PORT || '4000', 10);
server.listen(PORT, () => {
    console.log(`🚀 Express server running on http://localhost:${PORT}`);
    console.log(`🔌 Socket.IO listening on ws://localhost:${PORT}/ws/`);
});
