CREATE TABLE IF NOT EXISTS "playground_mailbox" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "email" TEXT NOT NULL,
  "otp" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL
);
