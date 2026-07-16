// Frame dispatcher. Looks up the active animation renderer, delegates to it,
// then paints the logo on top. Shared by the live preview loop and both
// exporters so preview == export.
import { ANIMATIONS_BY_ID, drawLogo } from './animations.js'

/**
 * Render one frame at a given timestamp (ms).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} timestamp   Time in ms driving the animation phase.
 * @param {object} config      Shared text/color state + { animation, params, logo }.
 */
export function renderFrame(ctx, timestamp, config) {
  // Default logo tint = the text color (secondary). Renderers whose text color
  // varies over the frame (swap, fade, strobe, split) override this so the logo
  // tracks the text exactly.
  config._logoTint = config.secondaryColor
  const anim = ANIMATIONS_BY_ID[config.animation] || ANIMATIONS_BY_ID.swap
  anim.render(ctx, timestamp, config)
  drawLogo(ctx, config)
}
