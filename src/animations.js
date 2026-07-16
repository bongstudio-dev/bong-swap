// Modular animation system.
//
// Every animation is a pure renderer: (ctx, t, config) => void. It paints one
// complete frame. The live preview loop and both exporters call the exact same
// renderers, so what you see is what gets recorded.
//
// `config` carries the shared text/color state plus `config.params`, the active
// animation's own control values, and `config.animation`, the active id.

/* ---------------------------------------------------------------------------
 * Shared helpers
 * ------------------------------------------------------------------------- */

function hexToRgb(hex) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Interpolate between two hex colors. Returns an rgb() string.
export function lerpColor(a, b, t) {
  const A = hexToRgb(a)
  const B = hexToRgb(b)
  const r = Math.round(A[0] + (B[0] - A[0]) * t)
  const g = Math.round(A[1] + (B[1] - A[1]) * t)
  const bl = Math.round(A[2] + (B[2] - A[2]) * t)
  return `rgb(${r},${g},${bl})`
}

// Seeded PRNG so GLITCH and SCRAMBLE are deterministic per time-bucket — the
// same timestamp always yields the same frame, which keeps GIF exports stable.
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

function applyFont(ctx, config, weight) {
  const w = weight ?? config.fontWeight
  ctx.font = `${w} ${config.fontSize}px Satoshi, sans-serif`
}

function getLines(config) {
  return config.text
    .split('\n')
    .map((l) => (config.textTransform === 'uppercase' ? l.toUpperCase() : l))
}

// The text anchor: canvas center shifted by the user's manual offset. offsetX/
// offsetY are percentages of the canvas dimensions (-50..50), so positioning is
// independent of the chosen format. Every renderer anchors here.
function anchorPoint(config) {
  const ox = ((config.offsetX || 0) / 100) * config.width
  const oy = ((config.offsetY || 0) / 100) * config.height
  return { ax: config.width / 2 + ox, ay: config.height / 2 + oy }
}

// Offscreen canvas reused to tint the logo silhouette per frame.
let _logoTintCanvas = null
function logoTintCanvas(w, h) {
  if (!_logoTintCanvas) _logoTintCanvas = document.createElement('canvas')
  if (_logoTintCanvas.width !== w) _logoTintCanvas.width = w
  if (_logoTintCanvas.height !== h) _logoTintCanvas.height = h
  return _logoTintCanvas
}

// Draw the Bong logo on top of the animation, tinted with the frame's current
// TEXT color (config._logoTint) so it swaps in lockstep with the text. Reads
// config.logo: { enabled, image, size (% of canvas height), offsetX, offsetY }.
// No-op until the image has decoded.
export function drawLogo(ctx, config) {
  const logo = config.logo
  if (!logo || !logo.enabled) return
  const img = logo.image
  if (!img || !img.complete || !img.naturalWidth) return
  const h = (logo.size / 100) * config.height
  const w = h * (img.naturalWidth / img.naturalHeight)
  const cx = config.width / 2 + ((logo.offsetX || 0) / 100) * config.width
  const cy = config.height / 2 + ((logo.offsetY || 0) / 100) * config.height
  const tint = config._logoTint || config.secondaryColor || '#FFFFFF'

  // Recolor the logo to `tint` on an offscreen canvas via source-in, so any
  // tint works regardless of the source SVG's baked color.
  const iw = Math.max(1, Math.round(w))
  const ih = Math.max(1, Math.round(h))
  const tc = logoTintCanvas(iw, ih)
  const tctx = tc.getContext('2d')
  tctx.clearRect(0, 0, iw, ih)
  tctx.drawImage(img, 0, 0, iw, ih)
  tctx.globalCompositeOperation = 'source-in'
  tctx.fillStyle = tint
  tctx.fillRect(0, 0, iw, ih)
  tctx.globalCompositeOperation = 'source-over'

  ctx.drawImage(tc, cx - w / 2, cy - h / 2, w, h)
}

