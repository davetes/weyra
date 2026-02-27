-- CreateTable
CREATE TABLE "bingo_player" (
    "id" SERIAL NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "phone" VARCHAR(32) NOT NULL DEFAULT '',
    "username" VARCHAR(64) NOT NULL DEFAULT '',
    "wallet" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gift" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "banned_at" TIMESTAMP(3),
    "ban_reason" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bingo_player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_user" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(64) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" VARCHAR(32) NOT NULL,
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_session" (
    "id" SERIAL NOT NULL,
    "token" VARCHAR(128) NOT NULL,
    "admin_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "admin_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_setting" (
    "id" SERIAL NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "value" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bingo_game" (
    "id" SERIAL NOT NULL,
    "stake" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "finished" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "countdown_started_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "sequence" TEXT NOT NULL DEFAULT '',
    "stakes_charged" BOOLEAN NOT NULL DEFAULT false,
    "charged_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bingo_game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bingo_selection" (
    "id" SERIAL NOT NULL,
    "game_id" INTEGER NOT NULL,
    "player_id" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 0,
    "index" INTEGER NOT NULL,
    "accepted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "bingo_selection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bingo_transaction" (
    "id" SERIAL NOT NULL,
    "player_id" INTEGER NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "actor_tid" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bingo_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_request" (
    "id" SERIAL NOT NULL,
    "player_id" INTEGER NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "method" VARCHAR(32) NOT NULL DEFAULT '',
    "amount" DECIMAL(12,2),
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "caption" TEXT NOT NULL DEFAULT '',
    "telegram_message_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by_admin_id" INTEGER,
    "decision_note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "deposit_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdraw_request" (
    "id" SERIAL NOT NULL,
    "player_id" INTEGER NOT NULL,
    "telegram_id" BIGINT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" VARCHAR(32) NOT NULL DEFAULT '',
    "account" TEXT NOT NULL DEFAULT '',
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "decided_by_admin_id" INTEGER,
    "decision_note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "withdraw_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bingo_player_telegram_id_key" ON "bingo_player"("telegram_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_user_username_key" ON "admin_user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "admin_session_token_key" ON "admin_session"("token");

-- CreateIndex
CREATE INDEX "admin_session_admin_id_idx" ON "admin_session"("admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_setting_key_key" ON "app_setting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "bingo_selection_game_id_index_key" ON "bingo_selection"("game_id", "index");

-- CreateIndex
CREATE UNIQUE INDEX "bingo_selection_game_id_player_id_slot_key" ON "bingo_selection"("game_id", "player_id", "slot");

-- CreateIndex
CREATE INDEX "deposit_request_player_id_idx" ON "deposit_request"("player_id");

-- CreateIndex
CREATE INDEX "deposit_request_status_idx" ON "deposit_request"("status");

-- CreateIndex
CREATE INDEX "withdraw_request_player_id_idx" ON "withdraw_request"("player_id");

-- CreateIndex
CREATE INDEX "withdraw_request_status_idx" ON "withdraw_request"("status");

-- AddForeignKey
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bingo_selection" ADD CONSTRAINT "bingo_selection_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "bingo_game"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bingo_selection" ADD CONSTRAINT "bingo_selection_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "bingo_player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bingo_transaction" ADD CONSTRAINT "bingo_transaction_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "bingo_player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_request" ADD CONSTRAINT "deposit_request_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "bingo_player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdraw_request" ADD CONSTRAINT "withdraw_request_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "bingo_player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
