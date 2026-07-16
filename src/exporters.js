import GIF from 'gif.js'
import { renderFrame } from './render.js'

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // Give the browser a tick before revoking so the download can start.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Pick the best mime type the browser supports, preferring real MP4 (H.264)
// so the download is an .mp4. Modern Chrome/Safari record MP4 natively; older
// browsers only do WebM, so we fall back to that. Returns { mimeType, ext }.
function pickVideoFormat() {
  const candidates = [
    { mimeType: 'video/mp4;codecs=avc1.640028', ext: 'mp4' }, // H.264 high
    { mimeType: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' }, // H.264 baseline
    { mimeType: 'video/mp4;codecs=avc1', ext: 'mp4' },
    { mimeType: 'video/mp4', ext: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', ext: 'webm' },
    { mimeType: 'video/webm', ext: 'webm' },
  ]
  for (const c of candidates) {
    if (
      typeof MediaRecorder !== 'undefined' &&
      MediaRecorder.isTypeSupported(c.mimeType)
    ) {
      return c
    }
  }
  return { mimeType: 'video/webm', ext: 'webm' }
}

/**
 * Record the live canvas for `durationSec` seconds via MediaRecorder and
 * download it — as .mp4 where the browser supports H.264, else .webm.
 * Returns a promise that resolves when the download fires.
 *
 * @param {HTMLCanvasElement} canvas  The already-animating preview canvas.
 * @param {number} durationSec
 * @param {(pct:number)=>void} onProgress
 */
export function exportVideo(canvas, durationSec, onProgress) {
  return new Promise((resolve, reject) => {
    let stream
    try {
      stream = canvas.captureStream(30)
    } catch (err) {
      reject(err)
      return
    }

    const { mimeType, ext } = pickVideoFormat()
    // Container type without the codec suffix, for the final Blob.
    const blobType = mimeType.split(';')[0]
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    })

    const chunks = []
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }
    recorder.onerror = (e) => reject(e.error || new Error('MediaRecorder error'))
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: blobType })
      download(blob, `bong-swap-${Date.now()}.${ext}`)
      onProgress?.(1)
      resolve()
    }

    const startTime = performance.now()
    // Emit chunks periodically so we can drive a progress bar.
    recorder.start(100)

    const tick = () => {
      const elapsed = (performance.now() - startTime) / 1000
      const pct = Math.min(elapsed / durationSec, 1)
      onProgress?.(pct)
      if (elapsed >= durationSec) {
        recorder.stop()
      } else {
        requestAnimationFrame(tick)
      }
    }
    requestAnimationFrame(tick)
  })
}

/**
 * Render frames offscreen and encode a GIF with gif.js.
 *
 * @param {object} renderOpts  Same options object passed to renderFrame.
 * @param {number} durationSec
 * @param {number} fps
 * @param {(pct:number)=>void} onProgress
 */
export function exportGif(renderOpts, durationSec, fps = 15, onProgress) {
  return new Promise((resolve, reject) => {
    const { width, height } = renderOpts

    // Dedicated offscreen canvas so we control the exact frame timing.
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')

    const gif = new GIF({
      workers: 2,
      quality: 10,
      width,
      height,
      // Respect Vite's base path so the worker resolves under /bong-swap/ on
      // GitHub Pages (and / in local dev).
      workerScript: import.meta.env.BASE_URL + 'gif.worker.js',
    })

    const totalFrames = Math.round(durationSec * fps)
    const frameInterval = 1000 / fps // ms per frame

    for (let i = 0; i < totalFrames; i++) {
      renderFrame(ctx, i * frameInterval, renderOpts)
      gif.addFrame(ctx, { copy: true, delay: frameInterval })
    }

    // gif.js progress covers the encoding phase (0..1).
    gif.on('progress', (p) => onProgress?.(p))
    gif.on('finished', (blob) => {
      download(blob, `bong-swap-${Date.now()}.gif`)
      onProgress?.(1)
      resolve()
    })
    // gif.js has no explicit error event; guard the render call.
    try {
      gif.render()
    } catch (err) {
      reject(err)
    }
  })
}
