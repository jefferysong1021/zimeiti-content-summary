import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DIFY_IMAGE_APP_ID = '57e53a26-42e3-4dc4-84e7-8dc0c4b3821a'

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authorization = request.headers.get('Authorization')

    if (!authorization) {
      return jsonResponse({ error: '请先登录' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseKey =
      Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? ''
    const supabase = createClient(supabaseUrl, supabaseKey)
    const difyApiKey = Deno.env.get('DIFY_IMAGE_API_KEY') ?? ''

    if (!difyApiKey) {
      return jsonResponse({ error: '图片工作流密钥尚未配置' }, 500)
    }

    const token = authorization.replace(/^Bearer\s+/i, '')
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token)

    if (userError || !user) {
      return jsonResponse({ error: '登录状态已失效，请重新登录' }, 401)
    }

    const body = await request.json()
    const content = String(body.content ?? '').trim()
    const imageStyle = String(body.image_style ?? '清新简洁').trim()
    const imageCount = Math.min(Math.max(Number(body.image_count ?? 1), 1), 1)

    if (!content) {
      return jsonResponse({ error: '请先生成小红书文字内容' }, 400)
    }

    if (content.length > 20000) {
      return jsonResponse({ error: '传给图片工作流的内容不能超过20000字' }, 400)
    }

    const difyResponse = await fetch('https://api.dify.ai/v1/workflows/run', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${difyApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: {
          content,
          image_style: imageStyle,
          image_count: imageCount,
        },
        response_mode: 'blocking',
        user: user.id,
      }),
    })

    const difyData = await difyResponse.json()

    if (!difyResponse.ok) {
      console.error('Dify image API error:', difyData)
      return jsonResponse({ error: 'Dify 图片工作流调用失败，请稍后再试' }, 502)
    }

    const images = normalizeImages(difyData?.data?.outputs?.image_result)

    if (images.length === 0) {
      console.error('Dify image workflow returned no images:', difyData)
      return jsonResponse({ error: '图片工作流没有返回有效图片' }, 502)
    }

    return jsonResponse({ images }, 200)
  } catch (error) {
    console.error('generate-xhs-image error:', error)
    return jsonResponse({ error: '图片服务发生错误，请稍后再试' }, 500)
  }
})

function normalizeImages(value: unknown): Array<{ url: string; size?: string }> {
  let parsed = value

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      const url = parsed.match(/https?:\/\/[^\s"']+/)?.[0]
      return url ? [{ url }] : []
    }
  }

  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => normalizeImages(item))
  }

  if (!parsed || typeof parsed !== 'object') return []

  const record = parsed as Record<string, unknown>

  if (record.image_result) {
    return normalizeImages(record.image_result)
  }

  if (typeof record.url === 'string' && record.url) {
    return [{
      url: record.url,
      size: typeof record.size === 'string' ? record.size : undefined,
    }]
  }

  return []
}

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}
