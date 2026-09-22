import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./test/browser',
  timeout:120000,
  fullyParallel:false,
  workers:1,
  use:{baseURL:process.env.TEST_BASE_URL||'http://127.0.0.1:3080',headless:true,
    launchOptions:process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}},
  reporter:'list'
});
