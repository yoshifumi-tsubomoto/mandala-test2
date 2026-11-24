import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL, isDemoMode } from './config'

// 体験モードでは Supabase につながない（null になる）
export const supabase: SupabaseClient | null = isDemoMode
  ? null
  : createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