// Draw a centered multi-line text block at (cx, cy). Handles letter spacing
// natively where available (Chrome/Edge) and falls back to manual per-glyph
// placement elsewhere (Firefox/Safari).
export function drawTextBlock(ctx, config, cx, cy, color, weight) {
  applyFont(ctx, config, weight)
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  const align = config.align || 'center'
  const spacing = config.letterSpacing * config.fontSize
  const lines = getLines(config)
  const lineStep = config.fontSize * config.lineHeight
  const startY = cy - (lines.length * lineStep) / 2 + lineStep / 2
  const native = 'letterSpacing' in ctx

  if (native) {
    // (cx, cy) is the horizontal anchor per alignment; canvas handles the rest.
    ctx.textAlign = align
    ctx.letterSpacing = `${spacing}px`
    lines.forEach((line, i) => ctx.fillText(line, cx, startY + i * lineStep))
    ctx.letterSpacing = '0px'
  } else {
    ctx.textAlign = 'left'
    lines.forEach((line, i) => {
      const chars = [...line]
      const lw =
        chars.reduce((a, c) => a + ctx.measureText(c).width, 0) +
        spacing * Math.max(0, chars.length - 1)
      let x = align === 'left' ? cx : align === 'right' ? cx - lw : cx - lw / 2
      const y = startY + i * lineStep
      for (const ch of chars) {
        ctx.fillText(ch, x, y)
        x += ctx.measureText(ch).width + spacing
      }
    })
  }
}

// Lay out every glyph with positions RELATIVE TO THE TEXT CENTER (0,0). Callers
// translate to the canvas center and can then offset individual glyphs. `index`
// runs sequentially across all lines. Positions assume textAlign='left'.
export function layoutChars(ctx, config, weight) {
  applyFont(ctx, config, weight)
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
  const align = config.align || 'center'
  const lines = getLines(config)
  const spacing = config.letterSpacing * config.fontSize
  const lineStep = config.fontSize * config.lineHeight
  const startY = -(lines.length * lineStep) / 2 + lineStep / 2
  const chars = []
  lines.forEach((line, li) => {
    const cs = [...line]
    const widths = cs.map((c) => ctx.measureText(c).width)
    const lw =
      widths.reduce((a, b) => a + b, 0) + spacing * Math.max(0, cs.length - 1)
    // Positions are relative to the anchor: left edge, center, or right edge.
    let x = align === 'left' ? 0 : align === 'right' ? -lw : -lw / 2
    const y = startY + li * lineStep
    cs.forEach((c, ci) => {
      chars.push({ char: c, x, width: widths[ci], y, line: li, index: chars.length })
      x += widths[ci] + spacing
    })
  })
  return { chars, lineStep }
}

const CHARSETS = {
  letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  numbers: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}<>?/\\|',
  mixed: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*<>?/',
}

// Scratch canvas reused by GLITCH for snapshot-based slice displacement.
let _scratch = null
function getScratch(w, h) {
  if (!_scratch) _scratch = document.createElement('canvas')
  if (_scratch.width !== w) _scratch.width = w
  if (_scratch.height !== h) _scratch.height = h
  return _scratch
}

/* ---------------------------------------------------------------------------
 * Renderers
 * ------------------------------------------------------------------------- */

function renderSwap(ctx, t, config) {
  const { width: w, height: h, activeGreen: green, secondaryColor: sec } = config
  const { ax, ay } = anchorPoint(config)
  const interval = 60000 / config.params.bpm
  const isA = Math.floor(t / interval) % 2 === 0
  const textColor = isA ? sec : green
  ctx.fillStyle = isA ? green : sec
  ctx.fillRect(0, 0, w, h)
  config._logoTint = textColor
  drawTextBlock(ctx, config, ax, ay, textColor)
}

function renderPulse(ctx, t, config) {
  const { width: w, height: h, activeGreen: green, secondaryColor: sec } = config
  const { bpm, intensity } = config.params
  const { ax, ay } = anchorPoint(config)
  ctx.fillStyle = green
  ctx.fillRect(0, 0, w, h)
  const scale = 1 + (intensity - 1) * Math.abs(Math.sin((t * Math.PI * bpm) / 60000))
  ctx.save()
  ctx.translate(ax, ay)
  ctx.scale(scale, scale)
  drawTextBlock(ctx, config, 0, 0, sec)
  ctx.restore()
}

