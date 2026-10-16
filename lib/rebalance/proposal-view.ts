import type { LlmFailureReason, LlmRecord } from '@/lib/rebalance/llm-contract'

type Lang = 'en' | 'ko'

/** Returns the URL only when it is an absolute https: URL; anything else (javascript:, http:, garbage) is null. */
export function safeSourceHref(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' ? parsed.href : null
  } catch {
    return null
  }
}

const FAILURE: Record<LlmFailureReason, Record<Lang, string>> = {
  runner_unavailable: { en: 'the LLM runner is not available', ko: 'LLM 실행기를 사용할 수 없음' },
  runner_failed: { en: 'the LLM runner failed', ko: 'LLM 실행기 오류' },
  timeout: { en: 'the LLM runner timed out', ko: '시간 초과' },
  invalid_output: { en: 'the output failed validation', ko: '출력 형식 오류' },
}

const SKIPPED: Record<Lang, string> = {
  en: 'LLM judgment skipped — targets held',
  ko: 'LLM 판단을 건너뜀 — 목표는 유지했습니다',
}

/** One fixed-copy line describing what the LLM step did. Model text never reaches this line. */
export function llmStatusLine(record: LlmRecord, lang: Lang): string {
  const attempts = record.attempts.length
  const name = record.model ? `${record.runner} (${record.model})` : record.runner
  const koName = record.model ? `${record.runner}(${record.model})` : record.runner
  if (record.status === 'ok') {
    return lang === 'ko'
      ? `${koName}이 ${attempts}회 시도로 판단`
      : `Judged by ${name} in ${attempts} ${attempts === 1 ? 'attempt' : 'attempts'}`
  }
  if (record.status === 'skipped') return SKIPPED[lang]
  const why = record.reason ? FAILURE[record.reason]?.[lang] : undefined
  if (lang === 'ko') return `LLM 판단 실패: ${why ?? '알 수 없는 이유'} — 목표는 유지했습니다`
  return `LLM judgment failed: ${why ?? 'unknown reason'} — targets held`
}
