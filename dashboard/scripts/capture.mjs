// 헤드리스 캡처: 빌드 결과(dist)를 vite preview 로 띄우고 탭별 화면을 captures/ 에 저장한다.
//   npm run build && npm run capture            탭 6개 × 라이트
//   npm run capture -- --all                    + 보기 전환·1일·다크·폰 폭·데이터 페이지
//   NP_CATALOG=/tmp/catalog.json npm run capture -- --all   catalog.json 을 이 파일로 대체해 찍는다
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 4173
const BASE = `http://localhost:${PORT}/`
const OUT = new URL('../captures/', import.meta.url).pathname
const all = process.argv.includes('--all')
const catalogFile = process.env.NP_CATALOG
if (catalogFile && !existsSync(catalogFile)) throw new Error(`NP_CATALOG 파일 없음: ${catalogFile}`)

const tabs = [
  ['01_overview', 'tab=overview'],
  ['02_funnel', 'tab=funnel'],
  ['03_events', 'tab=events'],
  ['04_members', 'tab=members'],
  ['05_acquisition', 'tab=acquisition'],
  ['06_periodic', 'tab=periodic'],
]
const extras = [
  ['07_events_venue', 'tab=events&view=venue'],
  ['08_events_event', 'tab=events&view=event'],
  ['09_acquisition_campaign', 'tab=acquisition&view=campaign'],
  ['10_periodic_month', 'tab=periodic&view=month'],
  ['11_overview_1day', 'tab=overview&p=1'],
  ['12_funnel_1year_paid_ios', 'tab=funnel&p=365&ch=paid&pf=ios'],
  ['14_funnel_1day', 'tab=funnel&p=1'],
  ['15_funnel_7_member', 'tab=funnel&p=7&ms=member&aud=new,returning,past_payer,apply_no_pay'],
  ['30_about', 'page=about'],
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
    if (opts.noCatalog) await page.route('**/catalog.json', (route) => route.fulfill({ status: 404, body: '' }))
    else if (catalogFile)
      await page.route('**/catalog.json', (route) => route.fulfill({ json: JSON.parse(readFileSync(catalogFile, 'utf8')) }))
    if (opts.strip)
      await page.route('**/data.json', async (route) => {
        const body = await (await route.fetch()).json()
        for (const k of opts.strip) delete body[k]
        await route.fulfill({ json: body })
      })
    await page.goto(`${BASE}?${q}`, { waitUntil: 'networkidle' })
    await page.waitForSelector(opts.wait ?? 'main section, main .card', { timeout: 10000 })
    await page.waitForTimeout(400)
    const file = `${OUT}${name}.png`
    if (opts.section) {
      const card = page.locator('main section.card', { has: page.locator(`h2:text-is("${opts.section}")`) })
      if (opts.click != null) {
        await card.locator('svg path').nth(opts.click).dispatchEvent('click')
        await page.waitForTimeout(200)
      }
      await card.screenshot({ path: file })
    } else await page.screenshot({ path: file, fullPage: !opts.clip })
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
    await shoot('17_funnel_audience', 'tab=funnel&p=90', { section: '오디언스별 퍼널' })
    await shoot('18_funnel_path_click', 'tab=funnel&p=90', { section: '경로 탐색', click: 0 })
    await shoot('19_funnel_nodata', 'tab=funnel', { strip: ['weekly_audience_funnel', 'weekly_path'] })
    await shoot('24_funnel_dark', 'tab=funnel', { scheme: 'dark' })
    await shoot('25_funnel_phone', 'tab=funnel', { viewport: { width: 390, height: 844 }, scale: 2 })
    await shoot('31_about_dark', 'page=about', { scheme: 'dark' })
    await shoot('32_about_phone', 'page=about', { viewport: { width: 390, height: 844 }, scale: 2 })
    await shoot('33_about_phone_dark', 'page=about', { viewport: { width: 390, height: 844 }, scale: 2, scheme: 'dark', wait: 'main section' })
    await shoot('40_data_light', 'page=data')
    await shoot('41_data_raw_light', 'page=data&table=raw.ga4_events')
    await shoot('42_data_dark', 'page=data&table=marts.weekly_path', { scheme: 'dark' })
    await shoot('43_data_phone', 'page=data', { viewport: { width: 390, height: 844 }, scale: 2, wait: 'main section' })
    await shoot('44_data_phone_dark', 'page=data&table=staging.int_session', { viewport: { width: 390, height: 844 }, scale: 2, scheme: 'dark', wait: 'main section' })
    await shoot('45_data_nocatalog', 'page=data', { noCatalog: true, wait: 'main' })
    await shoot('46_header_phone_about', 'page=about', { viewport: { width: 390, height: 300 }, scale: 2, wait: 'header', clip: true })
    await shoot('47_header_tablet', 'tab=funnel', { viewport: { width: 768, height: 400 }, clip: true })
  }
  await browser.close()
} finally {
  server.kill()
}