function renderWave(ctx, t, config) {
  const { width: w, height: h, activeGreen: green, secondaryColor: sec } = config
  const { amplitude, frequency, speed } = config.params
  const { ax, ay } = anchorPoint(config)
  ctx.fillStyle = green
  ctx.fillRect(0, 0, w, h)
  const { chars } = layoutChars(ctx, config)
  ctx.fillStyle = sec
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.save()
  ctx.translate(ax, ay)
  chars.forEach((c) => {
    const y = c.y + amplitude * Math.sin(frequency * c.index + (speed * t) / 500)
    ctx.fillText(c.char, c.x, y)
  })
  ctx.restore()
}

function renderTypewriter(ctx, t, config) {
  const { width: w, height: h, activeGreen: green, secondaryColor: sec } = config
  const { speed, pause } = config.params
  const { ax, ay } = anchorPoint(config)
  ctx.fillStyle = green
  ctx.fillRect(0, 0, w, h)
  const { chars } = layoutChars(ctx, config)
  const total = chars.length
  const typeDur = (total / speed) * 1000
  const cycle = typeDur + pause * 1000
  const localT = cycle > 0 ? t % cycle : 0
  const revealed = Math.min(
    localT < typeDur ? Math.floor((localT / 1000) * speed) : total,
    total,
  )
  ctx.fillStyle = sec
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.save()
  ctx.translate(ax, ay)
  for (let i = 0; i < revealed; i++) ctx.fillText(chars[i].char, chars[i].x, chars[i].y)
  // Blinking cursor at 2Hz.
  if (Math.floor(t / 250) % 2 === 0) {
    let cx = 0
    let cy = 0
    if (revealed < total) {
      cx = chars[revealed].x
      cy = chars[revealed].y
    } else if (total > 0) {
      const last = chars[total - 1]
      cx = last.x + last.width
      cy = last.y
    }
    const cw = config.fontSize * 0.08
    const ch = config.fontSize * 0.7
    ctx.fillRect(cx, cy - ch / 2, cw, ch)
  }
  ctx.restore()
}

function renderGlitch(ctx, t, config) {
  const { width: w, height: h, activeGreen: green, secondaryColor: sec } = config
  const { frequency, intensity } = config.params
  const { ax, ay } = anchorPoint(config)
  // Base frame.
  ctx.fillStyle = green
  ctx.fillRect(0, 0, w, h)
  drawTextBlock(ctx, config, ax, ay, sec)

  const interval = 1000 / frequency
  const bucket = Math.floor(t / interval)
  const rng = mulberry32((bucket * 2654435761) >>> 0)
  const localT = t - bucket * interval
  const dur = 50 + rng() * 100 // 50–150ms glitch burst
  if (localT > dur) return

  // Snapshot, then rebuild the frame from displaced slices.
  const s = getScratch(w, h)
  const sctx = s.getContext('2d')
  sctx.clearRect(0, 0, w, h)
  sctx.drawImage(ctx.canvas, 0, 0)

  ctx.fillStyle = green
  ctx.fillRect(0, 0, w, h)
  const nSlices = 3 + Math.floor(rng() * 4) // 3–6 slices
  for (let i = 0; i < nSlices; i++) {
    const sy = Math.floor((h * i) / nSlices)
    const sh = Math.ceil(h / nSlices)
    const dx = (rng() * 2 - 1) * intensity
    ctx.drawImage(s, 0, sy, w, sh, dx, sy, w, sh)
  }

  // Chromatic aberration.
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  ctx.globalAlpha = 0.6
  const off = intensity * 0.5
  drawTextBlock(ctx, config, ax + off, ay, '#ff0044')
  drawTextBlock(ctx, config, ax - off, ay, '#00ffcc')
  ctx.restore()

  // Scan lines.
  ctx.save()
  ctx.globalAlpha = 0.12
  ctx.fillStyle = '#000'
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 2)
  ctx.restore()
}

