// Animal types shown at events, and the species-appropriate vet fields captured
// per animal. First-class "column" fields live on the contestant row; the rest
// live in contestants.vet_data (jsonb), rendered dynamically by species.

export const ANIMAL_TYPES = ['Horses', 'Cattle', 'Sheep / Goats', 'Other livestock']

// First-class animal columns (apply to every species).
export const ANIMAL_FIELDS = [
  { key: 'breed', label: 'Breed', type: 'text' },
  { key: 'sex', label: 'Sex', type: 'text', placeholder: 'e.g. Mare / Gelding / Bull / Steer' },
  { key: 'birth_year', label: 'Birth year', type: 'number' },
  { key: 'color', label: 'Color / markings', type: 'text' },
  { key: 'id_number', label: 'Registration / tag / microchip #', type: 'text' }
]

// Vet/health fields written into vet_data. `common` applies to all species.
const VET = {
  common: [
    { key: 'cvi_date', label: 'Health certificate (CVI) date', type: 'date' },
    { key: 'cvi_vet', label: 'Health certificate — issuing vet/clinic', type: 'text' },
    { key: 'vet_name', label: 'Attending veterinarian', type: 'text' },
    { key: 'vet_phone', label: 'Veterinarian phone', type: 'text' }
  ],
  Horses: [
    { key: 'coggins_date', label: 'Coggins / EIA test date', type: 'date' },
    { key: 'coggins_result', label: 'Coggins result', type: 'select', options: ['', 'Negative', 'Positive'] },
    { key: 'coggins_lab', label: 'Coggins lab', type: 'text' },
    { key: 'coggins_accession', label: 'Coggins accession #', type: 'text' },
    { key: 'vacc_eeewee', label: 'EEE / WEE vaccine date', type: 'date' },
    { key: 'vacc_tetanus', label: 'Tetanus vaccine date', type: 'date' },
    { key: 'vacc_wnv', label: 'West Nile vaccine date', type: 'date' },
    { key: 'vacc_rabies', label: 'Rabies vaccine date', type: 'date' },
    { key: 'vacc_flurhino', label: 'Flu / Rhino vaccine date', type: 'date' }
  ],
  Cattle: [
    { key: 'bangs', label: 'Brucellosis (Bangs) tag / date', type: 'text' },
    { key: 'tb_test', label: 'TB test date', type: 'date' },
    { key: 'trich_test', label: 'Trichomoniasis test (bulls) date', type: 'date' },
    { key: 'brand_inspection', label: 'Brand inspection #', type: 'text' },
    { key: 'ear_tag', label: 'Ear tag / EID', type: 'text' }
  ],
  'Sheep / Goats': [
    { key: 'scrapie_id', label: 'Scrapie flock ID / tag', type: 'text' },
    { key: 'premises_id', label: 'Premises ID', type: 'text' }
  ],
  'Other livestock': [
    { key: 'vaccinations', label: 'Vaccinations (list)', type: 'text' },
    { key: 'health_notes', label: 'Health notes', type: 'text' }
  ]
}

export const vetFieldsFor = (species) => [...VET.common, ...(VET[species] || [])]

// The headline compliance value for the vet report, by species.
export function complianceSummary(species, vet) {
  const v = vet || {}
  if (species === 'Horses') {
    return { label: 'Coggins', value: v.coggins_date ? `${v.coggins_result || 'on file'} · ${v.coggins_date}` : 'Missing', ok: !!v.coggins_date }
  }
  return { label: 'Health cert', value: v.cvi_date || 'Missing', ok: !!v.cvi_date }
}
