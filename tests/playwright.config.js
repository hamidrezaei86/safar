// Safar automated tests. Run: cd tests && npm test   (SAFAR_PAGE=staging/ to test the staging copy)
const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
  testDir: '.', testMatch: /.*\.spec\.js/, timeout: 45000, retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:8080/', ...devices['iPhone 13'], browserName: 'chromium', serviceWorkers: 'block' },
  webServer: { command: 'python3 -m http.server 8080 --directory ..', url: 'http://localhost:8080/index.html', reuseExistingServer: true },
});
