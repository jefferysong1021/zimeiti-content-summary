import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    '缺少 Supabase 配置，请检查项目根目录下的 .env.local 文件。',
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey)
