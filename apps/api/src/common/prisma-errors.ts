import { ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';

export function throwMappedPrismaError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002')
      throw new ConflictException('A record with this identifier exists.');
    if (error.code === 'P2003') throw new ConflictException('The record is referenced elsewhere.');
  }
  throw error;
}
