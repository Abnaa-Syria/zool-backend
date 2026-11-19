import { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '../observability/logger';

export type PrismaTx = Prisma.TransactionClient;

let prisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return prisma;
}

export async function connectPrisma(): Promise<PrismaClient> {
  const client = getPrisma();
  await client.$connect();
  logger.info('Prisma connected');
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    logger.info('Prisma disconnected');
  }
}

export async function prismaHealthCheck(): Promise<boolean> {
  try {
    await getPrisma().$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
