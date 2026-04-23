import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import './App.css'

const quizFiles = import.meta.glob('./quizek/*.json', { eager: true })
const sampleModules = Object.entries(quizFiles)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, moduleData], index) => {
    const fileName = path.split('/').pop()?.replace('.json', '') || `minta_${index + 1}`
    return {
      payload: moduleData.default || moduleData,
      sourceName: `Mappa: ${fileName}`,
    }
  })

const SESSION_COOKIE = 'quiz_session_store'
const SESSION_STORAGE_KEY = 'quiz-session-store'
const STUDY_PROGRESS_STORAGE_KEY = 'quiz-study-progress-v1'
const STOP_WORDS = new Set([
  'a', 'az', 'egy', 'es', 'és', 'hogy', 'vagy', 'nem', 'ha', 'akkor', 'ami', 'mint',
  'soran', 'során', 'eseten', 'esetén', 'valamint', 'segitsegevel', 'segítségével',
])
const IMAGE_URL_PATTERN = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?.*)?(#.*)?$/i
const IMAGE_MARKER_PATTERN = /(\[img\]([\s\S]*?)\[\/img\]|\[\[img:(.*?)\]\]|!\[[^\]]*\]\((.*?)\))/gi

function parseStudyProgress() {
  try {
    const raw = localStorage.getItem(STUDY_PROGRESS_STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function clampCardIndex(nextIndex, cardsLength) {
  if (!cardsLength) {
    return 0
  }
  return Math.max(0, Math.min(cardsLength - 1, nextIndex))
}

function normalizeRouteModuleId(routeValue) {
  const raw = String(routeValue || '')
  if (!raw) {
    return ''
  }
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function isMarkedImageUrl(value) {
  const text = String(value || '').trim()
  if (!text) {
    return false
  }
  if (/^data:image\//i.test(text)) {
    return true
  }
  return isHttpUrl(text)
}

function isImageLikeContent(value) {
  const text = String(value || '').trim()
  if (!text) {
    return false
  }
  if (/^data:image\//i.test(text)) {
    return true
  }
  try {
    const parsed = new URL(text)
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:'
    return isHttp && IMAGE_URL_PATTERN.test(parsed.href)
  } catch {
    return false
  }
}

function parseCardContentParts(value) {
  const text = String(value || '')
  if (!text.trim()) {
    return []
  }

  const parts = []
  let lastIndex = 0
  let match

  while ((match = IMAGE_MARKER_PATTERN.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index)
    if (before.trim()) {
      parts.push({ type: 'text', value: before.trim() })
    }

    const markerUrl = (match[2] || match[3] || match[4] || '').trim()
    if (isMarkedImageUrl(markerUrl)) {
      parts.push({ type: 'image', value: markerUrl })
    } else if (match[0].trim()) {
      parts.push({ type: 'text', value: match[0].trim() })
    }

    lastIndex = match.index + match[0].length
  }

  const after = text.slice(lastIndex)
  if (after.trim()) {
    parts.push({ type: 'text', value: after.trim() })
  }

  if (parts.length > 0) {
    return parts
  }

  if (isImageLikeContent(text)) {
    return [{ type: 'image', value: text.trim() }]
  }
  return [{ type: 'text', value: text.trim() }]
}

function CardContent({
  value,
  alt,
  textTag = 'h2',
  textClassName = '',
  imageClassName = '',
  containerClassName = '',
}) {
  const parts = parseCardContentParts(value)
  if (parts.length === 1 && parts[0].type === 'image') {
    return <img src={parts[0].value} alt={alt} className={imageClassName} loading="lazy" />
  }
  if (parts.length === 1 && parts[0].type === 'text') {
    const TextTag = textTag
    return <TextTag className={textClassName}>{parts[0].value}</TextTag>
  }

  const TextTag = textTag
  return (
    <div className={`card-rich-content has-mixed-media ${containerClassName}`.trim()}>
      {parts.map((part, index) => (
        part.type === 'image'
          ? <img key={`${part.value}-${index}`} src={part.value} alt={alt} className={imageClassName} loading="lazy" />
          : <TextTag key={`${part.value}-${index}`} className={textClassName}>{part.value}</TextTag>
      ))}
    </div>
  )
}

// Süti mentése lejárati dátummal.
function setCookie(name, value, days = 7) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

// Süti törlése azonnal.
function clearCookie(name) {
  document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`
}

// Süti olvasása.
function getCookie(name) {
  const cookies = document.cookie ? document.cookie.split('; ') : []
  const item = cookies.find((part) => part.startsWith(`${name}=`))
  return item ? decodeURIComponent(item.split('=').slice(1).join('=')) : ''
}

// A munkamenet sütit objektummá alakítjuk.
function parseSessionCookie() {
  try {
    const raw = getCookie(SESSION_COOKIE)
    if (!raw) {
      return {}
    }
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

// Munkamenet olvasása localStorage-ból, fallbackként sütiből.
function parseSessionStore() {
  try {
    const rawStorage = localStorage.getItem(SESSION_STORAGE_KEY)
    if (rawStorage) {
      const parsed = JSON.parse(rawStorage)
      if (parsed && typeof parsed === 'object') {
        return parsed
      }
    }
  } catch {
    // Fallback az alábbi cookie olvasásra.
  }
  return parseSessionCookie()
}

// Sütiből betöltött minősítésekből cardId -> known/unknown map.
function createMarkMapFromSession(moduleId, sessionStore) {
  const current = sessionStore[moduleId] || { known: [], unknown: [] }
  const markMap = {}
  current.known.forEach((card) => {
    markMap[card.id] = 'known'
  })
  current.unknown.forEach((card) => {
    markMap[card.id] = 'unknown'
  })
  return markMap
}

// Fisher-Yates keverés.
function shuffleCards(cards) {
  const list = [...cards]
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

// Ékezetfüggetlen normalizálás kereséshez.
function normalizeSearch(input) {
  return String(input)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

// Igaz/Hamis felismerés.
function parseTruthValue(answerText) {
  const normalized = normalizeSearch(answerText)
  if (normalized.includes('igaz')) {
    return true
  }
  if (normalized.includes('hamis')) {
    return false
  }
  return null
}

// Egyszerű témakivonás kártyaszövegből.
function inferTopicFromCard(card, moduleTitle) {
  if (card.topic && String(card.topic).trim()) {
    return String(card.topic).trim()
  }

  const words = String(card.front || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .filter((word) => !STOP_WORDS.has(word))

  if (words.length >= 2) {
    return `${words[0]} ${words[1]}`
  }
  if (words.length === 1) {
    return words[0]
  }
  return moduleTitle
}

// JSON normalizálás egységes modulstruktúrára.
function normalizeSource(payload, sourceName) {
  const decks = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? [payload]
      : []

  return decks
    .map((deck, deckIndex) => {
      const cards = Array.isArray(deck.cards)
        ? deck.cards
        : Array.isArray(deck.questions)
          ? deck.questions
          : []

      const normalizedCards = cards
        .map((card, cardIndex) => ({
          id: `${sourceName}-${deck.id || deckIndex}-${card.id || cardIndex}`,
          front: String(card.front || card.question || card.prompt || '').trim(),
          back: String(card.back || card.answer || card.solution || '').trim(),
          topic: String(card.topic || card.category || '').trim(),
        }))
        .filter((card) => card.front && card.back)

      return {
        id: `${sourceName}-${deck.id || deckIndex}`,
        title: deck.title || deck.name || `Modul ${deckIndex + 1}`,
        description: deck.description || 'Saját feltöltött modul',
        sourceName,
        cards: normalizedCards,
      }
    })
    .filter((moduleItem) => moduleItem.cards.length > 0)
}

// Feltöltött fájl olvasása.
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('A fájl nem olvasható.'))
    reader.readAsText(file, 'utf-8')
  })
}

function App() {
  const { moduleId: routeModuleId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()

  // Fő adatok.
  const [modules, setModules] = useState(() => sampleModules.flatMap((source) => normalizeSource(source.payload, source.sourceName)))
  const [view, setView] = useState('valaszto')
  const [activeModule, setActiveModule] = useState(null)
  const [deckCards, setDeckCards] = useState([])

  // Kártyás mód állapot.
  const [phase, setPhase] = useState('main')
  const [index, setIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [markMap, setMarkMap] = useState({})
  const [isCompleted, setIsCompleted] = useState(false)
  const [actionFeedback, setActionFeedback] = useState(null)

  // Teszt mód állapot.
  const [studyMode, setStudyMode] = useState('kartyas')
  const [testIndex, setTestIndex] = useState(0)
  const [testResultMap, setTestResultMap] = useState({})
  const [testFeedback, setTestFeedback] = useState(null)

  // UI állapot.
  const [uploadMessage, setUploadMessage] = useState('')
  const [moduleQuery, setModuleQuery] = useState('')
  const [panelTab, setPanelTab] = useState('unknown')
  const [isSessionPanelOpen, setIsSessionPanelOpen] = useState(false)
  const [isSidebarHidden, setIsSidebarHidden] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement))
  const [moduleShuffleConfig, setModuleShuffleConfig] = useState({})
  const [studyProgress, setStudyProgress] = useState(() => parseStudyProgress())

  // Perzisztens adatok.
  const [sessionStore, setSessionStore] = useState(() => parseSessionStore())
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('study-theme')
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('quiz-settings')
    if (!saved) {
      return { shuffleOnStart: false, showKeyboardHelp: true }
    }
    try {
      const parsed = JSON.parse(saved)
      return {
        shuffleOnStart: Boolean(parsed.shuffleOnStart),
        showKeyboardHelp: parsed.showKeyboardHelp !== false,
      }
    } catch {
      return { shuffleOnStart: false, showKeyboardHelp: true }
    }
  })

  // Refs.
  const feedbackTimerRef = useRef(null)
  const touchStartXRef = useRef(null)

  // Téma szinkron.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('study-theme', theme)
  }, [theme])

  // Beállítás mentés.
  useEffect(() => {
    localStorage.setItem('quiz-settings', JSON.stringify(settings))
  }, [settings])

  // Session mentés localStorage-be és sütibe.
  useEffect(() => {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionStore))
    setCookie(SESSION_COOKIE, JSON.stringify(sessionStore), 14)
  }, [sessionStore])

  // Tanulási állapot mentése localStorage-be.
  useEffect(() => {
    localStorage.setItem(STUDY_PROGRESS_STORAGE_KEY, JSON.stringify(studyProgress))
  }, [studyProgress])

  // Útvonal alapján nézet kiválasztása.
  useEffect(() => {
    if (routeModuleId) {
      setView('tanulas')
      return
    }
    if (location.pathname === '/settings') {
      setView('beallitasok')
      return
    }
    setView('valaszto')
  }, [location.pathname, routeModuleId])

  // Fullscreen figyelés.
  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  // Desktop nézetbe visszatéréskor a mobil menü bezárása.
  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 761px)')
    const onChange = (event) => {
      if (event.matches) {
        setIsMobileMenuOpen(false)
      }
    }
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [])

  // Unmount takarítás.
  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current)
      }
    }
  }, [])

  // Szűrt modulok.
  const filteredModules = useMemo(() => {
    const query = normalizeSearch(moduleQuery)
    if (!query) {
      return modules
    }
    return modules.filter((moduleItem) => [moduleItem.title, moduleItem.description, moduleItem.sourceName]
      .some((field) => normalizeSearch(field).includes(query)))
  }, [moduleQuery, modules])

  // Modul -> card index.
  const moduleCardIndex = useMemo(() => {
    const indexMap = {}
    modules.forEach((moduleItem) => {
      indexMap[moduleItem.id] = Object.fromEntries(moduleItem.cards.map((card) => [card.id, card]))
    })
    return indexMap
  }, [modules])

  // Erős/gyenge témák.
  const moduleTopicInsights = useMemo(() => {
    return Object.fromEntries(modules.map((moduleItem) => {
      const topicScore = new Map()
      const moduleSession = sessionStore[moduleItem.id] || { known: [], unknown: [] }
      const cardById = moduleCardIndex[moduleItem.id] || {}

      moduleSession.known.forEach((savedCard) => {
        const sourceCard = cardById[savedCard.id] || savedCard
        const topic = inferTopicFromCard(sourceCard, moduleItem.title)
        topicScore.set(topic, (topicScore.get(topic) || 0) + 1)
      })

      moduleSession.unknown.forEach((savedCard) => {
        const sourceCard = cardById[savedCard.id] || savedCard
        const topic = inferTopicFromCard(sourceCard, moduleItem.title)
        topicScore.set(topic, (topicScore.get(topic) || 0) - 1)
      })

      const sorted = [...topicScore.entries()].sort((a, b) => b[1] - a[1])
      const strong = sorted.filter(([, score]) => score > 0).slice(0, 2).map(([topic]) => topic)
      const weak = sorted.slice().reverse().filter(([, score]) => score < 0).slice(0, 2).map(([topic]) => topic)
      return [moduleItem.id, { strong, weak }]
    }))
  }, [moduleCardIndex, modules, sessionStore])

  // Kártyás kör listák.
  const reviewCards = useMemo(() => {
    if (!activeModule) {
      return []
    }
    return deckCards.filter((card) => markMap[card.id] === 'unknown')
  }, [activeModule, deckCards, markMap])

  const activeCards = useMemo(() => {
    if (!activeModule) {
      return []
    }
    return phase === 'review' ? reviewCards : deckCards
  }, [activeModule, deckCards, phase, reviewCards])

  // Aktuális állapotok.
  const currentCard = activeCards[index] || null
  const isCurrentFrontRich = currentCard ? parseCardContentParts(currentCard.front).length > 1 : false
  const isCurrentBackRich = currentCard ? parseCardContentParts(currentCard.back).length > 1 : false
  const knownCount = Object.values(markMap).filter((mark) => mark === 'known').length
  const unknownCount = Object.values(markMap).filter((mark) => mark === 'unknown').length
  const activeSession = activeModule ? sessionStore[activeModule.id] || { known: [], unknown: [] } : { known: [], unknown: [] }

  // Teszt állapot számított adatai.
  const testCards = useMemo(() => deckCards.filter((card) => parseTruthValue(card.back) !== null), [deckCards])
  const currentTestCard = testCards[testIndex] || null
  const testStats = useMemo(() => {
    const values = Object.values(testResultMap)
    const correct = values.filter(Boolean).length
    const wrong = values.filter((value) => value === false).length
    return { correct, wrong, total: values.length }
  }, [testResultMap])

  // Session frissítés minősítés után.
  const updateSessionStore = useCallback((card, value) => {
    if (!activeModule || !card) {
      return
    }
    setSessionStore((prev) => {
      const current = prev[activeModule.id] || { known: [], unknown: [] }
      const known = current.known.filter((item) => item.id !== card.id)
      const unknown = current.unknown.filter((item) => item.id !== card.id)
      const payload = { id: card.id, front: card.front, back: card.back }

      if (value === 'known') {
        known.push(payload)
      } else {
        unknown.push(payload)
      }

      return {
        ...prev,
        [activeModule.id]: {
          known,
          unknown,
          updatedAt: Date.now(),
        },
      }
    })
  }, [activeModule])

  // Teszt reset.
  const resetTestState = useCallback(() => {
    setTestIndex(0)
    setTestResultMap({})
    setTestFeedback(null)
  }, [])

  // Tanulási reset.
  const resetStudyState = useCallback(() => {
    setPhase('main')
    setIndex(0)
    setIsFlipped(false)
    setIsCompleted(false)
    setActionFeedback(null)
    resetTestState()
    if (activeModule) {
      setMarkMap(createMarkMapFromSession(activeModule.id, sessionStore))
    }
  }, [activeModule, resetTestState, sessionStore])

  // Modul megnyitás.
  const openModule = useCallback((moduleItem, options = {}) => {
    const config = moduleShuffleConfig[moduleItem.id] || { enabled: false, version: 0 }
    const shouldShuffle = config.enabled || settings.shuffleOnStart
    const cards = shouldShuffle ? shuffleCards(moduleItem.cards) : [...moduleItem.cards]
    const startIndex = clampCardIndex(Number(options.startIndex || 0), cards.length)
    const targetPath = `/quiz/${encodeURIComponent(moduleItem.id)}`

    setActiveModule(moduleItem)
    setDeckCards(cards)
    setView('tanulas')
    setPhase('main')
    setIndex(startIndex)
    setIsFlipped(false)
    setIsCompleted(false)
    setPanelTab('unknown')
    setIsSessionPanelOpen(false)
    setIsMobileMenuOpen(false)
    setMarkMap(createMarkMapFromSession(moduleItem.id, sessionStore))
    setStudyMode('kartyas')
    resetTestState()

    const urlCard = String(startIndex + 1)
    const currentRouteModule = normalizeRouteModuleId(routeModuleId)
    const currentCardParam = new URLSearchParams(location.search).get('card')
    if (currentRouteModule !== moduleItem.id || currentCardParam !== urlCard) {
      navigate({ pathname: targetPath, search: `?card=${urlCard}` }, { replace: Boolean(options.replaceRoute) })
    }
  }, [location.search, moduleShuffleConfig, navigate, resetTestState, routeModuleId, sessionStore, settings.shuffleOnStart])

  // Útvonal alapján modul megnyitás és állapot visszaállítás.
  useEffect(() => {
    if (!routeModuleId) {
      return
    }

    const normalizedId = normalizeRouteModuleId(routeModuleId)
    const moduleFromRoute = modules.find((moduleItem) => moduleItem.id === normalizedId)
    if (!moduleFromRoute) {
      setUploadMessage('A hivatkozott modul nem található.')
      navigate('/', { replace: true })
      return
    }

    const routeCardParam = Number(new URLSearchParams(location.search).get('card'))
    const persistedIndex = Number(studyProgress[normalizedId]?.index)
    const requestedIndex = Number.isFinite(routeCardParam) && routeCardParam > 0
      ? routeCardParam - 1
      : Number.isFinite(persistedIndex)
        ? persistedIndex
        : 0

    if (activeModule?.id !== moduleFromRoute.id) {
      openModule(moduleFromRoute, { startIndex: requestedIndex, replaceRoute: true })
      return
    }

    const clampedIndex = clampCardIndex(requestedIndex, activeCards.length)
    if (clampedIndex !== index) {
      setIndex(clampedIndex)
    }
  }, [activeCards.length, activeModule?.id, index, location.search, modules, navigate, openModule, routeModuleId, studyProgress])

  // URL-ben frissítjük az aktuális kártya sorszámát.
  useEffect(() => {
    if (!activeModule || view !== 'tanulas') {
      return
    }

    const currentCardParam = new URLSearchParams(location.search).get('card')
    const nextCardParam = String(index + 1)
    const normalizedRouteModule = normalizeRouteModuleId(routeModuleId)

    if (normalizedRouteModule !== activeModule.id || currentCardParam !== nextCardParam) {
      navigate({ pathname: `/quiz/${encodeURIComponent(activeModule.id)}`, search: `?card=${nextCardParam}` }, { replace: true })
    }
  }, [activeModule, index, location.search, navigate, routeModuleId, view])

  // Tanulási előrehaladás mentése modulonként.
  useEffect(() => {
    if (!activeModule || view !== 'tanulas') {
      return
    }

    setStudyProgress((prev) => ({
      ...prev,
      [activeModule.id]: {
        index,
        phase,
        studyMode,
        updatedAt: Date.now(),
      },
    }))
  }, [activeModule, index, phase, studyMode, view])

  const goToSelector = useCallback(() => {
    navigate('/')
  }, [navigate])

  const goToSettings = useCallback(() => {
    navigate('/settings')
  }, [navigate])

  const goToStudy = useCallback(() => {
    if (!activeModule) {
      navigate('/')
      return
    }
    navigate({ pathname: `/quiz/${encodeURIComponent(activeModule.id)}`, search: `?card=${index + 1}` })
  }, [activeModule, index, navigate])

  // Aktív modul keverésének állapota.
  const activeModuleShuffleEnabled = activeModule
    ? Boolean(moduleShuffleConfig[activeModule.id]?.enabled)
    : false

  // Modulonkénti keverés kapcsoló.
  const toggleModuleShuffle = useCallback((moduleId) => {
    setModuleShuffleConfig((prev) => {
      const current = prev[moduleId] || { enabled: false, version: 0 }
      const next = { enabled: !current.enabled, version: current.version + 1 }

      if (activeModule && activeModule.id === moduleId) {
        const nextDeck = next.enabled ? shuffleCards(activeModule.cards) : [...activeModule.cards]
        setDeckCards(nextDeck)
        setIndex(0)
        setIsFlipped(false)
        setIsCompleted(false)
        resetTestState()
      }

      return { ...prev, [moduleId]: next }
    })
  }, [activeModule, resetTestState])

  // Következő / előző.
  const queueAfterFlipReset = useCallback((callback) => {
    setIsFlipped(false)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        callback()
      })
    })
  }, [])

  const moveNext = useCallback(() => {
    if (!activeCards.length) {
      return
    }

    const goNext = () => {
      if (index < activeCards.length - 1) {
        setIndex((prev) => prev + 1)
        return
      }
      if (phase === 'main' && reviewCards.length > 0) {
        setPhase('review')
        setIndex(0)
        return
      }
      setIsCompleted(true)
    }

    if (isFlipped) {
      queueAfterFlipReset(goNext)
      return
    }

    goNext()
  }, [activeCards.length, index, isFlipped, phase, queueAfterFlipReset, reviewCards.length])

  const movePrev = useCallback(() => {
    if (index <= 0) {
      return
    }

    if (isFlipped) {
      queueAfterFlipReset(() => setIndex((prev) => prev - 1))
      return
    }

    setIndex((prev) => prev - 1)
    setIsCompleted(false)
  }, [index, isFlipped, queueAfterFlipReset])

  // Tudom/Nem tudom minősítés mikroanimációval.
  const markCard = useCallback((value) => {
    if (!currentCard) {
      return
    }

    setMarkMap((prev) => ({ ...prev, [currentCard.id]: value }))
    updateSessionStore(currentCard, value)

    setActionFeedback(value)
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current)
    }
    feedbackTimerRef.current = window.setTimeout(() => {
      setActionFeedback(null)
      moveNext()
    }, 140)
  }, [currentCard, moveNext, updateSessionStore])

  // Kártya fordítás.
  const flipCard = useCallback(() => {
    setIsFlipped((prev) => !prev)
  }, [])

  // Session törlés.
  const clearSessionData = useCallback(() => {
    setSessionStore({})
    localStorage.removeItem(SESSION_STORAGE_KEY)
    clearCookie(SESSION_COOKIE)
    setMarkMap({})
    setPhase('main')
    setIndex(0)
    setIsCompleted(false)
    setIsFlipped(false)
    setIsSessionPanelOpen(false)
    setActionFeedback(null)
    resetTestState()
  }, [resetTestState])

  // Fullscreen kapcsoló.
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        setIsSidebarHidden(true)
        setIsMobileMenuOpen(false)
        await document.documentElement.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch {
      // Néma hibatűrés.
    }
  }, [])

  // Teszt válaszadás.
  const answerTestQuestion = useCallback((pickedValue) => {
    if (!currentTestCard || testResultMap[currentTestCard.id] !== undefined) {
      return
    }
    const expected = parseTruthValue(currentTestCard.back)
    const isCorrect = expected === pickedValue
    setTestResultMap((prev) => ({ ...prev, [currentTestCard.id]: isCorrect }))
    setTestFeedback(isCorrect ? 'Helyes válasz.' : 'Sajnos rossz válasz.')
  }, [currentTestCard, testResultMap])

  // Következő tesztkérdés.
  const moveNextTest = useCallback(() => {
    if (testIndex < testCards.length - 1) {
      setTestIndex((prev) => prev + 1)
      setTestFeedback(null)
    }
  }, [testCards.length, testIndex])

  // Swipe start/end.
  const onCardTouchStart = useCallback((event) => {
    touchStartXRef.current = event.changedTouches[0].clientX
  }, [])

  const onCardTouchEnd = useCallback((event) => {
    if (studyMode !== 'kartyas') {
      return
    }
    const startX = touchStartXRef.current
    if (startX === null || startX === undefined) {
      return
    }
    const endX = event.changedTouches[0].clientX
    const delta = endX - startX
    if (delta > 60) {
      markCard('known')
      return
    }
    if (delta < -60) {
      markCard('unknown')
    }
  }, [markCard, studyMode])

  // Billentyűk kezelése.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!activeModule || view !== 'tanulas') {
        return
      }

      if (
        event.target instanceof HTMLElement &&
        (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA')
      ) {
        return
      }

      if (event.code === 'Space') {
        event.preventDefault()
        if (studyMode === 'kartyas' && currentCard && !isCompleted) {
          flipCard()
        }
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (studyMode === 'kartyas' && currentCard && !isCompleted) {
          moveNext()
        }
        if (studyMode === 'teszt') {
          moveNextTest()
        }
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        if (studyMode === 'kartyas' && currentCard && !isCompleted) {
          movePrev()
        }
      }

      if (event.key.toLowerCase() === 'q') {
        event.preventDefault()
        if (studyMode === 'kartyas' && currentCard && !isCompleted) {
          markCard('unknown')
        }
        if (studyMode === 'teszt') {
          answerTestQuestion(false)
        }
      }

      if (event.key.toLowerCase() === 'e') {
        event.preventDefault()
        if (studyMode === 'kartyas' && currentCard && !isCompleted) {
          markCard('known')
        }
        if (studyMode === 'teszt') {
          answerTestQuestion(true)
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    activeModule,
    answerTestQuestion,
    currentCard,
    flipCard,
    isCompleted,
    markCard,
    moveNext,
    moveNextTest,
    movePrev,
    studyMode,
    view,
  ])

  // JSON feltöltés.
  const handleUpload = async (event) => {
    const [file] = event.target.files || []
    event.target.value = ''
    if (!file) {
      return
    }

    try {
      const text = await readFileAsText(file)
      const parsed = JSON.parse(text)
      const newModules = normalizeSource(parsed, file.name.replace(/\.json$/i, ''))

      if (!newModules.length) {
        setUploadMessage('A JSON formátuma érvényes, de nem találtam front/back kártyaadatot.')
        return
      }

      setModules((prev) => [...newModules, ...prev])
      setUploadMessage(`Sikeres feltöltés: ${newModules.length} modul (${file.name}).`)
    } catch {
      setUploadMessage('Hibás JSON. Ellenőrizd a fájl szerkezetét, majd próbáld újra.')
    }
  }

  const renderSelectorView = () => (
    <>
      <header className="top-bar">
        <div>
          <p className="eyebrow">GR Kvíz</p>
          <h1>Kvízkártyás tanulás</h1>
        </div>
      </header>

      <section className="intro-card">
        <p>
          Új kvíz hozzáadásához a legegyszerűbb módszer a JSON feltöltése itt az oldalon.
          Ha a quizek mappába másolsz fájlt, a rendszer automatikusan észleli a következő frissítéskor.
        </p>
        <div className="intro-actions">
          <label className="upload-btn" htmlFor="upload-json">
            JSON feltöltése
          </label>
          <input
            id="upload-json"
            type="file"
            accept=".json,application/json"
            onChange={handleUpload}
            hidden
          />
          <input
            className="search-input"
            type="search"
            value={moduleQuery}
            onChange={(event) => setModuleQuery(event.target.value)}
            placeholder="Keresés a modulok között..."
          />
        </div>
        {uploadMessage && <p className="upload-message">{uploadMessage}</p>}
      </section>

      <section className="module-grid">
        {filteredModules.map((moduleItem) => (
          <article className="module-card" key={moduleItem.id}>
            <div>
              <p className="module-source">{moduleItem.sourceName}</p>
              <h2>{moduleItem.title}</h2>
              <p className="module-description">{moduleItem.description}</p>
              <div className="topic-insights">
                <p>
                  Erős témák:{' '}
                  {moduleTopicInsights[moduleItem.id]?.strong?.length
                    ? moduleTopicInsights[moduleItem.id].strong.join(', ')
                    : 'még nincs adat'}
                </p>
                <p>
                  Gyenge témák:{' '}
                  {moduleTopicInsights[moduleItem.id]?.weak?.length
                    ? moduleTopicInsights[moduleItem.id].weak.join(', ')
                    : 'még nincs adat'}
                </p>
              </div>
            </div>

            <div className="module-footer">
              <span>{moduleItem.cards.length} kártya</span>
              <button type="button" className="primary-btn" onClick={() => openModule(moduleItem)}>
                Tanulás indítása
              </button>
            </div>
          </article>
        ))}
      </section>
    </>
  )

  const renderSettingsView = () => (
    <>
      <header className="top-bar">
        <div>
          <p className="eyebrow">Nézet</p>
          <h1>Beállítások</h1>
        </div>
      </header>

      <section className="settings-card">
        <h2>Viselkedés</h2>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={settings.shuffleOnStart}
            onChange={(event) => setSettings((prev) => ({ ...prev, shuffleOnStart: event.target.checked }))}
          />
          <span>Kártyák keverése induláskor</span>
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={settings.showKeyboardHelp}
            onChange={(event) => setSettings((prev) => ({ ...prev, showKeyboardHelp: event.target.checked }))}
          />
          <span>Billentyűsúgó megjelenítése</span>
        </label>

        <h2>Megjelenés</h2>
        <button type="button" className="ghost-btn" onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}>
          {theme === 'dark' ? 'Váltás világos módra' : 'Váltás sötét módra'}
        </button>

        <h2>Munkamenet adatok</h2>
        <p className="helper-text">
          A Tudom/Nem tudom listákat a rendszer sütiben tárolja, így a böngészőben visszatölthetők.
        </p>
        <button type="button" className="danger-btn" onClick={clearSessionData}>
          Munkamenet adatok törlése
        </button>
      </section>
    </>
  )

  const renderStudyView = () => {
    if (!activeModule) {
      return (
        <section className="summary-card">
          <h2>Nincs aktív modul</h2>
          <p>Válassz egy modult a Kvízválasztó nézetben.</p>
          <button type="button" className="primary-btn" onClick={goToSelector}>
            Ugrás a kvízválasztóhoz
          </button>
        </section>
      )
    }

    return (
      <>
        <header className="top-bar">
          <div>
            <p className="eyebrow">{phase === 'review' ? 'Ismétlési kör' : 'Tanulási kör'}</p>
            <h1>{activeModule.title}</h1>
          </div>
          <div>
            <button
              type="button"
              className={`icon-square-btn ${studyMode === 'teszt' ? 'active' : ''}`}
              onClick={() => setStudyMode((prev) => (prev === 'kartyas' ? 'teszt' : 'kartyas'))}
              title={studyMode === 'kartyas' ? 'Teszt mód' : 'Kártyás mód'}
              aria-label={studyMode === 'kartyas' ? 'Teszt mód' : 'Kártyás mód'}
            >
              {studyMode === 'kartyas' ? '≟' : '▣'}
            </button>
            <button
              type="button"
              className={`icon-square-btn ${activeModuleShuffleEnabled ? 'active' : ''}`}
              onClick={() => toggleModuleShuffle(activeModule.id)}
              title="Keverés"
              aria-label="Keverés"
            >
              ⤮
            </button>
            <button
              type="button"
              className={`icon-square-btn ${isFullscreen ? 'active' : ''}`}
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Kilépés teljes képernyőről' : 'Teljes képernyő'}
              aria-label={isFullscreen ? 'Kilépés teljes képernyőről' : 'Teljes képernyő'}
            >
              {isFullscreen ? '⤡' : '⤢'}
            </button>
            <button
              type="button"
              className="icon-square-btn"
              onClick={goToSelector}
              title="Modulok"
              aria-label="Modulok"
            >
              ☰
            </button>
          </div>
        </header>

        {studyMode === 'kartyas' && (
          <>
            <section className="progress-panel">
              <p>Kártya {Math.min(index + 1, activeCards.length)} / {activeCards.length}</p>
              <div className="meter">
                <span style={{ width: `${activeCards.length ? ((index + 1) / activeCards.length) * 100 : 0}%` }} />
              </div>
            </section>

            {currentCard && !isCompleted && (
              <>
                <section
                  className={`flashcard ${isFlipped ? 'flipped' : ''} ${actionFeedback === 'known' ? 'feedback-known' : ''} ${actionFeedback === 'unknown' ? 'feedback-unknown' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={flipCard}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      flipCard()
                    }
                  }}
                  onTouchStart={onCardTouchStart}
                  onTouchEnd={onCardTouchEnd}
                >
                  <div className="flashcard-inner">
                    <article className={`flash-face flash-front ${isCurrentFrontRich ? 'flash-face-rich' : ''}`.trim()}>
                      <p className="card-label card-label-top">Kérdés</p>
                      <CardContent
                        value={currentCard.front}
                        alt="Kérdés kép"
                        textTag="h2"
                        imageClassName="card-image"
                        containerClassName="card-rich-content-center"
                      />
                    </article>
                    <article className={`flash-face flash-back ${isCurrentBackRich ? 'flash-face-rich' : ''}`.trim()}>
                      <p className="card-label card-label-top">Válasz</p>
                      <CardContent
                        value={currentCard.back}
                        alt="Válasz kép"
                        textTag="h2"
                        imageClassName="card-image"
                        containerClassName="card-rich-content-center"
                      />
                    </article>
                  </div>
                  {settings.showKeyboardHelp && (
                    <p className="shortcut-hint">
                      Szóköz/klikk: fordítás | ←/→: lépés | Swipe bal/jobbra: Nem tudom/Tudom | Q: Nem tudom | E: Tudom
                    </p>
                  )}
                </section>

                <section className="controls">
                  <button type="button" className="ghost-btn" onClick={movePrev} disabled={index === 0} title="Vissza" aria-label="Vissza">←</button>
                  <button type="button" className="danger-btn" onClick={() => markCard('unknown')}>Nem tudom (Q)</button>
                  <button type="button" className="success-btn" onClick={() => markCard('known')}>Tudom (E)</button>
                  <button type="button" className="ghost-btn" onClick={moveNext} title="Tovább" aria-label="Tovább">→</button>
                </section>
              </>
            )}

            {isCompleted && (
              <section className="summary-card">
                <h2>Kör vége</h2>
                <p>Ismert kártyák: {knownCount}</p>
                <p>Ismétléshez jelölt kártyák: {unknownCount}</p>
                <div className="summary-actions">
                  <button type="button" className="primary-btn" onClick={resetStudyState}>Újrakezdés</button>
                  <button type="button" className="ghost-btn" onClick={goToSelector}>Vissza a modulokhoz</button>
                </div>
              </section>
            )}
          </>
        )}

        {studyMode === 'teszt' && (
          <>
            {testCards.length > 0 && (
              <section className="progress-panel">
                <p>Tesztkérdés {Math.min(testIndex + 1, testCards.length)} / {testCards.length}</p>
                <div className="meter">
                  <span style={{ width: `${testCards.length ? ((testIndex + 1) / testCards.length) * 100 : 0}%` }} />
                </div>
              </section>
            )}

            {testCards.length === 0 && (
              <section className="summary-card">
                <h2>Teszt mód nem elérhető</h2>
                <p>Ebben a modulban nincs egyértelmű Igaz/Hamis válaszú kártya.</p>
              </section>
            )}

            {testCards.length > 0 && currentTestCard && testStats.total < testCards.length && (
              <section className="test-card">
                <p className="card-label">Tesztkérdés</p>
                <CardContent
                  value={currentTestCard.front}
                  alt="Teszt kérdés kép"
                  textTag="h2"
                  imageClassName="test-image"
                  containerClassName="card-rich-content-test"
                />

                <div className="test-actions">
                  <button
                    type="button"
                    className={`test-option ${testResultMap[currentTestCard.id] !== undefined && parseTruthValue(currentTestCard.back) === true ? 'correct' : ''}`}
                    onClick={() => answerTestQuestion(true)}
                    disabled={testResultMap[currentTestCard.id] !== undefined}
                  >
                    Igaz
                  </button>
                  <button
                    type="button"
                    className={`test-option ${testResultMap[currentTestCard.id] !== undefined && parseTruthValue(currentTestCard.back) === false ? 'correct' : ''}`}
                    onClick={() => answerTestQuestion(false)}
                    disabled={testResultMap[currentTestCard.id] !== undefined}
                  >
                    Hamis
                  </button>
                </div>

                {testFeedback && (
                  <p className={testFeedback.includes('Helyes') ? 'test-feedback good' : 'test-feedback bad'}>{testFeedback}</p>
                )}

                <div className="summary-actions">
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={moveNextTest}
                    disabled={testResultMap[currentTestCard.id] === undefined}
                  >
                    Következő kérdés
                  </button>
                </div>
              </section>
            )}

            {testCards.length > 0 && testStats.total === testCards.length && (
              <section className="summary-card">
                <h2>Teszt vége</h2>
                <p>Helyes válaszok: {testStats.correct}</p>
                <p>Hibás válaszok: {testStats.wrong}</p>
                <p>Összes kérdés: {testCards.length}</p>
                <div className="summary-actions">
                  <button type="button" className="primary-btn" onClick={resetTestState}>Teszt újrakezdése</button>
                  <button type="button" className="ghost-btn" onClick={() => setStudyMode('kartyas')}>Vissza kártyás módba</button>
                </div>
              </section>
            )}
          </>
        )}

        <section className="session-card">
          <header className="session-header">
            <h2>Munkamenet listák</h2>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setIsSessionPanelOpen((prev) => !prev)}
              title={isSessionPanelOpen ? 'Listák összecsukása' : 'Listák lenyitása'}
              aria-label={isSessionPanelOpen ? 'Listák összecsukása' : 'Listák lenyitása'}
            >
              {isSessionPanelOpen ? '▴' : '▾'}
            </button>
          </header>

          {isSessionPanelOpen && (
            <>
              <div className="session-tabs">
                <button type="button" className={panelTab === 'unknown' ? 'tab-btn active' : 'tab-btn'} onClick={() => setPanelTab('unknown')}>
                  Nem tudom ({activeSession.unknown.length})
                </button>
                <button type="button" className={panelTab === 'known' ? 'tab-btn active' : 'tab-btn'} onClick={() => setPanelTab('known')}>
                  Tudom ({activeSession.known.length})
                </button>
              </div>

              <ul className="session-list">
                {(panelTab === 'unknown' ? activeSession.unknown : activeSession.known).map((card) => (
                  <li key={card.id}>
                    <CardContent
                      value={card.front}
                      alt="Mentett kérdés kép"
                      textTag="strong"
                      imageClassName="session-image"
                      containerClassName="card-rich-content-session"
                    />
                    <CardContent
                      value={card.back}
                      alt="Mentett válasz kép"
                      textTag="span"
                      imageClassName="session-image"
                      containerClassName="card-rich-content-session"
                    />
                  </li>
                ))}
                {(panelTab === 'unknown' ? activeSession.unknown : activeSession.known).length === 0 && (
                  <li className="session-empty">Még nincs ide sorolt kártya ebben a modulban.</li>
                )}
              </ul>
            </>
          )}
        </section>
      </>
    )
  }

  return (
    <div className={`layout-shell ${isSidebarHidden ? 'sidebar-hidden' : ''} ${isFullscreen ? 'fullscreen-active' : ''} ${isMobileMenuOpen ? 'mobile-menu-open' : ''}`}>
      <button
        type="button"
        className={`mobile-menu-btn icon-square-btn ${isMobileMenuOpen ? 'active' : ''}`}
        onClick={() => {
          setIsSidebarHidden(false)
          setIsMobileMenuOpen((prev) => !prev)
        }}
        aria-label={isMobileMenuOpen ? 'Menü bezárása' : 'Menü megnyitása'}
        title={isMobileMenuOpen ? 'Menü bezárása' : 'Menü megnyitása'}
      >
        {isMobileMenuOpen ? '✕' : '☰'}
      </button>

      {isMobileMenuOpen && <button type="button" className="mobile-backdrop" onClick={() => setIsMobileMenuOpen(false)} aria-label="Menü bezárása" />}

      <aside className="sidebar">
        <div>
          <p className="brand-title">GR Kvíz</p>
        </div>

        <nav className="sidebar-nav">
          <button type="button" className={view === 'valaszto' ? 'nav-btn active' : 'nav-btn'} onClick={() => {
            goToSelector()
            setIsMobileMenuOpen(false)
          }}>
            Kvízválasztó
          </button>
          <button type="button" className={view === 'tanulas' ? 'nav-btn active' : 'nav-btn'} onClick={() => {
            goToStudy()
            setIsMobileMenuOpen(false)
          }}>
            Tanulási mód
          </button>
          <button type="button" className={view === 'beallitasok' ? 'nav-btn active' : 'nav-btn'} onClick={() => {
            goToSettings()
            setIsMobileMenuOpen(false)
          }}>
            Beállítások
          </button>
        </nav>

        <div className="sidebar-bottom">
          <button
            type="button"
            className="icon-square-btn"
            onClick={() => {
              setIsSidebarHidden(true)
              setIsMobileMenuOpen(false)
            }}
            aria-label="Oldalsáv elrejtése"
            title="Oldalsáv elrejtése"
          >
            ◀
          </button>
          <button type="button" className="ghost-btn" onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}>
            {theme === 'dark' ? 'Világos mód' : 'Sötét mód'}
          </button>
        </div>
      </aside>

      <main className="main-content">
        <div className="app-shell study-shell">
          {isSidebarHidden && (
            <button
              type="button"
              className="show-sidebar-btn icon-square-btn"
              onClick={() => setIsSidebarHidden(false)}
              aria-label="Oldalsáv megjelenítése"
              title="Oldalsáv megjelenítése"
            >
              ▶
            </button>
          )}
          {view === 'valaszto' && renderSelectorView()}
          {view === 'tanulas' && renderStudyView()}
          {view === 'beallitasok' && renderSettingsView()}
        </div>
      </main>
    </div>
  )
}

export default App
