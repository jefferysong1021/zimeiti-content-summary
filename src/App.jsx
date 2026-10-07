import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'

const DAILY_GENERATION_LIMIT = 10
const SUMMARY_REFERENCE_WIDE = '/summary-reference-wide.png'
const SUMMARY_REFERENCE_PORTRAIT = '/summary-reference-portrait.png'

function getChinaDayStart() {
  const chinaDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  return new Date(`${chinaDate}T00:00:00+08:00`).toISOString()
}

function App() {
  const [session, setSession] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  const [sourceText, setSourceText] = useState('')
  const [contentType, setContentType] = useState('文章总结')
  const [targetReader, setTargetReader] = useState('普通用户')
  const [writingStyle, setWritingStyle] = useState('干货清晰')
  const [result, setResult] = useState('')
  const [generationError, setGenerationError] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const [usage, setUsage] = useState({
    used: 0,
    limit: DAILY_GENERATION_LIMIT,
    remaining: DAILY_GENERATION_LIMIT,
  })
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState('')
  const [images, setImages] = useState([])
  const [imageError, setImageError] = useState('')
  const [isGeneratingImage, setIsGeneratingImage] = useState(false)

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (mounted) {
        setSession(currentSession)
        setAuthReady(true)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession)
      setAuthReady(true)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) {
      return
    }

    async function loadHistory() {
      setHistoryLoading(true)
      setHistoryError('')
      setUsageLoading(true)
      setUsageError('')

      const [historyResponse, usageResponse] = await Promise.all([
        supabase
          .from('generation_records')
          .select('id, content_type, target_reader, writing_style, result, created_at')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('generation_records')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', session.user.id)
          .gte('created_at', getChinaDayStart()),
      ])

      setHistoryLoading(false)
      setUsageLoading(false)

      if (!historyResponse.error) {
        setHistory(historyResponse.data ?? [])
      } else {
        setHistoryError(`历史记录读取失败：${historyResponse.error.message}`)
      }

      if (!usageResponse.error) {
        const used = usageResponse.count ?? 0
        setUsage({
          used,
          limit: DAILY_GENERATION_LIMIT,
          remaining: Math.max(DAILY_GENERATION_LIMIT - used, 0),
        })
      } else {
        setUsageError(`次数读取失败：${usageResponse.error.message}`)
      }
    }

    loadHistory()
  }, [session])

  async function handleAuth(event) {
    event.preventDefault()
    setAuthMessage('')

    if (!email.trim() || !password) {
      setAuthMessage('请输入邮箱和密码。')
      return
    }

    if (password.length < 6) {
      setAuthMessage('密码至少需要6位。')
      return
    }

    setAuthLoading(true)

    const response =
      authMode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })

    setAuthLoading(false)

    if (response.error) {
      setAuthMessage(response.error.message)
      return
    }

    if (authMode === 'signup' && !response.data.session) {
      setAuthMessage('注册成功，请检查邮箱并完成验证后再登录。')
    } else {
      setAuthMessage('操作成功。')
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    setResult('')
    setImages([])
  }

  async function handleGenerate(event) {
    event.preventDefault()
    setGenerationError('')

    if (!sourceText.trim()) {
      setResult('请先输入需要总结的内容。')
      return
    }

    if (usage.remaining <= 0) {
      setGenerationError('今日免费生成次数已用完，请明天再试。')
      return
    }

    setIsGenerating(true)
    setCopyMessage('')

    const { data, error } = await supabase.functions.invoke('generate-xhs', {
      body: {
        source_text: sourceText,
        content_type: contentType,
        target_reader: targetReader,
        writing_style: writingStyle,
      },
    })

    setIsGenerating(false)

    if (error) {
      const serverMessage = await readFunctionError(error)
      const status = error.context?.status ? `HTTP ${error.context.status}：` : ''
      setGenerationError(`生成失败：${status}${serverMessage || error.message}`)
      return
    }

    if (data?.error) {
      if (data.usage) {
        setUsage(data.usage)
      }
      setGenerationError(`生成失败：${data.error}`)
      return
    }

    const finalResult = data?.result || '服务没有返回内容，请稍后再试。'
    setResult(finalResult)

    if (data?.usage) {
      setUsage(data.usage)
    }

    const { data: savedRecord, error: saveError } = await supabase
      .from('generation_records')
      .insert({
        user_id: session.user.id,
        source_text: sourceText,
        content_type: contentType,
        target_reader: targetReader,
        writing_style: writingStyle,
        result: finalResult,
      })
      .select('id, content_type, target_reader, writing_style, result, created_at')
      .single()

    if (saveError) {
      setGenerationError(`内容已生成，但历史保存失败：${saveError.message}`)
      return
    }

    setHistory((currentHistory) => [savedRecord, ...currentHistory].slice(0, 10))
  }

  async function handleGenerateImage() {
    setImageError('')

    if (!result.trim()) {
      setImageError('请先生成小红书文字内容。')
      return
    }

    setIsGeneratingImage(true)
    setImages([])

    const { data, error } = await supabase.functions.invoke('generate-xhs-image', {
      body: {
        content: result,
        image_style: writingStyle,
        image_count: 1,
      },
    })

    setIsGeneratingImage(false)

    if (error) {
      const serverMessage = await readFunctionError(error)
      const status = error.context?.status ? `HTTP ${error.context.status}：` : ''
      setImageError(`配图失败：${status}${serverMessage || error.message}`)
      return
    }

    if (data?.error) {
      setImageError(`配图失败：${data.error}`)
      return
    }

    setImages(data?.images ?? [])
  }

  async function handleCopyResult() {
    if (!result) return

    try {
      await navigator.clipboard.writeText(result)
      setCopyMessage('已复制到剪贴板')
    } catch {
      setCopyMessage('复制失败，请手动选择文字复制')
    }
  }

  function handleDownloadResult() {
    if (!result) return

    const file = new Blob([result], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = `小红书内容-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function readFunctionError(error) {
    if (!(error.context instanceof Response)) return ''

    try {
      const body = await error.context.clone().json()
      return body?.error || ''
    } catch {
      return ''
    }
  }

  if (!authReady) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#030505] px-4 text-sm text-muted">
        正在确认登录状态……
      </div>
    )
  }

  if (!session) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-mesh-dark px-4 py-10 text-ink">
        <main className="w-full max-w-md rounded-[20px] border border-white/10 bg-black/30 p-7 shadow-glass backdrop-blur-xl sm:p-9">
          <div className="mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-neon text-xl font-black tracking-[-0.08em] text-[#061008] shadow-neon">媒</div>
          <p className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.2em] text-neon-strong">CONTENT COPILOT</p>
          <h1 className="text-3xl font-extrabold tracking-[-0.06em] text-white">媒体内容总结助手</h1>
          <p className="mt-3 text-sm leading-6 text-muted">登录后整理文章、笔记和视频文案。</p>

          <div className="mt-7 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1" role="tablist">
            <button
              className={`rounded-lg px-3 py-2.5 text-sm font-bold transition ${authMode === 'login' ? 'bg-neon text-[#061008]' : 'text-muted hover:bg-white/[0.06] hover:text-white'}`}
              type="button"
              onClick={() => {
                setAuthMode('login')
                setAuthMessage('')
              }}
            >
              登录
            </button>
            <button
              className={`rounded-lg px-3 py-2.5 text-sm font-bold transition ${authMode === 'signup' ? 'bg-neon text-[#061008]' : 'text-muted hover:bg-white/[0.06] hover:text-white'}`}
              type="button"
              onClick={() => {
                setAuthMode('signup')
                setAuthMessage('')
              }}
            >
              注册
            </button>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleAuth}>
            <label className="block text-sm font-semibold text-white/85" htmlFor="auth-email">邮箱</label>
            <input
              className="-mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white placeholder:text-muted outline-none transition focus:border-neon-strong focus:shadow-[0_0_0_3px_rgba(120,255,156,0.12)]"
              id="auth-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />

            <label className="block text-sm font-semibold text-white/85" htmlFor="auth-password">密码</label>
            <input
              className="-mt-2 h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white placeholder:text-muted outline-none transition focus:border-neon-strong focus:shadow-[0_0_0_3px_rgba(120,255,156,0.12)]"
              id="auth-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少6位"
              autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
            />

            <button className="mt-2 flex min-h-12 w-full items-center justify-center rounded-xl bg-neon px-5 text-sm font-extrabold text-[#061008] shadow-neon transition hover:bg-neon-strong active:scale-[0.99] disabled:cursor-wait disabled:opacity-60" type="submit" disabled={authLoading}>
              {authLoading ? '处理中……' : authMode === 'login' ? '登录' : '创建账号'}
            </button>
          </form>

          {authMessage && (
            <p className="mt-4 rounded-lg border border-neon/20 bg-neon/[0.06] px-3 py-2 text-sm leading-6 text-neon" aria-live="polite">
              {authMessage}
            </p>
          )}

          <p className="mt-6 text-xs text-muted">当前使用 Supabase 邮箱认证。</p>
        </main>
      </div>
    )
  }

  return (
    <div className="relative min-h-dvh overflow-hidden bg-mesh-dark px-4 py-5 text-ink sm:px-6 lg:px-10">
      <div className="pointer-events-none absolute -left-24 top-24 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-24 top-[38rem] h-96 w-96 rounded-full bg-emerald-300/[0.06] blur-3xl" aria-hidden="true" />

      <header className="sticky top-4 z-10 mx-auto grid max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-white/10 bg-[#07100c]/80 px-4 py-3 shadow-glass backdrop-blur-xl sm:gap-4 sm:px-5">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-neon text-lg font-black tracking-[-0.08em] text-[#061008] shadow-neon">媒</div>
        <div className="min-w-0">
          <p className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.2em] text-neon-strong">CONTENT COPILOT</p>
          <h1 className="truncate text-xl font-extrabold tracking-[-0.05em] text-white sm:text-2xl">媒体内容总结助手</h1>
          <p className="mt-1 hidden text-xs text-muted sm:block">小红书内容生成助手，把长内容整理成可读、可用的笔记</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted sm:gap-3">
          <span className="hidden max-w-40 truncate sm:block">{session.user.email}</span>
          <button className="rounded-lg border border-white/10 px-3 py-2 font-semibold text-white/75 transition hover:border-neon/40 hover:text-neon" type="button" onClick={handleLogout}>
            退出
          </button>
        </div>
      </header>

      <div className="mx-auto mt-5 grid max-w-7xl gap-3 md:grid-cols-[1.5fr_0.5fr]">
        <div className="relative h-28 overflow-hidden rounded-2xl border border-white/10 bg-black/25 shadow-glass">
          <img className="h-full w-full object-cover opacity-45 mix-blend-screen" src={SUMMARY_REFERENCE_WIDE} alt="内容总结助手视觉参考" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#07100c] via-[#07100c]/55 to-transparent" />
          <div className="absolute inset-y-0 left-5 flex max-w-xs flex-col justify-center">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-neon-strong">Visual reference</p>
            <p className="mt-1 text-sm font-semibold text-white">把复杂内容整理成清晰的下一步</p>
          </div>
        </div>
        <div className="relative hidden h-28 overflow-hidden rounded-2xl border border-white/10 bg-black/25 shadow-glass md:block">
          <img className="h-full w-full object-cover object-[center_38%] opacity-55 mix-blend-screen" src={SUMMARY_REFERENCE_PORTRAIT} alt="内容生成视觉参考" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#07100c] via-transparent to-transparent" />
          <span className="absolute bottom-3 left-4 text-xs font-semibold text-white/80">文案与配图，一起完成</span>
        </div>
      </div>

      <main className="mx-auto grid max-w-7xl items-start gap-5 pt-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-[20px] border border-white/10 bg-black/25 p-5 shadow-glass backdrop-blur-xl sm:p-7">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted">先放进素材</p>
              <h2 className="text-2xl font-extrabold tracking-[-0.04em] text-white">输入内容</h2>
            </div>
            <span className="shrink-0 rounded-full border border-neon/20 bg-neon/[0.07] px-2.5 py-1.5 text-[11px] font-bold text-neon">
              {usageLoading ? '读取额度……' : `今日剩余 ${usage.remaining}/${usage.limit} 次`}
            </span>
          </div>

          <form className="space-y-5" onSubmit={handleGenerate}>
            <label className="block text-sm font-semibold text-white/85" htmlFor="source-text">原始内容</label>
            <textarea
              className="-mt-3 min-h-[245px] w-full resize-y rounded-2xl border border-white/10 bg-black/25 p-4 text-sm leading-7 text-white placeholder:text-muted outline-none transition focus:border-neon-strong focus:shadow-[0_0_0_3px_rgba(120,255,156,0.12)]"
              id="source-text"
              value={sourceText}
              onChange={(event) => setSourceText(event.target.value)}
              placeholder="粘贴文章、课程笔记、新闻或视频文案……"
              rows={11}
            />
            <div className="-mt-3 flex justify-between gap-3 text-[11px] text-muted">
              <span>支持文章、笔记、新闻和视频文案</span>
              <span>{sourceText.length.toLocaleString()} 字</span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-white/85" htmlFor="content-type">内容类型</label>
                <select
                  className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white outline-none transition focus:border-neon-strong focus:shadow-[0_0_0_3px_rgba(120,255,156,0.12)]"
                  id="content-type"
                  value={contentType}
                  onChange={(event) => setContentType(event.target.value)}
                >
                  <option>文章总结</option>
                  <option>书籍笔记</option>
                  <option>课程内容</option>
                  <option>新闻资讯</option>
                  <option>产品介绍</option>
                  <option>视频文案</option>
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-white/85" htmlFor="target-reader">目标读者</label>
                <input
                  className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-muted outline-none transition focus:border-neon-strong focus:shadow-[0_0_0_3px_rgba(120,255,156,0.12)]"
                  id="target-reader"
                  value={targetReader}
                  onChange={(event) => setTargetReader(event.target.value)}
                  placeholder="例如：职场新人"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="mb-2 block text-sm font-semibold text-white/85" htmlFor="writing-style">写作风格</label>
                <select
                  className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white outline-none transition focus:border-neon-strong focus:shadow-[0_0_0_3px_rgba(120,255,156,0.12)]"
                  id="writing-style"
                  value={writingStyle}
                  onChange={(event) => setWritingStyle(event.target.value)}
                >
                  <option>干货清晰</option>
                  <option>轻松活泼</option>
                  <option>专业理性</option>
                  <option>故事感</option>
                  <option>情绪共鸣</option>
                </select>
              </div>
            </div>

            <button className="flex min-h-14 w-full items-center justify-between rounded-xl bg-neon px-5 text-sm font-extrabold text-[#061008] shadow-neon transition hover:bg-neon-strong active:scale-[0.99] disabled:cursor-wait disabled:opacity-60" type="submit" disabled={isGenerating}>
              <span>{isGenerating ? '正在整理内容……' : '生成小红书内容'}</span>
              <span className="grid h-7 w-7 place-items-center rounded-full border border-black/20 text-lg transition group-hover:-translate-y-0.5" aria-hidden="true">↗</span>
            </button>
            {generationError && (
              <p className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm leading-6 text-white/70" aria-live="polite">
                {generationError}
              </p>
            )}
            {usageError && <p className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm leading-6 text-white/70">{usageError}</p>}
            <p className="text-xs text-muted">每位用户每天免费生成 {usage.limit} 次。</p>
          </form>
        </section>

        <section className="rounded-[20px] border border-white/10 bg-black/25 p-5 shadow-glass backdrop-blur-xl sm:p-7">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="mb-1 text-xs font-semibold tracking-wide text-muted">内容成稿后可继续配图</p>
              <h2 className="text-2xl font-extrabold tracking-[-0.04em] text-white">生成结果</h2>
            </div>
            {result && <span className="shrink-0 rounded-full border border-neon/20 bg-neon/[0.07] px-2.5 py-1.5 text-[11px] font-bold text-neon">已生成</span>}
          </div>

          <div className={`min-h-[540px] max-h-[690px] overflow-auto rounded-2xl border p-5 ${result ? 'border-white/10 bg-black/20' : 'border-dashed border-white/15 bg-black/20'}`} aria-live="polite">
            {isGenerating ? (
              <div className="flex min-h-[490px] flex-col items-center justify-center text-center">
                <div className="grid w-full max-w-xs gap-3" aria-hidden="true">
                  <span className="h-2 animate-pulse rounded-full bg-white/10" />
                  <span className="h-2 w-[88%] animate-pulse rounded-full bg-white/10" />
                  <span className="h-2 w-[94%] animate-pulse rounded-full bg-white/10" />
                  <span className="h-2 w-[76%] animate-pulse rounded-full bg-white/10" />
                  <span className="h-2 w-[63%] animate-pulse rounded-full bg-white/10" />
                </div>
                <p className="mt-5 text-sm text-muted">正在根据你的素材整理结构和表达</p>
              </div>
            ) : result ? (
              <pre className="m-0 whitespace-pre-wrap break-words font-sans text-sm leading-7 text-white/80">{result}</pre>
            ) : (
              <div className="flex min-h-[490px] flex-col items-center justify-center text-center">
                <div className="mb-5 grid h-12 w-12 place-items-center rounded-full border border-neon/30 bg-neon/[0.08] text-xs font-extrabold tracking-widest text-neon" aria-hidden="true">AI</div>
                <h3 className="text-lg font-bold text-white">成稿会出现在这里</h3>
                <p className="mt-2 max-w-xs text-sm leading-6 text-muted">先输入素材，生成后可以复制、下载或继续生成配图。</p>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              className="rounded-lg border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm font-semibold text-white/75 transition hover:border-white/25 hover:bg-white/[0.06] hover:text-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
              type="button"
              onClick={handleCopyResult}
              disabled={!result}
            >
              复制内容
            </button>
            <button
              className="rounded-lg border border-white/10 bg-black/20 px-3.5 py-2.5 text-sm font-semibold text-white/75 transition hover:border-white/25 hover:bg-white/[0.06] hover:text-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
              type="button"
              onClick={handleDownloadResult}
              disabled={!result}
            >
              下载 TXT
            </button>
            <button
              className="rounded-lg border border-neon/30 bg-neon/[0.08] px-3.5 py-2.5 text-sm font-semibold text-neon transition hover:bg-neon hover:text-[#061008] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
              type="button"
              onClick={handleGenerateImage}
              disabled={!result || isGeneratingImage}
            >
              {isGeneratingImage ? '正在生成配图……' : '生成配图'}
            </button>
            {copyMessage && <span className="text-xs text-neon" aria-live="polite">{copyMessage}</span>}
          </div>

          {imageError && (
            <p className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm leading-6 text-white/70" aria-live="polite">
              {imageError}
            </p>
          )}

          {isGeneratingImage && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-neon/20 bg-neon/[0.06] px-3.5 py-3 text-sm text-neon" aria-live="polite">
              <span className="h-2 w-2 animate-pulse rounded-full bg-neon shadow-[0_0_0_5px_rgba(120,255,156,0.12)]" aria-hidden="true" />
              <span>正在根据文案准备配图……</span>
            </div>
          )}

          {images.length > 0 && (
            <div className="mt-6 border-t border-white/10 pt-5">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="text-base font-bold text-white">AI 配图</h3>
                <span className="text-[11px] text-muted">图片链接约24小时有效</span>
              </div>
              <div className="grid gap-3">
                {images.map((image) => (
                  <figure className="overflow-hidden rounded-xl border border-white/10 bg-black/20" key={image.url}>
                    <img className="block max-h-[620px] w-full bg-black/30 object-contain" src={image.url} alt="AI 生成的小红书配图" />
                    <figcaption className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs text-muted">
                      <span>{image.size || 'AI 生成图片'}</span>
                      <a className="font-bold text-neon transition hover:text-neon-strong hover:underline" href={image.url} target="_blank" rel="noreferrer">
                        打开原图
                      </a>
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      <section className="mx-auto mt-5 max-w-7xl rounded-[20px] border border-white/10 bg-black/25 p-5 shadow-glass backdrop-blur-xl sm:p-7">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-semibold tracking-wide text-muted">方便下次继续使用</p>
            <h2 className="text-2xl font-extrabold tracking-[-0.04em] text-white">最近生成记录</h2>
          </div>
          <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-bold text-white/65">最近 10 条</span>
        </div>

        {historyLoading ? (
          <p className="py-4 text-sm text-muted">正在读取历史记录……</p>
        ) : historyError ? (
          <p className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm leading-6 text-white/70" aria-live="polite">
            {historyError}
          </p>
        ) : history.length === 0 ? (
          <p className="py-4 text-sm text-muted">生成内容后，最近记录会显示在这里。</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {history.map((record) => (
              <button
                className="grid w-full gap-1.5 rounded-xl border border-white/10 bg-black/20 p-4 text-left text-white/80 transition hover:-translate-y-0.5 hover:border-neon/25 hover:bg-white/[0.05]"
                key={record.id}
                type="button"
                onClick={() => setResult(record.result)}
              >
                <span className="text-[11px] font-bold text-neon/80">
                  {record.content_type} · {new Date(record.created_at).toLocaleString()}
                </span>
                <strong className="text-sm text-white">{record.target_reader} · {record.writing_style}</strong>
                <span className="overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-5 text-muted">{record.result.slice(0, 180)}……</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col gap-2 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
        <span>文本生成已接入 Dify</span>
        <span>历史记录已接入 Supabase，AI 配图已接入</span>
      </footer>
    </div>
  )
}

export default App
