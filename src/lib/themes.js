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

// Visual skins (a separate axis from the accent color). "minimalist" is the
// default look; the others are defined as [data-style] token overrides in CSS.
export const THEME_STYLES = [
  { key: 'minimalist',    name: 'Minimalist',    swatches: ['#fcfcfb', '#e1e0d9', '#2a78d6'] },
  { key: 'western',       name: 'Western',       swatches: ['#f3ead9', '#cbb790', '#8a5a2b'] },
  { key: 'high-contrast', name: 'High contrast', swatches: ['#ffffff', '#000000', '#2a78d6'] },
  { key: 'gray-blue',     name: 'Gray / Blue',   swatches: ['#eef2f7', '#aab6c6', '#34406b'] }
]

/** Public URL for a logo stored in the public `portal-logos` bucket. */
export function logoUrl(supabase, logoPath) {
  if (!logoPath) return null
  return supabase.storage.from('portal-logos').getPublicUrl(logoPath).data.publicUrl
}

/** Facility (property) branding — name, logo, style — readable pre-auth. */
export async function fetchFacility(supabase) {
  const { data } = await supabase.rpc('facility_branding')
  return data || { name: 'Sandoval Ranch Arena', logo_path: null, style: 'minimalist' }
}
