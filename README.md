# Bong Swap Tool

Web app local (React + Vite) para generar loops animados de texto sobre fondo de
color, con swap entre fondo y texto. Exporta a MP4 (H.264) y GIF. Pensada para
producir piezas rápidas de contenido para redes.

## Stack

- React 19 + Vite
- Satoshi (fuente única del proyecto)
- Canvas 2D para todo el render — ninguna animación depende del DOM
- MediaRecorder para MP4/WebM · gif.js para GIF

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # build de producción en dist/
npm run preview  # sirve el build
```

## Funcionalidad

- **Texto**: tamaño, peso (400–900), tracking, leading, transform, alineación
  (izq/centro/der) y posición manual X/Y.
- **Color**: paleta de verdes Bong + input hex para verde activo y color
  secundario (swap).
- **Logo Bong**: opcional, posicionable, hereda el color del texto y swappea con él.
- **13 animaciones**: Swap, Pulse, Wave, Typewriter, Glitch, Marquee, Bounce,
  Scramble, Split, Strobe, Weight Wave, Rotate, Fade. Cada una con sus controles.
- **Formatos**: 1080×1350 (portrait), 1080×1080, 1080×1920 (story), 1920×1080.
- **Export**: MP4 (H.264 donde el navegador lo soporte, si no WebM) y GIF, con
  duración configurable y barra de progreso.
- **Presets**: autosave de los ajustes + presets con nombre (localStorage).

## Notas técnicas

- El logo se tiñe por frame con el color de texto actual (`source-in`
  compositing), así acompaña el swap.
- Glitch y Scramble usan un PRNG sembrado por time-bucket para que el export sea
  determinístico.
- `gif.worker.js` se copia a `public/` desde `node_modules/gif.js/dist/`.
