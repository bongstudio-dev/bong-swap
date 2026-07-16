// Tiny localStorage layer for autosave + named presets. All wrapped in
// try/catch so a disabled/full storage never breaks the app.

const AUTOSAVE_KEY = 'bong-swap:autosave'
const PRESETS_KEY = 'bong-swap:presets'

function loadJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v ? JSON.parse(v) : fallback
  } catch {
    return fallback
  }
}

function saveJSON(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val))
  } catch {
    /* storage unavailable — ignore */
  }
}

// Autosave: the full current settings, restored on next load.
export const loadAutosave = () => loadJSON(AUTOSAVE_KEY, null)
export const saveAutosave = (settings) => saveJSON(AUTOSAVE_KEY, settings)

// Named presets: an array of { name, settings }.
export const loadPresets = () => loadJSON(PRESETS_KEY, [])
export const savePresets = (presets) => saveJSON(PRESETS_KEY, presets)
