export function toMariaDbDriverUrl(databaseUrl: string): string {
  if (!databaseUrl.startsWith('mysql://')) {
    throw new Error('DATABASE_URL must use the mysql:// scheme required by Prisma.');
  }
  return `mariadb://${databaseUrl.slice('mysql://'.length)}`;
}
