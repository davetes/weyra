// Express + Socket.IO server entry point
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const morgan = require("morgan");

const handleGameState = require("./routes/gameState");
const { handleSelect, handleAuto } = require("./routes/select");
const handleClaimBingo = require("./routes/claimBingo");
const handleAbandon = require("./routes/abandon");
const handleProfile = require("./routes/profile");
const handleHistory = require("./routes/history");
const handleDepositRequest = require("./routes/depositRequest");
const handleWithdrawRequest = require("./routes/withdrawRequest");
const handleDepositAccounts = require("./routes/depositAccounts");
const handleWalletRequests = require("./routes/walletRequests");
const handleStakeState = require("./routes/stakeState");
const adminRoutes = require("./routes/admin");
const setupSocket = require("./socket");
const { startCallTicker } = require("./callTicker");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  path: "/ws/",
});

// Middleware
app.use(cors());
app.use(morgan(process.env.NODE_ENV === "production" ? "tiny" : "dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (audio, images) from root public/
app.use("/static", express.static(path.join(__dirname, "..", "public")));

// API Routes
app.get("/api/game_state", (req, res) => handleGameState(req, res, io));
app.get("/api/stake_state", (req, res) => handleStakeState(req, res));
app.get("/api/profile", (req, res) => handleProfile(req, res));
app.get("/api/history", (req, res) => handleHistory(req, res));
app.get("/api/deposit_accounts", (req, res) => handleDepositAccounts(req, res));
app.get("/api/wallet_requests", (req, res) => handleWalletRequests(req, res));
app.post("/api/select", (req, res) => handleSelect(req, res));
app.post("/api/auto", (req, res) => handleAuto(req, res));
app.post("/api/claim_bingo", (req, res) => handleClaimBingo(req, res, io));
app.post("/api/abandon", (req, res) => handleAbandon(req, res));
app.post("/api/deposit_request", (req, res) => handleDepositRequest(req, res));
app.post("/api/withdraw_request", (req, res) =>
  handleWithdrawRequest(req, res),
);
app.use("/api/admin", adminRoutes);

// Health check
app.get("/api/health", (req, res) =>
  res.json({ ok: true, uptime: process.uptime() }),
);

// Socket.IO
setupSocket(io);
startCallTicker(io);

// Start Telegram bot (non-blocking)
try {
  const { startBot } = require("./bot/index");
  startBot();
  console.log("✅ Telegram bot started");
} catch (err) {
  console.warn("⚠️  Telegram bot disabled:", err.message);
}

const PORT = parseInt(process.env.PORT || "4000", 10);
server.listen(PORT, () => {
  console.log(`🚀 Express server running on http://localhost:${PORT}`);
  console.log(`🔌 Socket.IO listening on ws://localhost:${PORT}/ws/`);
});
