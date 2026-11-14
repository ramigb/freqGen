# freqGen

A client-side tone generator with live visualizers. Choose a wave shape, dial in a frequency, and watch the output animate across multiple visualization modes.

## Features
- Web Audio API oscillator with sine, square, sawtooth, and triangle waves
- Play, pause, stop, and volume control
- Linked slider and numeric input for 20–2000 Hz frequency selection
- Three visualizers: oscilloscope waveform, spectrum bars, and radial energy burst
- Responsive, centered, dark UI with large controls

## Running locally
1. Serve the root directory (any static server works):
   ```bash
   python -m http.server 8000
   ```
2. Open http://localhost:8000 in your browser, allow audio playback, and press **Play**.

## Notes
- Audio contexts must start from a user action; use the Play button if audio is suspended.
- The page is entirely client-side—no backend required.