function drawSpacedLine(ctx, line, x, y, spacing) {
  for (const ch of line) {
    ctx.fillText(ch, x, y)
    x += ctx.measureText(ch).width + spacing
  }
}

function renderMarquee(ctx, t, config) {
  const { width: w, height: h, activeGreen: green, secondaryColor: sec } = config
  const { speed, direction } = config.params
  const { ay } = anchorPoint(config)
  ctx.fillStyle = green
  ctx.fillRect(0, 0, w, h)
  applyFont(ctx, config)
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px'
  ctx.fillStyle = sec
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const line = getLines(config).join('  ')
  const spacing = config.letterSpacing * config.fontSize
  const chars = [...line]
  const textWidth =
    chars.reduce((a, c) => a + ctx.measureText(c).width, 0) +
    spacing * Math.max(0, chars.length - 1)
  const gap = w * 0.4
  const total = textWidth + gap
  const offset = ((t * speed) / 1000) % total
  const dir = direction === 'right' ? 1 : -1
  const baseX = dir < 0 ? w - offset : offset - textWidth
  // Draw three copies so the loop is seamless in both directions.
  for (let k = -1; k <= 1; k++) {
    drawSpacedLine(ctx, line, baseX + k * total, ay, spacing)
  }
}

// Analytic bounce: vertical offset above baseline after time `tau` (seconds),
// dropped from height h0 under gravity g with restitution e. Bounded iteration.
function bounceOffset(tau, h0, g, e) {
  if (tau <= 0) return h0
  const tFall = Math.sqrt((2 * h0) / g)
  if (tau < tFall) return h0 - 0.5 * g * tau * tau
  let rem = tau - tFall
  let hk = h0 * e * e
  while (hk > h0 * 0.01) {
    const vk = Math.sqrt(2 * g * hk)
    const Tk = (2 * vk) / g
    if (rem < Tk) return vk * rem - 0.5 * g * rem * rem
    rem -= Tk
    hk *= e * e
  }
  return 0
}

function bounceSettleTime(h0, g, e) {
  let total = Math.sqrt((2 * h0) / g)
  let hk = h0 * e * e
  while (hk > h0 * 0.01) {
    total += (2 * Math.sqrt(2 * g * hk)) / g
    hk *= e * e
  }
  return total
}

function renderBounce(ctx, t, config) {
  const { width: w, height: h, activeGreen: green, secondaryColor: sec } = config
  const { gravity, elasticity, mode } = config.params
  const { ax, ay } = anchorPoint(config)
  ctx.fillStyle = green
  ctx.fillRect(0, 0, w, h)
  const { chars } = layoutChars(ctx, config)
  ctx.fillStyle = sec
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  // Group glyphs into elements (whole words or individual characters).
  let elements
  if (mode === 'char') {
    elements = chars.map((c) => ({ items: [c] }))
  } else {
    elements = []
    let cur = null
    chars.forEach((c) => {
      if (c.char === ' ') {
        cur = null
        return
      }
      if (!cur) {
        cur = { items: [] }
        elements.push(cur)
      }
      cur.items.push(c)
    })
  }
  elements.forEach((el, i) => (el.order = i))

  const g = gravity * 2200 // px/s²
  const e = elasticity
  const h0 = h * 0.6
  const stagger = 0.12 // s between element entrances
  const settle = bounceSettleTime(h0, g, e)
  const cycle = settle + stagger * elements.length + 1.2 // + 1.2s hold
  const localT = (t / 1000) % cycle

  ctx.save()
  ctx.translate(ax, ay)
  elements.forEach((el) => {
    const tau = localT - el.order * stagger
    const off = tau <= 0 ? h0 : bounceOffset(tau, h0, g, e)
    el.items.forEach((c) => ctx.fillText(c.char, c.x, c.y - off))
  })
  ctx.restore()
}

