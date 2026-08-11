import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Extensions load only in a persistent context, and the attached profile makes parallel runs flaky.
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
})
