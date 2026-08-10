type AppLocation = Pick<Location, 'origin' | 'pathname'>

const joinPathnames = (basePathname: string, currentPathname: string) => {
  const base = basePathname.replace(/\/$/, '')
  const current = currentPathname.startsWith('/') ? currentPathname : `/${currentPathname}`
  if (!base) return current
  if (current === base || current.startsWith(`${base}/`)) return current
  return `${base}${current}`
}

export function buildInvitationUrl(
  token: string,
  publicAppUrl = import.meta.env.VITE_PUBLIC_APP_URL,
  location: AppLocation = window.location,
) {
  const url = new URL(publicAppUrl?.trim() || location.origin)
  url.pathname = joinPathnames(url.pathname, location.pathname)
  url.searchParams.set('invite', token)
  return url.toString()
}
