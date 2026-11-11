import { config } from '@/config'
import { readTaxHistory } from '@/lib/adapters/tax-history-store'
import { resolveTaxEvidence } from '@/lib/application/evidence-index'

export const dynamic = 'force-dynamic'
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (config.finance.mode !== 'private') return new Response('Not found', { status: 404 })
  const { id } = await params
  const evidence = readTaxHistory().evidence.find((row) => row.id === id && !row.deleted)
  if (!evidence) return new Response('Not found', { status: 404 })
  try {
    const document = resolveTaxEvidence(evidence, { records: config.finance.recordsDir, tax: config.finance.taxDir })
    return new Response(new Uint8Array(document.bytes), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
      },
    })
  } catch {
    return new Response('Evidence unavailable; review the recorded document or relink it.', {
      status: 409,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}