function renderScramble(ctx, t, config) {
  const { width: w, height: h, activeGreen: green, secondaryColor: sec } = config
  const { speed, charset } = config.params
  const { ax, ay } = anchorPoint(config)
  ctx.fillStyle = green
  ctx.fillRect(0, 0, w, h)
  const { chars } = layoutChars(ctx, config)
  ctx.fillStyle = sec
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const set = CHARSETS[charset] || CHARSETS.mixed
  const total = chars.length
  const charInterval = 1000 / speed
  const cycle = total * charInterval + 1600 // resolve, then hold 1.6s
  const localT = t % cycle
  const resolved = Math.min(Math.floor(localT / charInterval), total)
  const bucket = Math.floor(t / 50) // mutate random glyphs every 50ms
  ctx.save()
  ctx.translate(ax, ay)
  chars.forEach((c, i) => {
    let ch
    if (i < resolved || c.char === ' ') {
      ch = c.char
    } else {
      const rng = mulberry32(((bucket * 73856093) ^ (i * 19349663)) >>> 0)
      ch = set[Math.floor(rng() * set.length)]
    }
    ctx.fillText(ch, c.x, c.y)
  })
  ctx.restore()
}

function renderSplit(ctx, t, config) {
  const { width: w, height: h, activeGreen: green, secondaryColor: sec } = config
  const { speed, orientation } = config.params
  const { ax, ay } = anchorPoint(config)
  const drawA = () => {
    ctx.fillStyle = green
    ctx.fillRect(0, 0, w, h)
    drawTextBlock(ctx, config, ax, ay, sec)
  }
  const drawB = () => {
    ctx.fillStyle = sec
    ctx.fillRect(0, 0, w, h)
    drawTextBlock(ctx, config, ax, ay, green)
  }
  // Logo takes the text color of the region it sits in: region A text = sec,
  // region B text = green.
  const logoCx = w / 2 + ((config.logo?.offsetX || 0) / 100) * w
  const logoCy = h / 2 + ((config.logo?.offsetY || 0) / 100) * h
  if (orientation === 'vertical') {
    const sx = w / 2 + (w / 2) * Math.sin((t * speed) / 1000)
    config._logoTint = logoCx < sx ? sec : green
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, sx, h)
    ctx.clip()
    drawA()
    ctx.restore()
    ctx.save()
    ctx.beginPath()
    ctx.rect(sx, 0, w - sx, h)
    ctx.clip()
    drawB()
    ctx.restore()
  } else {
    const sy = h / 2 + (h / 2) * Math.sin((t * speed) / 1000)
    config._logoTint = logoCy < sy ? sec : green
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, w, sy)
    ctx.clip()
    drawA()
    ctx.restore()
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, sy, w, h - sy)
    ctx.clip()
    drawB()
    ctx.restore()
  }
}

function renderStrobe(ctx, t, config) {
  const { width: w, height: h, activeGreen: green, secondaryColor: sec } = config
  const { bpm, threeColors } = config.params
  const { ax, ay } = anchorPoint(config)
  const colors = threeColors ? [green, sec, '#000000'] : [green, sec]
  const interval = 60000 / bpm
  const i = Math.floor(t / interval) % colors.length
  const textColor = colors[(i + 1) % colors.length]
  ctx.fillStyle = colors[i]
  ctx.fillRect(0, 0, w, h)
  config._logoTint = textColor
  drawTextBlock(ctx, config, ax, ay, textColor)
}

function renderWeightWave(ctx, t, config) {
  const { width: w, height: h, activeGreen: green, secondaryColor: sec } = config
  const { minWeight, maxWeight, speed } = config.params
  const { ax, ay } = anchorPoint(config)
  ctx.fillStyle = green
  ctx.fillRect(0, 0, w, h)
  // Lay out at the midpoint weight so glyph spacing stays roughly stable.
  const midWeight = Math.round((minWeight + maxWeight) / 2)
  const { chars } = layoutChars(ctx, config, midWeight)
  ctx.fillStyle = sec
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.save()
  ctx.translate(ax, ay)
  chars.forEach((c) => {
    const phase = c.index * 0.5 + (speed * t) / 1000
    const wt = Math.round(minWeight + (maxWeight - minWeight) * (0.5 + 0.5 * Math.sin(phase)))
    ctx.font = `${wt} ${config.fontSize}px Satoshi, sans-serif`
    ctx.fillText(c.char, c.x, c.y)
  })
  ctx.restore()
}

