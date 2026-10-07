import { describe, expect, it } from 'vitest';
import { getHelpText, getVersion, run } from './index.js';

describe('cli entrypoint smoke test', () => {
  it('reports a non-empty version string', () => {
    expect(getVersion()).toBeTypeOf('string');
    expect(getVersion().length).toBeGreaterThan(0);
  });

  it('prints help text including usage', () => {
    expect(getHelpText()).toContain('Usage: sple');
  });

  it('run() returns 0 for --version', () => {
    expect(run(['--version'])).toBe(0);
  });

  it('run() returns 0 for --help', () => {
    expect(run(['--help'])).toBe(0);
  });

  it('run() returns 1 for an unknown option', () => {
    expect(run(['--nope'])).toBe(1);
  });
});
