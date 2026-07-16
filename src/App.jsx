import { useEffect, useRef, useState } from 'react'
import {
  BONG_GREENS,
  FORMATS,
  DURATIONS,
  FONT_WEIGHTS,
} from './constants.js'
import {
  ANIMATIONS,
  ANIMATIONS_BY_ID,
  buildDefaultParams,
} from './animations.js'
import { logoDataUrl } from './logo.js'
import {
  loadAutosave,
  saveAutosave,
  loadPresets,
  savePresets,
} from './storage.js'
import { renderFrame } from './render.js'
import { exportVideo, exportGif } from './exporters.js'

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// Color control with an editable hex text field (type or paste) plus the native
// color picker. Keeps a local draft so partial input isn't clobbered mid-typing;
// commits only when the value is a valid hex.
function ColorField({ value, onChange }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])

  function onText(e) {
    let v = e.target.value
    setDraft(v)
    let h = v.trim()
    if (h && !h.startsWith('#')) h = '#' + h
    if (HEX_RE.test(h)) onChange(h.toUpperCase())
  }

  return (
    <div className="color-row">
      <input
        type="color"
        value={HEX_RE.test(value) ? value : '#000000'}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
      />
      <input
        className="hex-input"
        type="text"
        value={draft}
        spellCheck={false}
        maxLength={7}
        onChange={onText}
        onBlur={() => setDraft(value)}
      />
    </div>
  )
}

// Settings restored from the previous session (autosave). `init` reads a key
// from it, falling back to the given default on first run.
const SAVED = loadAutosave()
const init = (key, def) => (SAVED && key in SAVED ? SAVED[key] : def)

