import { describe, expect, it } from 'vitest'
import { buildInvitationUrl } from '@/sync/invite-url'

const locationAt = (origin: string, pathname: string) => ({ origin, pathname })

describe('invitation URL', () => {
  it('uses VITE_PUBLIC_APP_URL when configured', () => {
    const result = buildInvitationUrl('invite-token', 'https://homecoin.example', locationAt('http://localhost:5173', '/invite'))

    expect(new URL(result).origin).toBe('https://homecoin.example')
  })

  it('falls back to window.location.origin when the public URL is not configured', () => {
    const result = buildInvitationUrl('invite-token', undefined, locationAt('http://localhost:5173', '/invite'))

    expect(new URL(result).origin).toBe('http://localhost:5173')
  })

  it('adds the invitation token through URLSearchParams', () => {
    const token = 'token/with+reserved=characters'
    const result = buildInvitationUrl(token, 'https://homecoin.example', locationAt('http://localhost:5173', '/invite'))

    expect(new URL(result).searchParams.get('invite')).toBe(token)
  })

  it('preserves the current pathname', () => {
    const result = buildInvitationUrl('invite-token', 'https://homecoin.example', locationAt('http://localhost:5173', '/invite/accept'))

    expect(new URL(result).pathname).toBe('/invite/accept')
  })

  it('preserves a path already configured in the public app URL', () => {
    const result = buildInvitationUrl('invite-token', 'https://example.com/homecoin/', locationAt('http://localhost:5173', '/invite'))

    expect(new URL(result).pathname).toBe('/homecoin/invite')
  })
})
