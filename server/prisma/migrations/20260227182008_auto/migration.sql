-- AlterTable
ALTER TABLE "bingo_game" ALTER COLUMN "id" DROP DEFAULT;
DROP SEQUENCE "bingo_game_id_seq";

-- AlterTable
ALTER TABLE "bingo_selection" ADD COLUMN     "auto_enabled" BOOLEAN NOT NULL DEFAULT true;
