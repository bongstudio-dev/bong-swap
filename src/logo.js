// Bong logo as inline SVG. The source fill is the brand green 700 (#0F7A53);
// recolorLogo swaps it for any color so the logo can be tinted on the canvas.
export const BONG_LOGO_SVG =
  '<svg width="74" height="87" viewBox="0 0 74 87" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M65.5458 6.06128C69.2331 9.77402 71.5984 14.9374 71.5984 20.6015C71.5984 26.2655 69.2331 31.4116 65.5458 35.1416C61.8064 38.9234 56.6757 41.2029 50.9708 41.2029C45.2661 41.2029 40.1353 38.9062 36.4481 35.1416C32.7609 31.4289 30.3955 26.2655 30.3955 20.6015C30.3955 14.9374 32.7609 9.79132 36.4481 6.06128C40.1353 2.27945 45.3183 0 50.9708 0C56.6234 0 61.8064 2.29672 65.5458 6.06128Z" fill="#0F7A53"/>' +
  '<path d="M24.7413 6.32195C25.6615 8.71479 25.6615 11.5724 24.7413 14.0169C23.8732 16.186 22.3279 18.0107 20.0187 18.9747C31.8077 21.0233 31.1306 40.5275 17.8832 40.5275H0V0.675537H16.2859C20.6611 0.675537 23.4738 3.12002 24.7413 6.32195Z" fill="#0F7A53"/>' +
  '<path d="M0 45.2556L0.0347024 85.7831H15.1823H28.3692V45.7724H15.1823V62.6688L0.676698 45.2556H0Z" fill="#0F7A53"/>' +
  '<path d="M51.9391 65.9775L62.5582 47.5963C59.7012 46.0989 56.4655 45.2556 53.0233 45.2556C41.6469 45.2556 32.4219 54.4806 32.4219 65.8571C32.4219 77.2335 41.6469 86.4585 53.0233 86.4585C64.3997 86.4585 73.5732 77.3023 73.6248 65.9604H51.9391V65.9775Z" fill="#0F7A53"/>' +
  '</svg>'

export const LOGO_ASPECT = 74 / 87 // width / height

// Return the logo SVG string with its fill replaced by `color`.
export function recolorLogo(color) {
  return BONG_LOGO_SVG.replaceAll('#0F7A53', color)
}

// Build an <img>-ready data URL of the logo in the given color.
export function logoDataUrl(color) {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(recolorLogo(color))
}
