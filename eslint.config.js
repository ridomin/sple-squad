import love from 'eslint-config-love'

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '.squad/**', 'docs/**']
  },
  {
    ...love,
    files: ['src/**/*.ts', 'schemas/**/*.ts']
  },
  {
    // node:test's describe/it return promises that are intentionally not
    // awaited, and exit-code literals read fine as plain numbers in assertions.
    files: ['src/**/*.test.ts', 'schemas/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-magic-numbers': 'off'
    }
  }
]