export default function App() {
  // ---- Text ----
  const [text, setText] = useState(() => init('text', 'BONG'))
  const [fontSize, setFontSize] = useState(() => init('fontSize', 160))
  const [fontWeight, setFontWeight] = useState(() => init('fontWeight', 700))
  const [letterSpacing, setLetterSpacing] = useState(() => init('letterSpacing', -0.04)) // em
  const [lineHeight, setLineHeight] = useState(() => init('lineHeight', 0.95))
  const [textTransform, setTextTransform] = useState(() => init('textTransform', 'uppercase'))
  const [align, setAlign] = useState(() => init('align', 'center')) // left | center | right
  const [offsetX, setOffsetX] = useState(() => init('offsetX', 0)) // % of canvas width, -50..50
  const [offsetY, setOffsetY] = useState(() => init('offsetY', 0)) // % of canvas height, -50..50

  // ---- Color ----
  const [activeGreen, setActiveGreen] = useState(() => init('activeGreen', BONG_GREENS[5].hex)) // 400
  const [secondaryColor, setSecondaryColor] = useState(() => init('secondaryColor', '#F0ECE4'))

  // ---- Logo ----
  // The logo inherits the text color per frame (see render.js / drawLogo), so
  // it has no color control of its own.
  const [logoEnabled, setLogoEnabled] = useState(() => init('logoEnabled', false))
  const [logoSize, setLogoSize] = useState(() => init('logoSize', 18)) // % of canvas height
  const [logoX, setLogoX] = useState(() => init('logoX', 0)) // % of canvas width
  const [logoY, setLogoY] = useState(() => init('logoY', 30)) // % of canvas height
  const [logoImage, setLogoImage] = useState(null)

  // ---- Animation ----
  const [activeAnim, setActiveAnim] = useState(() => init('activeAnim', 'swap'))
  const [animParams, setAnimParams] = useState(() => {
    const defs = buildDefaultParams()
    if (SAVED?.animParams) {
      for (const id in defs) {
        if (SAVED.animParams[id]) defs[id] = { ...defs[id], ...SAVED.animParams[id] }
      }
    }
    return defs
  })
  const [playing, setPlaying] = useState(true)
  const activeAnimDef = ANIMATIONS_BY_ID[activeAnim]

  function setParam(key, value) {
    setAnimParams((prev) => ({
      ...prev,
      [activeAnim]: { ...prev[activeAnim], [key]: value },
    }))
  }

  // ---- Canvas ----
  const [formatIdx, setFormatIdx] = useState(() => init('formatIdx', 0))
  const format = FORMATS[formatIdx] || FORMATS[0]

  // ---- Export ----
  const [duration, setDuration] = useState(() => init('duration', 3))
  const [exporting, setExporting] = useState(null) // 'video' | 'gif' | null
  const [progress, setProgress] = useState(0)

  // ---- Presets ----
  const [presets, setPresets] = useState(loadPresets)
  const [presetName, setPresetName] = useState('')

  const [fontReady, setFontReady] = useState(false)

  const canvasRef = useRef(null)
  const rafRef = useRef(0)
  // Keep the latest render options in a ref so the RAF loop always reads
  // fresh values without being torn down/rebuilt on every keystroke.
  const optsRef = useRef({})
  // Freeze-frame time used when paused, so pausing holds the current state.
  const frozenTimeRef = useRef(0)

  // Ensure Satoshi is loaded before the first paint so glyphs measure right.
  useEffect(() => {
    let cancelled = false
    const done = () => {
      if (!cancelled) setFontReady(true)
    }
    if (document.fonts && document.fonts.ready) {
      // Nudge the browser to actually fetch the weight we use.
      document.fonts.load('700 160px Satoshi').finally(() => {
        document.fonts.ready.then(done)
      })
    } else {
      done()
    }
    return () => {
      cancelled = true
    }
  }, [])

  // Load the logo silhouette once. Color is applied per frame at draw time
  // (tinted to the current text color), so the image itself is color-agnostic.
  useEffect(() => {
    const img = new Image()
    img.onload = () => setLogoImage(img)
    img.src = logoDataUrl('#000000')
  }, [])

  // Everything that defines a look — the unit of both autosave and presets.
  function collectSettings() {
    return {
      text, fontSize, fontWeight, letterSpacing, lineHeight, textTransform,
      align, offsetX, offsetY, activeGreen, secondaryColor,
      logoEnabled, logoSize, logoX, logoY,
      activeAnim, animParams, formatIdx, duration,
    }
  }

  function applySettings(s) {
    if (!s) return
    const set = (k, fn) => {
      if (k in s) fn(s[k])
    }
    set('text', setText)
    set('fontSize', setFontSize)
    set('fontWeight', setFontWeight)
    set('letterSpacing', setLetterSpacing)
    set('lineHeight', setLineHeight)
    set('textTransform', setTextTransform)
    set('align', setAlign)
    set('offsetX', setOffsetX)
    set('offsetY', setOffsetY)
    set('activeGreen', setActiveGreen)
    set('secondaryColor', setSecondaryColor)
    set('logoEnabled', setLogoEnabled)
    set('logoSize', setLogoSize)
    set('logoX', setLogoX)
    set('logoY', setLogoY)
    set('activeAnim', setActiveAnim)
    set('formatIdx', setFormatIdx)
    set('duration', setDuration)
    if (s.animParams) {
      setAnimParams((prev) => {
        const next = { ...prev }
        for (const id in next) {
          if (s.animParams[id]) next[id] = { ...next[id], ...s.animParams[id] }
        }
        return next
      })
    }
  }

  // Autosave the current look on every change, so nothing is lost across
  // reloads or after an export finishes.
  useEffect(() => {
    saveAutosave(collectSettings())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    text, fontSize, fontWeight, letterSpacing, lineHeight, textTransform,
    align, offsetX, offsetY, activeGreen, secondaryColor,
    logoEnabled, logoSize, logoX, logoY,
    activeAnim, animParams, formatIdx, duration,
  ])

  function saveCurrentPreset() {
    const name = presetName.trim()
    if (!name) return
    const next = [
      ...presets.filter((p) => p.name !== name),
      { name, settings: collectSettings() },
    ]
    setPresets(next)
    savePresets(next)
    setPresetName('')
  }

  function deletePreset(name) {
    const next = presets.filter((p) => p.name !== name)
    setPresets(next)
    savePresets(next)
  }

  // Sync render options into the ref every render.
  optsRef.current = {
    width: format.width,
    height: format.height,
    text,
    fontSize,
    fontWeight,
    letterSpacing,
    lineHeight,
    textTransform,
    align,
    offsetX,
    offsetY,
    activeGreen,
    secondaryColor,
    animation: activeAnim,
    params: animParams[activeAnim],
    logo: {
      enabled: logoEnabled,
      image: logoImage,
      size: logoSize,
      offsetX: logoX,
      offsetY: logoY,
    },
  }

  // The animation loop.
  useEffect(() => {
    if (!fontReady) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const loop = (t) => {
      // While exporting video we let the loop keep running so captureStream
      // has live frames.
      const time = playing ? t : frozenTimeRef.current
      if (playing) frozenTimeRef.current = t
      renderFrame(ctx, time, optsRef.current)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [fontReady, playing])

  // ---- Export handlers ----
  async function handleExportVideo() {
    if (exporting) return
    // Video capture needs the live canvas to be animating.
    const wasPlaying = playing
    setPlaying(true)
    setExporting('video')
    setProgress(0)
    try {
      await exportVideo(canvasRef.current, duration, setProgress)
    } catch (err) {
      console.error('Video export failed:', err)
      alert('No se pudo exportar el video: ' + err.message)
    } finally {
      setExporting(null)
      setProgress(0)
      setPlaying(wasPlaying)
    }
  }

  async function handleExportGif() {
    if (exporting) return
    setExporting('gif')
    setProgress(0)
    try {
      await exportGif({ ...optsRef.current }, duration, 15, setProgress)
    } catch (err) {
      console.error('GIF export failed:', err)
      alert('No se pudo exportar el GIF: ' + err.message)
    } finally {
      setExporting(null)
      setProgress(0)
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <h1>Bong Swap Tool</h1>
        <span className="version">v1.0</span>
      </div>

      <div className="main">
        <aside className="sidebar">
          {/* ---------------- TEXTO ---------------- */}
          <section className="section">
            <p className="section-title">Texto</p>

            <div className="field">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
              />
            </div>

            <div className="field">
              <label>
                Font size <span className="value">{fontSize}px</span>
              </label>
              <input
                type="range"
                min={40}
                max={400}
                step={1}
                value={fontSize}
                onChange={(e) => setFontSize(+e.target.value)}
              />
            </div>

            <div className="field">
              <label>Font weight</label>
              <div className="pill-row">
                {FONT_WEIGHTS.map((w) => (
                  <button
                    key={w}
                    className={`pill ${fontWeight === w ? 'active' : ''}`}
                    onClick={() => setFontWeight(w)}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>
                Letter spacing{' '}
                <span className="value">{letterSpacing.toFixed(2)}em</span>
              </label>
              <input
                type="range"
                min={-0.1}
                max={0.5}
                step={0.01}
                value={letterSpacing}
                onChange={(e) => setLetterSpacing(+e.target.value)}
              />
            </div>

            <div className="field">
              <label>
                Line height{' '}
                <span className="value">{lineHeight.toFixed(2)}</span>
              </label>
              <input
                type="range"
                min={0.7}
                max={2.0}
                step={0.05}
                value={lineHeight}
                onChange={(e) => setLineHeight(+e.target.value)}
              />
            </div>

            <div className="field">
              <label>Text transform</label>
              <div className="toggle">
                <button
                  className={textTransform === 'none' ? 'active' : ''}
                  onClick={() => setTextTransform('none')}
                >
                  none
                </button>
                <button
                  className={textTransform === 'uppercase' ? 'active' : ''}
                  onClick={() => setTextTransform('uppercase')}
                >
                  UPPER
                </button>
              </div>
            </div>

            <div className="field">
              <label>Alineación</label>
              <div className="toggle">
                {[
                  { v: 'left', l: '⇤ Izq' },
                  { v: 'center', l: '↔ Centro' },
                  { v: 'right', l: 'Der ⇥' },
                ].map((o) => (
                  <button
                    key={o.v}
                    className={align === o.v ? 'active' : ''}
                    onClick={() => setAlign(o.v)}
                  >
                    {o.l}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label>
                Posición X <span className="value">{offsetX}%</span>
              </label>
              <input
                type="range"
                min={-50}
                max={50}
                step={1}
                value={offsetX}
                onChange={(e) => setOffsetX(+e.target.value)}
              />
            </div>

            <div className="field">
              <label>
                Posición Y <span className="value">{offsetY}%</span>
              </label>
              <input
                type="range"
                min={-50}
                max={50}
                step={1}
                value={offsetY}
                onChange={(e) => setOffsetY(+e.target.value)}
              />
            </div>

            {(offsetX !== 0 || offsetY !== 0) && (
              <button
                className="play-btn"
                onClick={() => {
                  setOffsetX(0)
                  setOffsetY(0)
                }}
              >
                Reset posición
              </button>
            )}
          </section>

          {/* ---------------- COLOR ---------------- */}
          <section className="section">
            <p className="section-title">Color</p>
            <div className="field">
              <label>Verde activo</label>
              <div className="swatches">
                {BONG_GREENS.map((g) => (
                  <button
                    key={g.name}
                    className={`swatch ${
                      activeGreen.toUpperCase() === g.hex.toUpperCase()
                        ? 'active'
                        : ''
                    }`}
                    style={{ background: g.hex }}
                    title={`${g.name} · ${g.label}`}
                    onClick={() => setActiveGreen(g.hex)}
                  />
                ))}
              </div>
              <ColorField value={activeGreen} onChange={setActiveGreen} />
            </div>
            <div className="field">
              <label>Color secundario (swap)</label>
              <ColorField value={secondaryColor} onChange={setSecondaryColor} />
            </div>
          </section>

          {/* ---------------- LOGO ---------------- */}
          <section className="section">
            <p className="section-title">Logo Bong</p>
            <div className="field">
              <label>Mostrar logo</label>
              <div className="toggle">
                <button
                  className={!logoEnabled ? 'active' : ''}
                  onClick={() => setLogoEnabled(false)}
                >
                  Off
                </button>
                <button
                  className={logoEnabled ? 'active' : ''}
                  onClick={() => setLogoEnabled(true)}
                >
                  On
                </button>
              </div>
            </div>

            {logoEnabled && (
              <>
                <p className="hint">
                  El logo toma el color del texto y swappea junto con él.
                </p>
                <div className="field">
                  <label>
                    Tamaño <span className="value">{logoSize}%</span>
                  </label>
                  <input
                    type="range"
                    min={4}
                    max={80}
                    step={1}
                    value={logoSize}
                    onChange={(e) => setLogoSize(+e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>
                    Posición X <span className="value">{logoX}%</span>
                  </label>
                  <input
                    type="range"
                    min={-50}
                    max={50}
                    step={1}
                    value={logoX}
                    onChange={(e) => setLogoX(+e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>
                    Posición Y <span className="value">{logoY}%</span>
                  </label>
                  <input
                    type="range"
                    min={-50}
                    max={50}
                    step={1}
                    value={logoY}
                    onChange={(e) => setLogoY(+e.target.value)}
                  />
                </div>
                {(logoX !== 0 || logoY !== 0) && (
                  <button
                    className="play-btn"
                    onClick={() => {
                      setLogoX(0)
                      setLogoY(0)
                    }}
                  >
                    Reset posición logo
                  </button>
                )}
              </>
            )}
          </section>

          {/* ---------------- ANIMACIÓN ---------------- */}
          <section className="section">
            <p className="section-title">Animación</p>

            <div className="anim-grid">
              {ANIMATIONS.map((a) => (
                <button
                  key={a.id}
                  className={`anim-btn ${activeAnim === a.id ? 'active' : ''}`}
                  title={a.name}
                  onClick={() => setActiveAnim(a.id)}
                >
                  {a.abbr}
                </button>
              ))}
            </div>

            {activeAnimDef.photosensitive && (
              <p className="warning">
                ⚠ Advertencia de fotosensibilidad · destellos rápidos
              </p>
            )}

            {/* Controles propios de la animación activa */}
            {activeAnimDef.controls.map((c) => {
              const val = animParams[activeAnim][c.key]
              if (c.type === 'range') {
                const display =
                  c.decimals != null ? val.toFixed(c.decimals) : val
                return (
                  <div className="field" key={c.key}>
                    <label>
                      {c.label}{' '}
                      <span className="value">
                        {display}
                        {c.unit || ''}
                      </span>
                    </label>
                    <input
                      type="range"
                      min={c.min}
                      max={c.max}
                      step={c.step}
                      value={val}
                      onChange={(e) => setParam(c.key, +e.target.value)}
                    />
                  </div>
                )
              }
              // toggle / select
              return (
                <div className="field" key={c.key}>
                  <label>{c.label}</label>
                  <div className="toggle">
                    {c.options.map((o) => (
                      <button
                        key={String(o.value)}
                        className={val === o.value ? 'active' : ''}
                        onClick={() => setParam(c.key, o.value)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}

            <button
              className="play-btn"
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? '❚❚ Pause' : '▶ Play'}
            </button>
          </section>

          {/* ---------------- CANVAS ---------------- */}
          <section className="section">
            <p className="section-title">Canvas</p>
            <div className="field">
              <label>Formato</label>
              <select
                value={formatIdx}
                onChange={(e) => setFormatIdx(+e.target.value)}
              >
                {FORMATS.map((f, i) => (
                  <option key={f.label} value={i}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* ---------------- EXPORT ---------------- */}
          <section className="section">
            <p className="section-title">Export</p>
            <div className="field">
              <label>Duración</label>
              <select
                value={duration}
                onChange={(e) => setDuration(+e.target.value)}
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d}s
                  </option>
                ))}
              </select>
            </div>
            <div className="export-row">
              <button
                className="btn-export"
                onClick={handleExportVideo}
                disabled={!!exporting}
              >
                {exporting === 'video' ? '…' : 'MP4'}
              </button>
              <button
                className="btn-export"
                onClick={handleExportGif}
                disabled={!!exporting}
              >
                {exporting === 'gif' ? '…' : 'GIF'}
              </button>
            </div>
            {exporting && (
              <>
                <div className="progress">
                  <span style={{ width: `${Math.round(progress * 100)}%` }} />
                </div>
                <p className="progress-label">
                  {exporting === 'video' ? 'Grabando' : 'Codificando GIF'} ·{' '}
                  {Math.round(progress * 100)}%
                </p>
              </>
            )}
          </section>

          {/* ---------------- PRESETS ---------------- */}
          <section className="section">
            <p className="section-title">Presets</p>
            <p className="hint">
              Tus ajustes se guardan solos. Guardá combinaciones con nombre para
              reusarlas.
            </p>
            <div className="preset-save">
              <input
                type="text"
                placeholder="Nombre del preset"
                value={presetName}
                spellCheck={false}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveCurrentPreset()}
              />
              <button
                className="btn-export"
                onClick={saveCurrentPreset}
                disabled={!presetName.trim()}
              >
                Guardar
              </button>
            </div>
            {presets.length > 0 && (
              <ul className="preset-list">
                {presets.map((p) => (
                  <li key={p.name}>
                    <button
                      className="preset-load"
                      onClick={() => applySettings(p.settings)}
                      title="Cargar preset"
                    >
                      {p.name}
                    </button>
                    <button
                      className="preset-del"
                      onClick={() => deletePreset(p.name)}
                      title="Eliminar"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>

        <main className="stage">
          <canvas
            ref={canvasRef}
            width={format.width}
            height={format.height}
          />
        </main>
      </div>
    </div>
  )
}
