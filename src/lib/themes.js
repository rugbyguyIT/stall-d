// Seven popular color schemes selectable per portal in the master console.
// Each scheme is a named accent; wash (light tint) + deep (dark text) are
// derived at runtime by theme() in PortalContext, so a scheme is fully defined
// by its accent hex. Accents are chosen dark enough for white button text.
export const COLOR_SCHEMES = [
  { name: 'Classic Blue',  accent: '#2a78d6' },
  { name: 'Rodeo Red',     accent: '#c62828' },
  { name: 'Arena Green',   accent: '#1b8a5a' },
  { name: 'Saddle Brown',  accent: '#8a5a2b' },
  { name: 'Midnight Navy', accent: '#34406b' },
  { name: 'Sunset Orange', accent: '#d2601a' },
  { name: 'Royal Plum',    accent: '#7b3f98' }
]

export const schemeByAccent = (hex) =>
  COLOR_SCHEMES.find((s) => s.accent.toLowerCase() === (hex || '').toLowerCase())

/** Public URL for a portal logo stored in the public `portal-logos` bucket. */
export function logoUrl(supabase, logoPath) {
  if (!logoPath) return null
  return supabase.storage.from('portal-logos').getPublicUrl(logoPath).data.publicUrl
}
