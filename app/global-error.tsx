'use client'

/**
 * The last resort: the root layout itself threw, so there is no sidebar, no
 * language context, and none of the layout's stylesheets are applied — Next
 * replaces the whole document with this. Hence inline styles and both
 * languages: with the provider gone there is nothing left to ask which one the
 * reader wanted.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#faf9f7', color: '#1c1b1a', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: '32rem', margin: '4rem auto', padding: '0 1.5rem' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 500, margin: 0 }}>The dashboard could not start</h1>
          <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: '#57534e' }}>
            This is a failure in the shell around every page, not in your data. Nothing has been written or changed.
          </p>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 500, marginTop: '2rem' }}>대시보드를 시작할 수 없습니다</h2>
          <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: '#57534e' }}>
            모든 페이지를 감싸는 공통 영역에서 발생한 오류이며, 데이터의 문제가 아닙니다. 기록되거나 변경된 내용은 없습니다.
          </p>
          {error.digest ? (
            <p style={{ fontSize: '0.75rem', color: '#78716c' }}>
              Reference / 참조 번호 <code>{error.digest}</code>
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              padding: '0.5rem 0.875rem',
              fontSize: '0.875rem',
              borderRadius: '0.375rem',
              border: '1px solid #d6d3d1',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            Try again · 다시 시도
          </button>
        </div>
      </body>
    </html>
  )
}
