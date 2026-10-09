// The `fake` provider (ADR-0003 §3.1, §5; PRV-6): in-memory, no network, no
// real auth. Gated behind `SPLE_ENABLE_FAKE_PROVIDER=1` at the registration
// point (see `../../../provider/registry.ts`); importable unconditionally
// here so tests can construct it directly.
export * from './fixtures.ts'
export * from './fake-provider.ts'
