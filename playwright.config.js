import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./test/browser',
  timeout:120000,
  fullyParallel:false,
  workers:1,
  // An explicit external fixture is caller-owned. The default server belongs to
  // this test run and must never load a developer's ignored AT credential file.
  webServer:process.env.TEST_BASE_URL?undefined:{
    command:'python3 server.py',
    url:'http://127.0.0.1:3080',
    env:{PORT:'3080',AT_API_KEY:''},
    reuseExistingServer:false,
    timeout:30000
  },
  use:{baseURL:process.env.TEST_BASE_URL||'http://127.0.0.1:3080',headless:true,
    launchOptions:process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}},
  reporter:'list'
});
