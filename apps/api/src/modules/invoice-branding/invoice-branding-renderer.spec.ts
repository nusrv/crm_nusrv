import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
describe('Actual shared React invoice renderer', () => {
  it('renders all issuer variants, hides optional fields and enforces official fields from immutable snapshots', () => {
    const result = execFileSync(
      process.execPath,
      [
        join(process.cwd(), '../../node_modules/tsx/dist/cli.mjs'),
        '--tsconfig',
        join(process.cwd(), '../web/render-test.tsconfig.json'),
        join(process.cwd(), '../web/tests/invoice-branding-renderer.check.tsx'),
      ],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 25000 },
    );
    expect(result).toContain('PASS: shared renderer');
  }, 30000);
});
