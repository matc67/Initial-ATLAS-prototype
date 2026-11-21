// Browser regression tests (tests/e2e). They run against the production build, served with the headers in netlify.toml
// (scripts/serve-dist.ts), so they also test the Content Security Policy and data versioning that will be deployed.
//
//   npm run test:e2e              build, then every browser test
//   npx playwright test layout    one file (after a build)
//   npx playwright show-report    the last run's report, with traces of failures
//   E2E_BASE_URL=https://… npx playwright test gameplay security
//                                 against a deployed site (a Netlify deploy preview, or production after a deploy)
//
// The performance budgets run last, on their own, so other tests do not compete for the CPU (project "performance").
// A slow machine can scale them with PERF_BUDGET_SCALE=2.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);
const REMOTE = process.env.E2E_BASE_URL;
const GL = process.env.E2E_GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: REMOTE ?? `http://127.0.0.1:${PORT}/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Full Chromium in its new headless mode, which can use the GPU. The globe is drawn with Metal on a Mac and with
    // SwiftShader (software WebGL) elsewhere, such as a CI machine without a GPU; E2E_GL=swiftshader forces software.
    channel: 'chromium',
    launchOptions: { args: [`--use-angle=${GL}`, '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: REMOTE ? undefined : {
    command: `node scripts/serve-dist.ts ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: /performance\.spec/ },
    { name: 'performance', use: { ...devices['Desktop Chrome'] }, testMatch: /performance\.spec/, dependencies: ['chromium'], fullyParallel: false },
  ],
});
