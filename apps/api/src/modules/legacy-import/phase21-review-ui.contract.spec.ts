import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('structured legacy import review UI contract', () => {
  const source = readFileSync(
    join(process.cwd(), '..', 'web', 'components', 'legacy-import-manager.tsx'),
    'utf8',
  );

  it('does not expose raw JSON mapping editors', () => {
    expect(source).not.toContain('Mapped customer JSON');
    expect(source).not.toContain('Mapped subscriptions JSON');
    expect(source).not.toContain('name="mappedCustomer"');
    expect(source).not.toContain('name="mappedSubscriptions"');
  });

  it('requires explicit operational decisions and supports explicit splits', () => {
    expect(source).toContain('Package decision');
    expect(source).toContain('Source registration (preserved)');
    expect(source).toContain('Renewal date (confirmed)');
    expect(source).toContain('Add another subscription (explicit split)');
    expect(source).toContain('Delete staged batch');
    expect(source).toContain('This cannot be undone.');
    expect(source).toContain('Duplicate suggestions — no automatic merge');
  });
});
