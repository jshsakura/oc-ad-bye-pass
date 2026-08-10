import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // 확장은 persistent context 로만 로드되고, 프로필이 붙어 있어 병렬 실행이 불안정하다.
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
})