function renderRotate(ctx, t, config) {
  const { width: w, height: h, activeGreen: green, secondaryColor: sec } = config
  const { rpm, direction } = config.params
  const { ax, ay } = anchorPoint(config)
  const dir = direction === 'ccw' ? -1 : 1
  ctx.fillStyle = green
  ctx.fillRect(0, 0, w, h)
  const angle = (t / 60000) * rpm * 2 * Math.PI * dir
  ctx.save()
  ctx.translate(ax, ay)
  ctx.rotate(angle)
  drawTextBlock(ctx, config, 0, 0, sec)
  ctx.restore()
}

function renderFade(ctx, t, config) {
  const { width: w, height: h, activeGreen: green, secondaryColor: sec } = config
  const { bpm } = config.params
  const { ax, ay } = anchorPoint(config)
  const phase = ((t * bpm) / 60000) % 1
  const tri = phase < 0.5 ? phase * 2 : (1 - phase) * 2 // ping-pong 0→1→0
  const textColor = lerpColor(sec, green, tri)
  ctx.fillStyle = lerpColor(green, sec, tri)
  ctx.fillRect(0, 0, w, h)
  config._logoTint = textColor
  drawTextBlock(ctx, config, ax, ay, textColor)
}

/* ---------------------------------------------------------------------------
 * Registry
 * ------------------------------------------------------------------------- */

