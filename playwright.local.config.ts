import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  webServer: {
    ...base.webServer,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'], browserName: 'chromium' },
    },
  ],
});
