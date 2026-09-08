import { spawn } from 'node:child_process'
import console from 'node:console'
import process from 'node:process'

const required = ['SUPABASE_TEST_URL', 'SUPABASE_TEST_KEY', 'SUPABASE_TEST_EMAIL_A', 'SUPABASE_TEST_EMAIL_B', 'SUPABASE_TEST_PASSWORD']
const missing = required.filter((name) => !process.env[name])
if (missing.length) {
  console.error(`Cloud browser verification is not configured. Missing: ${missing.join(', ')}. Copy the dedicated values into .env.cloud-test or export them in this test process.`)
  process.exit(2)
}

const child = spawn(process.execPath, [
  'node_modules/@playwright/test/cli.js',
  'test',
  '--config=playwright.cloud.config.ts',
  ...process.argv.slice(2),
], {
  cwd: process.cwd(),
  env: { ...process.env, STICKERLAB_CLOUD_TEST: '1' },
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
