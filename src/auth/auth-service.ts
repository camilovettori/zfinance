import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getSupabaseClient } from '@/sync/supabase-client'

const emailSchema = z.string().trim().email('Enter a valid email address.')
const passwordSchema = z.string().min(8, 'Password must contain at least 8 characters.')

const humanAuthError = (message: string) => {
  const normalized = message.toLowerCase()
  if (normalized.includes('invalid login')) return 'Email or password is incorrect.'
  if (normalized.includes('email not confirmed')) return 'Confirm your email before signing in.'
  if (normalized.includes('already registered')) return 'An account already exists for this email.'
  if (normalized.includes('rate limit')) return 'Too many attempts. Please wait and try again.'
  if (normalized.includes('network') || normalized.includes('fetch')) return 'HomeCoin could not reach the server. Your local data is safe.'
  return message || 'Authentication failed. Please try again.'
}

export class AuthService {
  private readonly client: SupabaseClient | null

  constructor(client: SupabaseClient | null = getSupabaseClient()) {
    this.client = client
  }

  private requireClient() {
    if (!this.client) throw new Error('Cloud sync is not configured. HomeCoin remains local only.')
    return this.client
  }

  async session() {
    const { data, error } = await this.requireClient().auth.getSession()
    if (error) throw new Error(humanAuthError(error.message))
    return data.session
  }

  async signUp(email: string, password: string) {
    const values = { email: emailSchema.parse(email), password: passwordSchema.parse(password) }
    const { data, error } = await this.requireClient().auth.signUp(values)
    if (error) throw new Error(humanAuthError(error.message))
    return data
  }

  async signIn(email: string, password: string) {
    const values = { email: emailSchema.parse(email), password: passwordSchema.parse(password) }
    const { data, error } = await this.requireClient().auth.signInWithPassword(values)
    if (error) throw new Error(humanAuthError(error.message))
    return data.session
  }

  async requestPasswordReset(email: string) {
    const validEmail = emailSchema.parse(email)
    const redirectTo = typeof window === 'undefined' ? undefined : `${window.location.origin}/`
    const { error } = await this.requireClient().auth.resetPasswordForEmail(validEmail, { redirectTo })
    if (error) throw new Error(humanAuthError(error.message))
  }

  async signOut() {
    const { error } = await this.requireClient().auth.signOut({ scope: 'local' })
    if (error) throw new Error(humanAuthError(error.message))
  }

  async updatePassword(password: string) {
    const validPassword = passwordSchema.parse(password)
    const { error } = await this.requireClient().auth.updateUser({ password: validPassword })
    if (error) throw new Error(humanAuthError(error.message))
  }

  onAuthStateChange(handler: (event: AuthChangeEvent, session: Session | null) => void) {
    if (!this.client) return () => undefined
    const { data } = this.client.auth.onAuthStateChange(handler)
    return () => data.subscription.unsubscribe()
  }
}

export { humanAuthError }
