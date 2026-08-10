import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthService } from '@/auth/auth-service'
import { serializeBackup } from '@/domain/backup'
import type { AppState, Household, HouseholdMember } from '@/domain/model'
import { isTauriRuntime } from '@/persistence/runtime'
import { webDatabase } from '@/persistence/web/db'
import { getActiveHouseholdId, loadHouseholdState, saveState } from '@/services/storage'
import { buildInvitationUrl } from '@/sync/invite-url'
import {
  activateSyncRuntime,
  activeSyncCoordinator,
  deactivateSyncRuntime,
  getSupabaseClient,
  syncConfiguration,
  SupabaseHouseholdRepository,
  type HouseholdSummary,
  type LocalMigrationSummary,
} from '@/sync'

type Props = {
  state: AppState
  onStateChanged(state: AppState): void
  authOnly?: boolean
  inviteOnly?: boolean
  initialInviteToken?: string
  onInviteAccepted?(household: HouseholdSummary): void
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.'

function downloadText(content: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function moveLocalStateToHousehold(state: AppState, household: Household, members: HouseholdMember[]): AppState {
  const householdId = household.id
  return {
    ...state,
    household,
    members,
    accounts: state.accounts.map((item) => ({ ...item, householdId })),
    categories: state.categories.map((item) => ({ ...item, householdId })),
    transactions: state.transactions.map((item) => ({ ...item, householdId })),
    recurringRules: state.recurringRules.map((item) => ({ ...item, householdId })),
    settings: {
      ...state.settings,
      currency: household.currency,
      locale: household.locale,
      weekStartDay: household.weekStartDay,
      financialMonthStartDay: household.financialMonthStartDay,
    },
  }
}

export function SharingPanel({ state, onStateChanged, authOnly = false, inviteOnly = false, initialInviteToken, onInviteAccepted }: Props) {
  const client = useMemo(() => getSupabaseClient(), [])
  const auth = useMemo(() => new AuthService(client), [client])
  const householdsRepository = useMemo(() => client ? new SupabaseHouseholdRepository(client) : null, [client])
  const [loading, setLoading] = useState(Boolean(client) && !authOnly)
  const [session, setSession] = useState<Session | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [householdName, setHouseholdName] = useState(state.household.name)
  const [households, setHouseholds] = useState<HouseholdSummary[]>([])
  const [active, setActive] = useState<HouseholdSummary | null>(null)
  const [creatingHousehold, setCreatingHousehold] = useState(false)
  const [members, setMembers] = useState<HouseholdMember[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteToken, setInviteToken] = useState(() => initialInviteToken ?? new URLSearchParams(window.location.search).get('invite') ?? '')
  const [acceptedInvitation, setAcceptedInvitation] = useState<HouseholdSummary | null>(null)
  const [createdInvite, setCreatedInvite] = useState('')
  const [migration, setMigration] = useState<LocalMigrationSummary | null>(null)
  const [ready, setReady] = useState(false)
  const [conflicts, setConflicts] = useState<Array<{ id: string; entityType: string; entityId: string }>>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await action() } catch (caught) { setError(messageOf(caught)) } finally { setBusy(false) }
  }

  const renderAuthPanel = (title: string, description: string) => (
    <div className="sync-panel">
      <div><strong>{title}</strong>
        <p>{description}</p></div>
      <label>Email<input className="input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      {mode !== 'reset' ? <label>Password<input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} /></label> : null}
      {error ? <p className="sync-error" role="alert">{error}</p> : null}
      {notice ? <p className="sync-notice" role="status">{notice}</p> : null}
      <button className="button-primary" disabled={busy} onClick={() => void run(async () => {
        if (mode === 'login') await auth.signIn(email, password)
        else if (mode === 'signup') { const result = await auth.signUp(email, password); setNotice(result.session ? 'Account created.' : 'Check your email to confirm your account.') }
        else { await auth.requestPasswordReset(email); setNotice('Password reset email sent.'); setMode('login') }
      })}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : mode === 'signup' ? 'Sign up' : 'Send reset email'}</button>
      <div className="sync-inline-actions">
        <button onClick={() => setMode(mode === 'signup' ? 'login' : 'signup')}>{mode === 'signup' ? 'I already have an account' : 'Create account'}</button>
        <button onClick={() => setMode(mode === 'reset' ? 'login' : 'reset')}>{mode === 'reset' ? 'Back to login' : 'Forgot password?'}</button>
      </div>
    </div>
  )

  const loadHouseholds = async () => {
    if (!householdsRepository) return
    const [values, persistedId] = await Promise.all([householdsRepository.list(), getActiveHouseholdId()])
    setHouseholds(values)
    setActive((current) => {
      const preferredId = current?.household.id ?? persistedId ?? state.household.id
      return values.find((item) => item.household.id === preferredId) ?? values[0] ?? null
    })
  }

  const acceptInvitation = async () => {
    if (!householdsRepository || !client) return
    const joined = inviteOnly && acceptedInvitation ? acceptedInvitation : await householdsRepository.acceptInvite(inviteToken)
    if (inviteOnly) setAcceptedInvitation(joined)
    setHouseholds((items) => items.some((item) => item.household.id === joined.household.id) ? items : [...items, joined])
    setActive(joined)

    if (inviteOnly) {
      const coordinator = await activateSyncRuntime(client, joined.household.id, { openRemoteIfNeeded: true })
      const [isReady, snapshot] = await Promise.all([
        coordinator.isReady(),
        loadHouseholdState(joined.household.id),
      ])
      if (!isReady || !snapshot) throw new Error('The shared household could not be loaded. Please try again.')
      onStateChanged(snapshot)
      onInviteAccepted?.(joined)
      return
    }

    setInviteToken('')
    const url = new URL(window.location.href)
    url.searchParams.delete('invite')
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
    setNotice('Invitation accepted.')
  }

  const renderInvitationPanel = () => (
    <details open={Boolean(inviteToken)}>
      <summary>Join with an invitation</summary>
      <div className="sync-form-grid">
        <label>Invitation token<input className="input" value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} /></label>
        <button className="button-secondary" disabled={busy || !inviteToken} onClick={() => void run(acceptInvitation)}>Accept invitation</button>
      </div>
    </details>
  )

  useEffect(() => {
    if (authOnly) return
    if (!client) return
    let hadSession = false
    void auth.session().then((value) => {
      hadSession = Boolean(value); setSession(value); setLoading(false)
      if (value && !inviteOnly) void loadHouseholds().catch((caught) => setError(messageOf(caught)))
    }).catch((caught) => { setError(messageOf(caught)); setLoading(false) })
    return auth.onAuthStateChange((event, value) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      if (event === 'SIGNED_OUT' && hadSession) setSessionExpired(true)
      if (value) { hadSession = true; setSessionExpired(false); if (!inviteOnly) void loadHouseholds().catch((caught) => setError(messageOf(caught))) }
      else { setHouseholds([]); setActive(null) }
      setSession(value)
    })
  }, [auth, client, authOnly, inviteOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (inviteOnly || !active || !client || !householdsRepository) return
    let cancelled = false
    void (async () => {
      const coordinator = await activateSyncRuntime(client, active.household.id, { openRemoteIfNeeded: true })
      const [isReady, memberList] = await Promise.all([coordinator.isReady(), householdsRepository.members(active.household.id)])
      if (cancelled) return
      setReady(isReady); setMembers(memberList)
      const unresolved = await webDatabase.syncConflicts.where('householdId').equals(active.household.id).filter((item) => item.status === 'unresolved').toArray()
      setConflicts(unresolved.map(({ id, entityType, entityId }) => ({ id, entityType, entityId })))
    })().catch((caught) => { if (!cancelled) setError(messageOf(caught)) })
    return () => { cancelled = true }
  }, [active, client, householdsRepository, inviteOnly])

  if (!syncConfiguration.enabled) {
    return <div className="sync-panel"><strong>Local only</strong><p>{syncConfiguration.message}</p></div>
  }
  if (isTauriRuntime()) {
    return <div className="sync-panel"><strong>Local only on desktop</strong><p>SQLite remains active. Shared sync is enabled in the web/PWA runtime during this phase.</p></div>
  }
  if (authOnly) {
    return renderAuthPanel('Sign in to share', 'Cloud access is enabled for this web/PWA session. Sign in to continue.')
  }
  if (loading) return <div className="sync-panel" aria-busy="true"><strong>Loading account…</strong></div>

  if (!session) {
    return renderAuthPanel(
      sessionExpired ? 'Session expired' : mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Sign in to share',
      sessionExpired ? 'Sign in again. Your local data was not changed.' : 'Cloud access is optional; local planning keeps working offline.',
    )
  }

  if (passwordRecovery) {
    return <div className="sync-panel"><strong>Choose a new password</strong><p>Your local financial data is unchanged.</p>
      <label>New password<input className="input" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      <button className="button-primary" disabled={busy} onClick={() => void run(async () => { await auth.updatePassword(password); setPassword(''); setPasswordRecovery(false); setNotice('Password updated.') })}>Update password</button>
      {error ? <p className="sync-error" role="alert">{error}</p> : null}
    </div>
  }

  if (inviteOnly) {
    return <div className="sync-panel">
      <div><strong>Accept invitation</strong><p>Join the shared household before setting up local data on this device.</p></div>
      {renderInvitationPanel()}
      {error ? <p className="sync-error" role="alert">{error}</p> : null}
    </div>
  }

  return <div className="sync-panel">
    <div className="sync-panel-heading"><div><strong>Shared household</strong><p>{session.user.email}</p></div><button className="button-ghost" disabled={busy} onClick={() => void run(async () => { deactivateSyncRuntime(); await auth.signOut(); setSessionExpired(false) })}>Log out</button></div>
    {households.length ? <><label>Household<select className="select" value={active?.household.id ?? ''} onChange={(event) => { setReady(false); setMigration(null); setActive(households.find((item) => item.household.id === event.target.value) ?? null) }}>{households.map((item) => <option key={item.household.id} value={item.household.id}>{item.household.name}</option>)}</select></label><button className="button-secondary" disabled={busy} onClick={() => setCreatingHousehold((value) => !value)}>Create another household</button></> : null}
    {!households.length || creatingHousehold ? <div className="sync-form-grid">
      <label>Household name<input className="input" value={householdName} onChange={(event) => setHouseholdName(event.target.value)} /></label>
      <label>Your name<input className="input" value={ownerName} onChange={(event) => setOwnerName(event.target.value)} /></label>
      <button className="button-primary" disabled={busy} onClick={() => void run(async () => {
        if (!householdsRepository) return
        const household = { ...state.household, id: crypto.randomUUID(), name: householdName.trim() || state.household.name, createdAt: new Date().toISOString() }
        const created = await householdsRepository.create(household, ownerName)
        setHouseholds((items) => [...items, created]); setActive(created); setCreatingHousehold(false); setNotice('Household created. Local data has not been uploaded.')
      })}>Create household</button>
    </div> : null}

    {renderInvitationPanel()}

    {active ? <>
      <div className="sync-members"><strong>Members</strong>{members.map((member) => <div key={member.id}><span>{member.name} · {member.role}</span>{active.membership.role === 'owner' && member.role !== 'owner' ? <button onClick={() => void run(async () => { await householdsRepository?.removeMember(active.household.id, member.id); setMembers(await householdsRepository!.members(active.household.id)) })}>Remove</button> : null}</div>)}</div>
      {active.membership.role === 'owner' ? <div className="sync-form-grid"><label>Invite by email<input className="input" type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label><button className="button-secondary" disabled={busy || !inviteEmail} onClick={() => void run(async () => {
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
        const created = await householdsRepository!.createInvite(active.household.id, inviteEmail, expiresAt)
        setCreatedInvite(buildInvitationUrl(created.token)); setInviteEmail('')
      })}>Create 48-hour invite</button>{createdInvite ? <label>One-time invitation URL<input className="input" readOnly value={createdInvite} onFocus={(event) => event.currentTarget.select()} /></label> : null}</div> : null}

      {!ready ? <div className="sync-migration"><strong>Upload current local data to household</strong><p>This is explicit: HomeCoin will create a JSON backup, check duplicate IDs, and only then queue individual entities.</p>
        {!migration ? <button className="button-primary" disabled={busy} onClick={() => void run(async () => {
          const coordinator = activeSyncCoordinator(); if (!coordinator) return
          const candidate = moveLocalStateToHousehold(state, active.household, members)
          setMigration(await coordinator.prepareLocalMigration(candidate))
        })}>Review local data</button> : <div className="sync-migration-summary">
          <p>Accounts: {migration.counts.accounts} · Categories: {migration.counts.categories} · Transactions: {migration.counts.transactions} · Recurrences: {migration.counts.recurringRules}</p>
          <p>Duplicate IDs detected: {migration.duplicateEntityKeys.length}</p>
          <div className="sync-inline-actions"><button className="button-primary" disabled={busy} onClick={() => void run(async () => {
            const coordinator = activeSyncCoordinator(); if (!coordinator) return
            const backup = await serializeBackup(state)
            downloadText(backup, `homecoin-before-sync-${new Date().toISOString().slice(0, 10)}.json`)
            const migrated = moveLocalStateToHousehold(state, active.household, members)
            const saved = await saveState(migrated); onStateChanged(saved)
            await coordinator.uploadLocalState(saved, migration); await coordinator.pull(); await coordinator.startRealtime()
            setReady(true); setMigration(null); setNotice('Local entities were queued and the backup was downloaded.')
          })}>Create backup and upload</button><button className="button-ghost" onClick={() => setMigration(null)}>Cancel</button></div>
        </div>}
      </div> : <div className="sync-ready"><strong>Sync active</strong><p>Push/pull is ready. Realtime supplements it after reconciliation.</p><button className="button-secondary" disabled={busy} onClick={() => void run(async () => {
        const coordinator = activeSyncCoordinator(); await coordinator?.retryFailed(); await coordinator?.pull()
        const unresolved = await webDatabase.syncConflicts.where('householdId').equals(active.household.id).filter((item) => item.status === 'unresolved').toArray()
        setConflicts(unresolved.map(({ id, entityType, entityId }) => ({ id, entityType, entityId })))
      })}>Sync now</button></div>}

      {conflicts.length ? <div className="sync-conflicts"><strong>Conflicts</strong>{conflicts.map((conflict) => <div key={conflict.id}><span>{conflict.entityType} · {conflict.entityId}</span><div><button onClick={() => void run(async () => { await activeSyncCoordinator()?.resolveConflict(conflict.id, 'keep-mine'); setConflicts((items) => items.filter((item) => item.id !== conflict.id)) })}>Keep mine</button><button onClick={() => void run(async () => { await activeSyncCoordinator()?.resolveConflict(conflict.id, 'use-remote'); setConflicts((items) => items.filter((item) => item.id !== conflict.id)) })}>Use remote</button><button onClick={() => void run(async () => { await activeSyncCoordinator()?.resolveConflict(conflict.id, 'cancel'); setConflicts((items) => items.filter((item) => item.id !== conflict.id)) })}>Cancel</button></div></div>)}</div> : null}
      <button className="button-ghost sync-leave" disabled={busy} onClick={() => void run(async () => { await householdsRepository?.leave(active.household.id); deactivateSyncRuntime(); await loadHouseholds(); setNotice('You left the household. Local data was preserved.') })}>Leave household</button>
    </> : null}
    {error ? <p className="sync-error" role="alert">{error}</p> : null}{notice ? <p className="sync-notice" role="status">{notice}</p> : null}
  </div>
}
