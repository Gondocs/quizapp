import { useCallback, useEffect, useMemo, useState } from 'react'
import quiz06 from './quizek/flashcard_06.json'
import quiz07 from './quizek/flashcard_07.json'
import quiz08 from './quizek/flashcard_08.json'
import quiz09 from './quizek/flashcard_09.json'
import quiz10 from './quizek/flashcard_10.json'
import './App.css'

const sampleModules = [quiz06, quiz07, quiz08, quiz09, quiz10]

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
        }))
        .filter((card) => card.front && card.back)

      return {
        id: `${sourceName}-${deck.id || deckIndex}`,
        title: deck.title || deck.name || `Modul ${deckIndex + 1}`,
        description: deck.description || 'Sajat feltoltott modul',
        sourceName,
        cards: normalizedCards,
      }
    })
    .filter((moduleItem) => moduleItem.cards.length > 0)
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('A fájl nem olvasható.'))
    reader.readAsText(file, 'utf-8')
  })
}

function App() {
  const [modules, setModules] = useState(() => {
    return sampleModules.flatMap((source, index) =>
      normalizeSource(source, `Minta ${index + 1}`),
    )
  })
  const [activeModule, setActiveModule] = useState(null)
  const [phase, setPhase] = useState('main')
  const [index, setIndex] = useState(0)
  const [isFlipped, setIsFlipped] = useState(false)
  const [markMap, setMarkMap] = useState({})
  const [isCompleted, setIsCompleted] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('study-theme')
    if (savedTheme === 'light' || savedTheme === 'dark') {
      return savedTheme
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('study-theme', theme)
  }, [theme])

  const reviewCards = useMemo(() => {
    if (!activeModule) {
      return []
    }
    return activeModule.cards.filter((card) => markMap[card.id] === 'unknown')
        description: deck.description || 'Saját feltöltött modul',

  const activeCards = useMemo(() => {
    if (!activeModule) {
      return []
    }
    if (phase === 'review') {
      return reviewCards
    }
    return activeModule.cards
  }, [activeModule, phase, reviewCards])

  const currentCard = activeCards[index] || null
  const knownCount = Object.values(markMap).filter((mark) => mark === 'known').length
  const unknownCount = Object.values(markMap).filter((mark) => mark === 'unknown').length

  const resetStudyState = () => {
    setPhase('main')
    setIndex(0)
    setIsFlipped(false)
    setMarkMap({})
    setIsCompleted(false)
  }

  const openModule = (moduleItem) => {
    setActiveModule(moduleItem)
    resetStudyState()
  }

  const moveNext = useCallback(() => {
    if (!activeCards.length) {
      return
    }

    if (index < activeCards.length - 1) {
      setIndex((prev) => prev + 1)
      setIsFlipped(false)
      return
    }

    if (phase === 'main' && reviewCards.length > 0) {
      setPhase('review')
      setIndex(0)
      setIsFlipped(false)
      return
    }

    setIsCompleted(true)
  }, [activeCards.length, index, phase, reviewCards.length])

  const movePrev = useCallback(() => {
    if (index <= 0) {
      return
    }
    setIndex((prev) => prev - 1)
    setIsFlipped(false)
    setIsCompleted(false)
  }, [index])

  const markCard = useCallback((value) => {
    if (!currentCard) {
      return
    }

    setMarkMap((prev) => ({
      ...prev,
      [currentCard.id]: value,
    }))
    moveNext()
  }, [currentCard, moveNext])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!activeModule || !currentCard || isCompleted) {
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
        setIsFlipped((prev) => !prev)
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        moveNext()
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        movePrev()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeModule, currentCard, isCompleted, moveNext, movePrev])

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

  if (!activeModule) {
    return (
      <div className="app-shell">
        <header className="top-bar">
          <div>
            <p className="eyebrow">StudyScribe</p>
            <h1>Kviz kartyas tanulas</h1>
          </div>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? 'Világos mód' : 'Sötét mód'}
          </button>
        </header>

        <section className="intro-card">
          <p>
            Tölts fel egy saját JSON-t, vagy indíts egy mintamodult a quizek mappából.
            A rendszer automatikusan felismeri a front/back kártyákat.
          </p>
          <label className="upload-btn" htmlFor="upload-json">
            JSON feltoltese
          </label>
          <input
            id="upload-json"
            type="file"
            accept=".json,application/json"
            onChange={handleUpload}
            hidden
          />
          {uploadMessage && <p className="upload-message">{uploadMessage}</p>}
        </section>

        <section className="module-grid">
          {modules.map((moduleItem) => (
            <article className="module-card" key={moduleItem.id}>
              <div>
                <p className="module-source">{moduleItem.sourceName}</p>
                <h2>{moduleItem.title}</h2>
                <p className="module-description">{moduleItem.description}</p>
              </div>
              <div className="module-footer">
                <span>{moduleItem.cards.length} kártya</span>
                <button type="button" className="primary-btn" onClick={() => openModule(moduleItem)}>
                  Start
                </button>
              </div>
            </article>
          ))}
        </section>
      </div>
    )
  }

  return (
    <div className="app-shell study-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">{phase === 'review' ? 'Ismétlési kör' : 'Tanulási kör'}</p>
          <h1>{activeModule.title}</h1>
        </div>
        <div>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? 'Világos mód' : 'Sötét mód'}
          </button>
          <button type="button" className="ghost-btn" onClick={() => setActiveModule(null)}>
            Modulok
          </button>
        </div>
      </header>

      <section className="progress-panel">
        <p>
          Kártya {Math.min(index + 1, activeCards.length)} / {activeCards.length}
        </p>
        <div className="meter">
          <span
            style={{
              width: `${activeCards.length ? ((index + 1) / activeCards.length) * 100 : 0}%`,
            }}
          />
        </div>
      </section>

      {currentCard && !isCompleted && (
        <>
          <section className={`flashcard ${isFlipped ? 'flipped' : ''}`} role="button" tabIndex={0}>
            <div className="flashcard-inner">
              <article className="flash-face flash-front">
                <p className="card-label">Kérdés</p>
                <h2>{currentCard.front}</h2>
              </article>
              <article className="flash-face flash-back">
                <p className="card-label">Válasz</p>
                <h2>{currentCard.back}</h2>
              </article>
            </div>
            <p className="shortcut-hint">Szóköz: fordítás | Nyíl jobbra-balra: lépés</p>
          </section>

          <section className="controls">
            <button type="button" className="ghost-btn" onClick={movePrev} disabled={index === 0}>
              Vissza
            </button>
            <button type="button" className="danger-btn" onClick={() => markCard('unknown')}>
              Nem tudom
            </button>
            <button type="button" className="success-btn" onClick={() => markCard('known')}>
              Tudom
            </button>
            <button type="button" className="ghost-btn" onClick={moveNext}>
              Tovább
            </button>
          </section>
        </>
      )}

      {isCompleted && (
        <section className="summary-card">
          <h2>Kör vége</h2>
          <p>Ismert kartyak: {knownCount}</p>
          <p>Ismétléshez jelölt kártyák: {unknownCount}</p>
          <div className="summary-actions">
            <button type="button" className="primary-btn" onClick={resetStudyState}>
              Újrakezdés
            </button>
            <button type="button" className="ghost-btn" onClick={() => setActiveModule(null)}>
              Vissza a modulokhoz
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

export default App
