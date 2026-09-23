// 헤드리스 캡처: 빌드 결과(dist)를 vite preview 로 띄우고 탭별 화면을 captures/ 에 저장한다.
//   npm run build && npm run capture            탭 6개 × 라이트
//   npm run capture -- --all                    + 보기 전환·1일·다크·폰 폭
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 4173
const BASE = `http://localhost:${PORT}/`
const OUT = new URL('../captures/', import.meta.url).pathname
const all = process.argv.includes('--all')

const tabs = [
  ['01_overview', 'tab=overview'],
  ['02_explore', 'tab=explore'],
  ['03_events', 'tab=events'],
  ['04_members', 'tab=members'],
  ['05_acquisition', 'tab=acquisition'],
  ['06_periodic', 'tab=periodic'],
]
const extras = [
  ['07_explore_venue', 'tab=explore&view=venue'],
  ['08_events_event', 'tab=events&view=event'],
  ['09_acquisition_campaign', 'tab=acquisition&view=campaign'],
  ['10_periodic_month', 'tab=periodic&view=month'],
  ['11_overview_1day', 'tab=overview&p=1'],
  ['12_explore_1year_paid_ios', 'tab=explore&p=365&ch=paid&pf=ios'],
  ['13_members_90', 'tab=members&p=90'],
]

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const wait = async () => {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(BASE)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('preview 서버가 뜨지 않음')
}

mkdirSync(OUT, { recursive: true })
try {
  await wait()
  const browser = await chromium.launch()
  const shoot = async (name, q, opts = {}) => {
    const ctx = await browser.newContext({
      viewport: opts.viewport ?? { width: 1440, height: 900 },
      deviceScaleFactor: opts.scale ?? 1,
      colorScheme: opts.scheme ?? 'light',
    })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    await page.goto(`${BASE}?${q}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('main section, main .card', { timeout: 10000 })
    await page.waitForTimeout(400)
    const file = `${OUT}${name}.png`
    await page.screenshot({ path: file, fullPage: true })
    console.log(`${file}${errors.length ? `  오류 ${errors.length}: ${errors[0]}` : ''}`)
    await ctx.close()
  }
  for (const [n, q] of tabs) await shoot(`${n}_light`, q)
  if (all) {
    for (const [n, q] of extras) await shoot(`${n}_light`, q)
    await shoot('20_overview_dark', 'tab=overview', { scheme: 'dark' })
    await shoot('21_periodic_dark', 'tab=periodic', { scheme: 'dark' })
    await shoot('22_overview_phone', 'tab=overview', { viewport: { width: 390, height: 844 }, scale: 2 })
    await shoot('23_periodic_phone', 'tab=periodic', { viewport: { width: 390, height: 844 }, scale: 2 })
  }
  await browser.close()
} finally {
  server.kill()
}