// Control metadata drives the generic UI. types: 'range' | 'toggle'.
export const ANIMATIONS = [
  {
    id: 'swap',
    abbr: 'SWP',
    name: 'Swap',
    render: renderSwap,
    controls: [{ key: 'bpm', label: 'BPM', type: 'range', min: 30, max: 240, step: 1, default: 120 }],
  },
  {
    id: 'pulse',
    abbr: 'PLS',
    name: 'Pulse',
    render: renderPulse,
    controls: [
      { key: 'bpm', label: 'BPM', type: 'range', min: 30, max: 180, step: 1, default: 120 },
      { key: 'intensity', label: 'Intensidad', type: 'range', min: 1.05, max: 1.5, step: 0.01, default: 1.15, decimals: 2, unit: '×' },
    ],
  },
  {
    id: 'wave',
    abbr: 'WAV',
    name: 'Wave',
    render: renderWave,
    controls: [
      { key: 'amplitude', label: 'Amplitud', type: 'range', min: 5, max: 60, step: 1, default: 20, unit: 'px' },
      { key: 'frequency', label: 'Frecuencia', type: 'range', min: 0.5, max: 5, step: 0.1, default: 1.5, decimals: 1 },
      { key: 'speed', label: 'Velocidad', type: 'range', min: 0.5, max: 5, step: 0.1, default: 2, decimals: 1 },
    ],
  },
  {
    id: 'typewriter',
    abbr: 'TYP',
    name: 'Typewriter',
    render: renderTypewriter,
    controls: [
      { key: 'speed', label: 'Velocidad', type: 'range', min: 5, max: 40, step: 1, default: 15, unit: ' c/s' },
      { key: 'pause', label: 'Pausa', type: 'range', min: 0.5, max: 3, step: 0.1, default: 1, decimals: 1, unit: 's' },
    ],
  },
  {
    id: 'glitch',
    abbr: 'GLT',
    name: 'Glitch',
    render: renderGlitch,
    controls: [
      { key: 'frequency', label: 'Frecuencia', type: 'range', min: 1, max: 10, step: 1, default: 3, unit: '/s' },
      { key: 'intensity', label: 'Intensidad', type: 'range', min: 5, max: 80, step: 1, default: 30, unit: 'px' },
    ],
  },
  {
    id: 'marquee',
    abbr: 'MRQ',
    name: 'Marquee',
    render: renderMarquee,
    controls: [
      { key: 'speed', label: 'Velocidad', type: 'range', min: 50, max: 500, step: 10, default: 150, unit: 'px/s' },
      {
        key: 'direction',
        label: 'Dirección',
        type: 'toggle',
        default: 'left',
        options: [
          { value: 'left', label: '← Izq' },
          { value: 'right', label: 'Der →' },
        ],
      },
    ],
  },
  {
    id: 'bounce',
    abbr: 'BNC',
    name: 'Bounce',
    render: renderBounce,
    controls: [
      { key: 'gravity', label: 'Gravedad', type: 'range', min: 0.5, max: 3, step: 0.1, default: 1, decimals: 1 },
      { key: 'elasticity', label: 'Elasticidad', type: 'range', min: 0.3, max: 0.9, step: 0.05, default: 0.6, decimals: 2 },
      {
        key: 'mode',
        label: 'Por',
        type: 'toggle',
        default: 'word',
        options: [
          { value: 'word', label: 'Palabra' },
          { value: 'char', label: 'Carácter' },
        ],
      },
    ],
  },
  {
    id: 'scramble',
    abbr: 'SCR',
    name: 'Scramble',
    render: renderScramble,
    controls: [
      { key: 'speed', label: 'Resolución', type: 'range', min: 5, max: 30, step: 1, default: 12, unit: ' c/s' },
      {
        key: 'charset',
        label: 'Charset',
        type: 'toggle',
        default: 'mixed',
        options: [
          { value: 'letters', label: 'ABC' },
          { value: 'numbers', label: '123' },
          { value: 'symbols', label: '#$%' },
          { value: 'mixed', label: 'Mix' },
        ],
      },
    ],
  },
  {
    id: 'split',
    abbr: 'SPL',
    name: 'Split',
    render: renderSplit,
    controls: [
      { key: 'speed', label: 'Velocidad', type: 'range', min: 0.5, max: 4, step: 0.1, default: 1, decimals: 1 },
      {
        key: 'orientation',
        label: 'Orientación',
        type: 'toggle',
        default: 'horizontal',
        options: [
          { value: 'horizontal', label: 'Horizontal' },
          { value: 'vertical', label: 'Vertical' },
        ],
      },
    ],
  },
  {
    id: 'strobe',
    abbr: 'STR',
    name: 'Strobe',
    render: renderStrobe,
    photosensitive: true,
    controls: [
      { key: 'bpm', label: 'BPM', type: 'range', min: 120, max: 600, step: 5, default: 300 },
      {
        key: 'threeColors',
        label: 'Colores',
        type: 'toggle',
        default: false,
        options: [
          { value: false, label: '2 colores' },
          { value: true, label: '3 (+negro)' },
        ],
      },
    ],
  },
  {
    id: 'weightWave',
    abbr: 'WGT',
    name: 'Weight Wave',
    render: renderWeightWave,
    controls: [
      { key: 'minWeight', label: 'Peso mín', type: 'range', min: 100, max: 700, step: 50, default: 300 },
      { key: 'maxWeight', label: 'Peso máx', type: 'range', min: 400, max: 900, step: 50, default: 900 },
      { key: 'speed', label: 'Velocidad', type: 'range', min: 0.5, max: 4, step: 0.1, default: 1.5, decimals: 1 },
    ],
  },
  {
    id: 'rotate',
    abbr: 'ROT',
    name: 'Rotate',
    render: renderRotate,
    controls: [
      { key: 'rpm', label: 'RPM', type: 'range', min: 1, max: 60, step: 1, default: 10 },
      {
        key: 'direction',
        label: 'Dirección',
        type: 'toggle',
        default: 'cw',
        options: [
          { value: 'cw', label: 'CW ↻' },
          { value: 'ccw', label: 'CCW ↺' },
        ],
      },
    ],
  },
  {
    id: 'fade',
    abbr: 'FDE',
    name: 'Fade',
    render: renderFade,
    controls: [{ key: 'bpm', label: 'BPM', type: 'range', min: 20, max: 120, step: 1, default: 60 }],
  },
]

export const ANIMATIONS_BY_ID = Object.fromEntries(ANIMATIONS.map((a) => [a.id, a]))

// Build the default params for every animation, keyed by id.
export function buildDefaultParams() {
  const out = {}
  for (const a of ANIMATIONS) {
    out[a.id] = {}
    for (const c of a.controls) out[a.id][c.key] = c.default
  }
  return out
}
