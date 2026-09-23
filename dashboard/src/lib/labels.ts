export const S = (n: number) => `var(--s${n})`

export const CHANNEL2: { key: string; label: string }[] = [
  { key: 'direct', label: '직접' },
  { key: 'organic_search', label: '자연 검색' },
  { key: 'organic_social', label: '자연 소셜' },
  { key: 'influencer', label: '인플루언서' },
  { key: 'paid_social', label: '유료 소셜' },
  { key: 'referral', label: '추천' },
  { key: 'ai_referral', label: 'AI 추천' },
  { key: 'other', label: '기타' },
]

export function channel2Label(k: string | null): string {
  if (!k) return '—'
  return CHANNEL2.find((c) => c.key === k)?.label ?? k
}

export function channel2Color(k: string): string {
  const i = CHANNEL2.findIndex((c) => c.key === k)
  return S(i < 0 ? 8 : i + 1)
}

export const PRICE_TIER: Record<string, string> = { free: '무료', standard: '일반', premium: '프리미엄' }

export const FUNNEL_LABEL: Record<string, string> = {
  landing: '랜딩',
  detail: '행사 상세',
  signup: '로그인·가입',
  apply_view: '신청 화면',
  payment: '결제',
}
