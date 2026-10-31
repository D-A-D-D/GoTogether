-- CreateEnum
CREATE TYPE "DirectStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CLOSED');

-- CreateTable
CREATE TABLE "DirectThread" (
    "id" TEXT NOT NULL,
    "userLowId" TEXT NOT NULL,
    "userHighId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" "DirectStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lowReadAt" TIMESTAMP(3),
    "highReadAt" TIMESTAMP(3),

    CONSTRAINT "DirectThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DirectThread_userLowId_lastMessageAt_idx" ON "DirectThread"("userLowId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "DirectThread_userHighId_lastMessageAt_idx" ON "DirectThread"("userHighId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "DirectThread_userLowId_userHighId_key" ON "DirectThread"("userLowId", "userHighId");

-- CreateIndex
CREATE INDEX "DirectMessage_threadId_createdAt_idx" ON "DirectMessage"("threadId", "createdAt");

-- AddForeignKey
ALTER TABLE "DirectThread" ADD CONSTRAINT "DirectThread_userLowId_fkey" FOREIGN KEY ("userLowId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectThread" ADD CONSTRAINT "DirectThread_userHighId_fkey" FOREIGN KEY ("userHighId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DirectThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

