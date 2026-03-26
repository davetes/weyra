-- Prevent duplicate deposit references (ignore empty references)
CREATE UNIQUE INDEX IF NOT EXISTS "deposit_request_bank_reference_unique"
ON "deposit_request" ("bank_reference")
WHERE "bank_reference" <> '';
