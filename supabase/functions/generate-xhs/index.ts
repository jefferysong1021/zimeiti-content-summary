import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DAILY_GENERATION_LIMIT = 10

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authorization = request.headers.get('Authorization')

    if (!authorization) {
      return jsonResponse({ error: '请先登录' }, 401)
    }

    const token = authorization.replace('Bearer ', '')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '',
    )
    const authenticatedSupabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '',
      { global: { headers: { Authorization: authorization } } },
    )

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token)

    if (userError || !user) {
      return jsonResponse({ error: '登录状态已失效，请重新登录' }, 401)
    }

    const body = await request.json()
    const sourceText = String(body.source_text ?? '').trim()

    if (!sourceText) {
      return jsonResponse({ error: '请输入需要总结的内容' }, 400)
    }

    if (sourceText.length > 20000) {
      return jsonResponse({ error: '输入内容不能超过20000字' }, 400)
    }

    const { count: usedCount, error: usageError } = await authenticatedSupabase
      .from('generation_records')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', getChinaDayStart())

    if (usageError) {
      console.error('Usage query error:', usageError)
      return jsonResponse({ error: '无法读取今日使用次数，请稍后再试' }, 500)
    }

    const used = usedCount ?? 0

    if (used >= DAILY_GENERATION_LIMIT) {
      return jsonResponse(
        {
          error: '今日免费生成次数已用完，请明天再试',
          usage: {
            used,
            limit: DAILY_GENERATION_LIMIT,
            remaining: 0,
          },
        },
        429,
      )
    }

    const difyResponse = await fetch('https://api.dify.ai/v1/workflows/run', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('DIFY_API_KEY') ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: {
          source_text: sourceText,
          content_type: body.content_type || '文章总结',
          target_reader: body.target_reader || '普通用户',
          writing_style: body.writing_style || '干货清晰',
        },
        response_mode: 'blocking',
        user: user.id,
      }),
    })

    const difyData = await difyResponse.json()

    if (!difyResponse.ok) {
      console.error('Dify API error:', difyData)
      return jsonResponse({ error: 'Dify 服务调用失败，请稍后再试' }, 502)
    }

    const result = difyData?.data?.outputs?.result

    if (!result) {
      console.error('Dify returned no result:', difyData)
      return jsonResponse({ error: 'Dify 没有返回生成结果' }, 502)
    }

    return jsonResponse(
      {
        result,
        usage: {
          used: used + 1,
          limit: DAILY_GENERATION_LIMIT,
          remaining: DAILY_GENERATION_LIMIT - used - 1,
        },
      },
      200,
    )
  } catch (error) {
    console.error('generate-xhs error:', error)
    return jsonResponse({ error: '服务器发生错误，请稍后再试' }, 500)
  }
})

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function getChinaDayStart() {
  const chinaDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  return new Date(`${chinaDate}T00:00:00+08:00`).toISOString()
}
