import { toMariaDbDriverUrl } from './mariadb-url';

describe('toMariaDbDriverUrl', () => {
  it('adapts Prisma mysql URLs for the official MariaDB driver adapter', () => {
    expect(toMariaDbDriverUrl('mysql://user:p%40ss@db.example:3306/control_panel')).toBe(
      'mariadb://user:p%40ss@db.example:3306/control_panel',
    );
  });

  it('rejects non-MySQL Prisma URLs', () => {
    expect(() => toMariaDbDriverUrl('postgresql://localhost/control_panel')).toThrow(
      'DATABASE_URL must use the mysql:// scheme',
    );
  });
});
