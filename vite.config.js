import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// envPrefix includes SUPABASE_ so the Netlify env vars SUPABASE_URL and
// SUPABASE_ANON_KEY are exposed to the client bundle without a VITE_ rename.
// (The anon key is public by design; RLS is the security boundary.)
export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'SUPABASE_'],
  build: { outDir: 'dist', sourcemap: false }
})
