const channelsContainer = document.getElementById('channels-container');
const addChannelButton = document.getElementById('add-channel');
const vizSeg = document.getElementById('viz-seg');
const presetsContainer = document.getElementById('presets');
const masterVolumeSlider = document.getElementById('master-volume');
const masterVolumeVal = document.getElementById('master-volume-val');
const playPauseButton = document.getElementById('playPause');
const playPauseLabel = playPauseButton.querySelector('.t-label');
const stopButton = document.getElementById('stop');
const statusText = document.getElementById('status-text');
const channelCount = document.getElementById('channel-count');
const emptyHint = document.getElementById('empty-hint');
const canvas = document.getElementById('scope');
const ctx = canvas.getContext('2d');

let audioCtx;
let masterGain;
let masterFilters = {
  hp: { freq: 20, node: null },
  lp: { freq: 20000, node: null },
  mid: { freq: 1000, gain: 0, node: null }
};
let analyser;
let analyserL;
let analyserR;
let timeArray;
let freqArray;
let timeArrayL;
let timeArrayR;
let timeLength;
let freqLength;
let isPlaying = false;
let channels = [];
let nextChannelId = 1;
let vizMode = 'waveform';
let W = 0;
let H = 0;

const vizSettings = {
  sensitivity: 1,
  smoothing: 0.8,
  glow: 14,
  lineWidth: 3,
  trails: 0,
  motion: 1,
  fftSize: 2048,
  colorMode: 'auto', // 'auto' | 'freq' | 'accent'
};
let radialPhase = 0;

const HARMONIC_COUNT = 8;

const colors = {
  primary: '#6cf3c7',
  primarySoft: 'rgba(108, 243, 199, 0.35)',
  highlight: '#8be9fd',
};

// Map Freq (Log Scale 20-2000Hz) to Hue (0-300)
const minLog = Math.log(20);
const maxLog = Math.log(2000);

function getFrequencyColor(frequency) {
  const f = Math.max(20, Math.min(2000, frequency));
  const logF = Math.log(f);
  const normalized = (logF - minLog) / (maxLog - minLog);
  const hue = Math.floor(normalized * 300); // 0(Red) -> 300(Magenta)
  return `hsl(${hue}, 90%, 60%)`;
}

// ---------- Presets ----------

const PRESETS = [
  {
    name: 'Delta 2 Hz',
    channels: [
      { frequency: 150, pan: -1, volume: 0.5 },
      { frequency: 152, pan: 1, volume: 0.5 },
    ],
  },
  {
    name: 'Theta 6 Hz',
    channels: [
      { frequency: 200, pan: -1, volume: 0.5 },
      { frequency: 206, pan: 1, volume: 0.5 },
    ],
  },
  {
    name: 'Schumann 7.83',
    channels: [
      { frequency: 140, pan: -1, volume: 0.5 },
      { frequency: 147.83, pan: 1, volume: 0.5 },
    ],
  },
  {
    name: 'Major triad',
    channels: [
      { frequency: 220, pan: -0.5, volume: 0.4 },
      { frequency: 275, pan: 0, volume: 0.4 },
      { frequency: 330, pan: 0.5, volume: 0.4 },
    ],
  },
  {
    name: 'Fifths',
    channels: [
      { frequency: 200, pan: -0.4, volume: 0.5 },
      { frequency: 300, pan: 0.4, volume: 0.5 },
    ],
  },
  {
    name: 'Octave stack',
    channels: [
      { frequency: 110, pan: -0.5, volume: 0.45 },
      { frequency: 220, pan: 0, volume: 0.45 },
      { frequency: 440, pan: 0.5, volume: 0.45 },
    ],
  },
  {
    name: 'Rebalance',
    channels: [
      // Low drone root (G2/C3): 3-voice detuned stack + soft partials + slow swell
      { frequency: 98, pan: -0.5, volume: 0.45, harmonics: [1, 0.3, 0.12, 0.06], voices: { count: 3, spread: 9 }, swell: { enabled: true, rate: 0.13, depth: 0.5 } },
      { frequency: 130.8, pan: 0.5, volume: 0.4, harmonics: [1, 0.3, 0.12, 0.06], voices: { count: 3, spread: 8 }, swell: { enabled: true, rate: 0.19, depth: 0.45 } },
      // G3 pair detuned ~1.4 Hz for a slow binaural beat, 2 voices each
      { frequency: 196, pan: -1, volume: 0.35, voices: { count: 2, spread: 5 } },
      { frequency: 197.4, pan: 1, volume: 0.35, voices: { count: 2, spread: 5 } },
      // C4 pair detuned ~1.9 Hz, softer
      { frequency: 262.8, pan: -1, volume: 0.25, voices: { count: 2, spread: 5 }, swell: { enabled: true, rate: 0.27, depth: 0.35 } },
      { frequency: 260.9, pan: 1, volume: 0.25, voices: { count: 2, spread: 5 }, swell: { enabled: true, rate: 0.23, depth: 0.35 } },
    ],
  },
  {
    name: 'Lissajous 3:2',
    channels: [
      { frequency: 300, pan: -1, volume: 0.5 },
      { frequency: 200, pan: 1, volume: 0.5 },
    ],
  },
];

// ---------- UI helpers ----------

function paintRange(el) {
  const min = parseFloat(el.min || 0);
  const max = parseFloat(el.max || 100);
  const pct = ((parseFloat(el.value) - min) / (max - min)) * 100;
  el.style.setProperty('--fill', `${pct}%`);
}

const fmtHz = v => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} kHz` : `${Math.round(v)} Hz`);
const fmtPct = v => `${Math.round(v * 100)}%`;
const fmtDb = v => `${v > 0 ? '+' : ''}${Math.round(v)} dB`;
const fmtPan = v => (v < -0.01 ? `L ${Math.round(-v * 100)}%` : v > 0.01 ? `R ${Math.round(v * 100)}%` : 'C');

const WAVE_ICONS = {
  sine: '<svg viewBox="0 0 24 14"><path d="M1 7 Q 5 -1, 9 7 T 17 7 T 25 7"/></svg>',
  square: '<svg viewBox="0 0 24 14"><path d="M1 12 V2 H7 V12 H13 V2 H19 V12 H25"/></svg>',
  sawtooth: '<svg viewBox="0 0 24 14"><path d="M1 12 L9 2 V12 L17 2 V12 L25 2"/></svg>',
  triangle: '<svg viewBox="0 0 24 14"><path d="M1 12 L6 2 L11 12 L16 2 L21 12 L25 4"/></svg>',
};

const ICON_SPEAKER = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 5L6 9H2v6h4l5 4V5z"/>
    <path d="M15.5 8.5a5 5 0 010 7"/>
    <path d="M18.5 5.5a9 9 0 010 13"/>
  </svg>`;

const ICON_MUTED = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round">
    <path d="M11 5L6 9H2v6h4l5 4V5z"/>
    <path d="M22 9l-6 6M16 9l6 6"/>
  </svg>`;

const ICON_CLOSE = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round">
    <path d="M6 18L18 6M6 6l12 12"/>
  </svg>`;

const ICON_CHEV = `
  <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 9l6 6 6-6"/>
  </svg>`;

// ---------- Channel ----------

class Channel {
  constructor(id, cfg = {}) {
    this.id = id;
    this.frequency = cfg.frequency ?? 440;
    this.type = cfg.type ?? 'sine';
    this.volume = cfg.volume ?? 0.5;
    this.pan = cfg.pan ?? 0;
    this.isMuted = false;

    // Additive synthesis: levels for partials 1..8
    this.harmonics = cfg.harmonics
      ? cfg.harmonics.slice(0, HARMONIC_COUNT)
      : [1, 0, 0, 0, 0, 0, 0, 0];
    while (this.harmonics.length < HARMONIC_COUNT) this.harmonics.push(0);
    this.usingCustom = !!cfg.harmonics;

    // Frequency sweep
    this.sweep = {
      enabled: false,
      from: cfg.sweep?.from ?? this.frequency,
      to: cfg.sweep?.to ?? Math.min(this.frequency * 2, 2000),
      dur: cfg.sweep?.dur ?? 5,
      loop: cfg.sweep?.loop ?? true,
    };
    this._sweepTimer = null;

    // Slow volume LFO ("swell")
    this.swell = {
      enabled: cfg.swell?.enabled ?? false,
      rate: cfg.swell?.rate ?? 0.2,
      depth: cfg.swell?.depth ?? 0.5,
    };
    this.swellLfo = null;
    this.swellLfoGain = null;

    // Detuned voice stack (chorus/pad thickness)
    this.voices = {
      count: cfg.voices?.count ?? 1,
      spread: cfg.voices?.spread ?? 8, // cents
    };

    // Filter state
    this.filters = {
      hp: { freq: 20, node: null },
      lp: { freq: 20000, node: null },
      mid: { freq: 1000, gain: 0, node: null }
    };

    this.oscillators = [];
    this.voiceMix = null;
    this.gainNode = null;
    this.panNode = null;
    this.element = this.createUI();
    this.updateColor();
  }

  updateColor() {
    const color = getFrequencyColor(this.frequency);
    if (this.element) {
      this.element.style.setProperty('--channel-color', color);
    }
  }

  createUI() {
    const div = document.createElement('div');
    div.className = 'channel-row';
    div.innerHTML = `
      <div class="ch-head">
        <div class="ch-id">
          <span class="ch-dot"></span>
          <input type="number" class="freq-number" value="${this.frequency}" min="20" max="2000"
            aria-label="Frequency in Hz" />
          <span class="ch-unit">Hz</span>
        </div>
        <button class="icon-btn remove-btn" type="button" aria-label="Remove channel" title="Remove channel">
          ${ICON_CLOSE}
        </button>
      </div>

      <input type="range" class="freq-slider" min="20" max="2000" value="${this.frequency}"
        aria-label="Frequency" />

      <div class="seg wave-seg" role="group" aria-label="Waveform">
        ${['sine', 'square', 'sawtooth', 'triangle'].map(w => `
          <button type="button" data-wave="${w}" title="${w[0].toUpperCase() + w.slice(1)}"
            class="${this.type === w && !this.usingCustom ? 'active' : ''}">${WAVE_ICONS[w]}</button>
        `).join('')}
      </div>

      <div class="vol-row">
        <input type="range" class="vol-slider" min="0" max="1" step="0.01" value="${this.volume}"
          aria-label="Channel volume" />
        <span class="val vol-val">${fmtPct(this.volume)}</span>
        <button class="icon-btn mute-btn" type="button" aria-label="Mute channel" title="Mute">
          ${ICON_SPEAKER}
        </button>
      </div>

      <div class="pan-row">
        <span class="row-label">Pan</span>
        <input type="range" class="pan-slider" min="-1" max="1" step="0.01" value="${this.pan}"
          aria-label="Stereo pan" />
        <span class="val pan-val">${fmtPan(this.pan)}</span>
      </div>

      <button class="eq-toggle-btn harm-toggle" type="button">
        <span>Harmonics</span>
        ${ICON_CHEV}
      </button>
      <div class="eq-container hidden">
        <div class="harm-grid">
          ${this.harmonics.map((h, i) => `
            <div class="harm-cell">
              <input type="range" class="harm-slider" data-h="${i}" min="0" max="1" step="0.01"
                value="${h}" title="Partial ${i + 1}: ${fmtPct(h)}" aria-label="Harmonic ${i + 1} level" />
              <span class="harm-num">${i + 1}×</span>
            </div>
          `).join('')}
        </div>
        <p class="harm-hint">Editing partials switches to a custom wave.</p>
      </div>

      <button class="eq-toggle-btn sweep-toggle" type="button">
        <span>Sweep</span>
        ${ICON_CHEV}
      </button>
      <div class="eq-container hidden">
        <label class="check-row">
          <input type="checkbox" class="sweep-enable" />
          <span>Enable sweep</span>
        </label>
        <div class="sweep-grid" style="margin-top:10px">
          <div class="sweep-field">
            <span class="eq-label">From Hz</span>
            <input type="number" class="sweep-from" value="${this.sweep.from}" min="20" max="20000" />
          </div>
          <div class="sweep-field">
            <span class="eq-label">To Hz</span>
            <input type="number" class="sweep-to" value="${this.sweep.to}" min="20" max="20000" />
          </div>
          <div class="sweep-field">
            <span class="eq-label">Seconds</span>
            <input type="number" class="sweep-dur" value="${this.sweep.dur}" min="0.1" step="0.1" />
          </div>
        </div>
        <label class="check-row" style="margin-top:10px">
          <input type="checkbox" class="sweep-loop" ${this.sweep.loop ? 'checked' : ''} />
          <span>Loop</span>
        </label>
      </div>

      <button class="eq-toggle-btn swell-toggle" type="button">
        <span>Swell</span>
        ${ICON_CHEV}
      </button>
      <div class="eq-container hidden">
        <label class="check-row">
          <input type="checkbox" class="swell-enable" ${this.swell.enabled ? 'checked' : ''} />
          <span>Enable swell</span>
        </label>
        <div class="eq-grid" style="margin-top:8px">
          <div class="eq-param">
            <div class="eq-param-head">
              <span class="eq-label">Rate</span>
              <span class="val swell-rate-val">${this.swell.rate.toFixed(2)} Hz</span>
            </div>
            <input type="range" class="swell-rate" min="0.05" max="2" step="0.05"
              value="${this.swell.rate}" />
          </div>
          <div class="eq-param">
            <div class="eq-param-head">
              <span class="eq-label">Depth</span>
              <span class="val swell-depth-val">${fmtPct(this.swell.depth)}</span>
            </div>
            <input type="range" class="swell-depth" min="0" max="1" step="0.01"
              value="${this.swell.depth}" />
          </div>
        </div>
      </div>

      <button class="eq-toggle-btn voices-toggle" type="button">
        <span>Voices / Detune</span>
        ${ICON_CHEV}
      </button>
      <div class="eq-container hidden">
        <div class="seg voices-seg" role="group" aria-label="Voice count">
          ${[1, 2, 3].map(n => `
            <button type="button" data-voices="${n}"
              class="${this.voices.count === n ? 'active' : ''}">${n}</button>
          `).join('')}
        </div>
        <div class="eq-param" style="margin-top:8px">
          <div class="eq-param-head">
            <span class="eq-label">Detune spread</span>
            <span class="val det-val">${Math.round(this.voices.spread)}¢</span>
          </div>
          <input type="range" class="det-spread" min="0" max="25" step="1"
            value="${this.voices.spread}" />
        </div>
        <p class="harm-hint">Stacked detuned oscillators — instant chorus/pad.</p>
      </div>

      <button class="eq-toggle-btn eq-toggle" type="button">
        <span>EQ / Filters</span>
        ${ICON_CHEV}
      </button>
      <div class="eq-container hidden">
        <div class="eq-grid">
          <div class="eq-param">
            <div class="eq-param-head">
              <span class="eq-label">Low cut</span>
              <span class="val hp-val">${fmtHz(this.filters.hp.freq)}</span>
            </div>
            <input type="range" class="hp-slider" min="20" max="2000" step="10" value="${this.filters.hp.freq}" />
          </div>
          <div class="eq-param">
            <div class="eq-param-head">
              <span class="eq-label">High cut</span>
              <span class="val lp-val">${fmtHz(this.filters.lp.freq)}</span>
            </div>
            <input type="range" class="lp-slider" min="20" max="20000" step="10" value="${this.filters.lp.freq}" />
          </div>
          <div class="eq-param">
            <div class="eq-param-head">
              <span class="eq-label">Mid freq</span>
              <span class="val mid-freq-val">${fmtHz(this.filters.mid.freq)}</span>
            </div>
            <input type="range" class="mid-freq-slider" min="20" max="10000" step="10" value="${this.filters.mid.freq}" />
          </div>
          <div class="eq-param">
            <div class="eq-param-head">
              <span class="eq-label">Mid gain</span>
              <span class="val mid-gain-val">${fmtDb(this.filters.mid.gain)}</span>
            </div>
            <input type="range" class="mid-gain-slider" min="-15" max="15" step="1" value="${this.filters.mid.gain}" />
          </div>
        </div>
      </div>
    `;

    const freqSlider = div.querySelector('.freq-slider');
    const freqNumber = div.querySelector('.freq-number');
    const waveButtons = div.querySelectorAll('.wave-seg button');
    const volSlider = div.querySelector('.vol-slider');
    const volVal = div.querySelector('.vol-val');
    const panSlider = div.querySelector('.pan-slider');
    const panVal = div.querySelector('.pan-val');
    const muteBtn = div.querySelector('.mute-btn');
    const removeBtn = div.querySelector('.remove-btn');

    // Drawer toggles
    div.querySelectorAll('.eq-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        btn.nextElementSibling.classList.toggle('hidden');
        btn.classList.toggle('open');
      });
    });

    // Frequency slider: immediate update
    freqSlider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.frequency = val;
      freqNumber.value = val;
      paintRange(freqSlider);
      this.updateOscillatorFrequency(val);
      this.updateColor();
    });

    // Frequency number: free typing, clamp on blur/enter
    freqNumber.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      if (!isNaN(val)) {
        this.updateOscillatorFrequency(val);
        freqSlider.value = Math.min(Math.max(val, 20), 2000);
        paintRange(freqSlider);
      }
    });

    freqNumber.addEventListener('change', (e) => {
      let val = parseFloat(e.target.value);
      if (isNaN(val)) val = 440;
      const clamped = Math.min(Math.max(val, 20), 2000);
      this.frequency = clamped;
      freqNumber.value = clamped;
      freqSlider.value = clamped;
      paintRange(freqSlider);
      this.updateOscillatorFrequency(clamped);
      this.updateColor();
    });

    // Waveform segmented buttons
    waveButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        waveButtons.forEach(b => b.classList.toggle('active', b === btn));
        this.usingCustom = false;
        this.updateWaveform(btn.dataset.wave);
      });
    });

    // Harmonic partial sliders
    div.querySelectorAll('.harm-slider').forEach(sl => {
      paintRange(sl);
      sl.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.h, 10);
        this.harmonics[idx] = parseFloat(e.target.value);
        e.target.title = `Partial ${idx + 1}: ${fmtPct(this.harmonics[idx])}`;
        paintRange(e.target);
        if (!this.usingCustom) {
          this.usingCustom = true;
          waveButtons.forEach(b => b.classList.remove('active'));
        }
        this.applyCustomWave();
      });
    });

    // Sweep controls
    const sweepEnable = div.querySelector('.sweep-enable');
    const sweepFrom = div.querySelector('.sweep-from');
    const sweepTo = div.querySelector('.sweep-to');
    const sweepDur = div.querySelector('.sweep-dur');
    const sweepLoop = div.querySelector('.sweep-loop');

    sweepEnable.addEventListener('change', (e) => {
      this.sweep.enabled = e.target.checked;
      this.syncSweep();
    });
    sweepFrom.addEventListener('change', (e) => {
      this.sweep.from = parseFloat(e.target.value) || this.frequency;
      this.syncSweep();
    });
    sweepTo.addEventListener('change', (e) => {
      this.sweep.to = parseFloat(e.target.value) || this.frequency * 2;
      this.syncSweep();
    });
    sweepDur.addEventListener('change', (e) => {
      this.sweep.dur = Math.max(0.1, parseFloat(e.target.value) || 5);
      this.syncSweep();
    });
    sweepLoop.addEventListener('change', (e) => {
      this.sweep.loop = e.target.checked;
      this.syncSweep();
    });

    // Swell controls
    const swellEnable = div.querySelector('.swell-enable');
    const swellRate = div.querySelector('.swell-rate');
    const swellRateVal = div.querySelector('.swell-rate-val');
    const swellDepth = div.querySelector('.swell-depth');
    const swellDepthVal = div.querySelector('.swell-depth-val');

    swellEnable.addEventListener('change', (e) => {
      this.swell.enabled = e.target.checked;
      this.syncSwell();
    });
    swellRate.addEventListener('input', (e) => {
      this.swell.rate = parseFloat(e.target.value);
      swellRateVal.textContent = `${this.swell.rate.toFixed(2)} Hz`;
      paintRange(swellRate);
      this.syncSwell();
    });
    swellDepth.addEventListener('input', (e) => {
      this.swell.depth = parseFloat(e.target.value);
      swellDepthVal.textContent = fmtPct(this.swell.depth);
      paintRange(swellDepth);
      this.syncSwell();
    });
    paintRange(swellRate);
    paintRange(swellDepth);

    // Voices / detune controls
    const voiceBtns = div.querySelectorAll('.voices-seg button');
    voiceBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        voiceBtns.forEach(b => b.classList.toggle('active', b === btn));
        this.voices.count = parseInt(btn.dataset.voices, 10);
        this.rebuildVoices();
      });
    });
    const detSpread = div.querySelector('.det-spread');
    const detVal = div.querySelector('.det-val');
    detSpread.addEventListener('input', (e) => {
      this.voices.spread = parseFloat(e.target.value);
      detVal.textContent = `${Math.round(this.voices.spread)}¢`;
      paintRange(detSpread);
      this.applyDetune();
    });
    paintRange(detSpread);

    // EQ sliders
    const bindEq = (cls, valCls, get, set, fmt) => {
      const slider = div.querySelector(cls);
      const valEl = div.querySelector(valCls);
      slider.addEventListener('input', (e) => {
        set(parseFloat(e.target.value));
        valEl.textContent = fmt(get());
        paintRange(slider);
        this.updateFilterParams();
      });
      paintRange(slider);
    };

    bindEq('.hp-slider', '.hp-val',
      () => this.filters.hp.freq, v => this.filters.hp.freq = v, fmtHz);
    bindEq('.lp-slider', '.lp-val',
      () => this.filters.lp.freq, v => this.filters.lp.freq = v, fmtHz);
    bindEq('.mid-freq-slider', '.mid-freq-val',
      () => this.filters.mid.freq, v => this.filters.mid.freq = v, fmtHz);
    bindEq('.mid-gain-slider', '.mid-gain-val',
      () => this.filters.mid.gain, v => this.filters.mid.gain = v, fmtDb);

    volSlider.addEventListener('input', (e) => {
      this.volume = parseFloat(e.target.value);
      volVal.textContent = fmtPct(this.volume);
      paintRange(volSlider);
      if (!this.isMuted) {
        this.updateGain(this.volume);
      }
    });

    panSlider.addEventListener('input', (e) => {
      this.pan = parseFloat(e.target.value);
      panVal.textContent = fmtPan(this.pan);
      paintRange(panSlider);
      this.updatePan();
    });

    paintRange(volSlider);
    paintRange(panSlider);
    paintRange(freqSlider);

    muteBtn.addEventListener('click', () => this.toggleMute());
    removeBtn.addEventListener('click', () => removeChannel(this.id));

    this.ui = { freqSlider, freqNumber, waveButtons, volSlider, volVal, panSlider, panVal, muteBtn };
    return div;
  }

  rebuildVoices() {
    if (!this.oscillators.length || !audioCtx || !masterGain) return;
    this.stop();
    this.start(audioCtx, masterGain);
  }

  applyDetune() {
    if (!audioCtx) return;
    const n = this.oscillators.length;
    this.oscillators.forEach((osc, i) => {
      osc.detune.setTargetAtTime(
        this.voices.spread * (i - (n - 1) / 2), audioCtx.currentTime, 0.05);
    });
  }

  updateOscillatorFrequency(val) {
    this.oscillators.forEach(osc => {
      osc.frequency.setValueAtTime(val, audioCtx.currentTime);
    });
  }

  updateWaveform(type) {
    this.type = type;
    this.oscillators.forEach(osc => { osc.type = type; });
  }

  applyCustomWave() {
    if (!audioCtx || !this.oscillators.length) return;
    const n = HARMONIC_COUNT;
    const real = new Float32Array(n + 1);
    const imag = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) imag[i + 1] = this.harmonics[i];
    const wave = audioCtx.createPeriodicWave(real, imag);
    this.oscillators.forEach(osc => osc.setPeriodicWave(wave));
  }

  syncSweep() {
    if (!this.oscillators.length) return;
    clearTimeout(this._sweepTimer);
    const t = audioCtx.currentTime;
    if (this.sweep.enabled) {
      this.scheduleSweep();
    } else {
      this.oscillators.forEach(osc => {
        osc.frequency.cancelScheduledValues(t);
        osc.frequency.setValueAtTime(this.frequency, t);
      });
    }
  }

  scheduleSweep() {
    if (!this.oscillators.length || !this.sweep.enabled) return;
    const t = audioCtx.currentTime;
    const from = Math.max(1, this.sweep.from);
    const to = Math.max(1, this.sweep.to);
    const dur = Math.max(0.1, this.sweep.dur);

    this.oscillators.forEach(osc => {
      osc.frequency.cancelScheduledValues(t);
      osc.frequency.setValueAtTime(from, t);
      osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    });

    if (this.sweep.loop) {
      this._sweepTimer = setTimeout(() => this.scheduleSweep(), dur * 1000);
    }
  }

  syncSwell() {
    if (!this.swellLfo || !audioCtx) return;
    const t = audioCtx.currentTime;
    const effective = this.isMuted ? 0 : this.volume;
    this.swellLfo.frequency.setTargetAtTime(this.swell.rate, t, 0.05);
    this.swellLfoGain.gain.setTargetAtTime(
      this.swell.enabled ? effective * this.swell.depth : 0, t, 0.05);
  }

  updateGain(val) {
    if (this.gainNode) {
      this.gainNode.gain.setTargetAtTime(val, audioCtx.currentTime, 0.01);
    }
    if (this.swellLfoGain) {
      this.swellLfoGain.gain.setTargetAtTime(
        this.swell.enabled ? val * this.swell.depth : 0, audioCtx.currentTime, 0.02);
    }
  }

  updatePan() {
    if (this.panNode) {
      this.panNode.pan.setTargetAtTime(this.pan, audioCtx.currentTime, 0.02);
    }
  }

  updateFilterParams() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    if (this.filters.hp.node) {
      this.filters.hp.node.frequency.setTargetAtTime(this.filters.hp.freq, t, 0.05);
    }
    if (this.filters.lp.node) {
      this.filters.lp.node.frequency.setTargetAtTime(this.filters.lp.freq, t, 0.05);
    }
    if (this.filters.mid.node) {
      this.filters.mid.node.frequency.setTargetAtTime(this.filters.mid.freq, t, 0.05);
      this.filters.mid.node.gain.setTargetAtTime(this.filters.mid.gain, t, 0.05);
    }
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    this.updateGain(this.isMuted ? 0 : this.volume);
    this.ui.muteBtn.classList.toggle('muted', this.isMuted);
    this.ui.muteBtn.innerHTML = this.isMuted ? ICON_MUTED : ICON_SPEAKER;
    this.ui.muteBtn.title = this.isMuted ? 'Unmute' : 'Mute';
  }

  start(ctx, dest) {
    if (this.oscillators.length) return;

    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = this.isMuted ? 0 : this.volume;

    // Swell LFO drives the channel gain param (added on top of the base value)
    this.swellLfo = ctx.createOscillator();
    this.swellLfo.type = 'sine';
    this.swellLfo.frequency.value = this.swell.rate;
    this.swellLfoGain = ctx.createGain();
    this.swellLfoGain.gain.value = this.swell.enabled
      ? (this.isMuted ? 0 : this.volume) * this.swell.depth
      : 0;
    this.swellLfo.connect(this.swellLfoGain);
    this.swellLfoGain.connect(this.gainNode.gain);
    this.swellLfo.start();

    this.panNode = ctx.createStereoPanner();
    this.panNode.pan.value = this.pan;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = this.filters.hp.freq;
    this.filters.hp.node = hp;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = this.filters.lp.freq;
    this.filters.lp.node = lp;

    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = this.filters.mid.freq;
    mid.gain.value = this.filters.mid.gain;
    mid.Q.value = 1.0;
    this.filters.mid.node = mid;

    let wave = null;
    if (this.usingCustom) {
      const n = HARMONIC_COUNT;
      const real = new Float32Array(n + 1);
      const imag = new Float32Array(n + 1);
      for (let i = 0; i < n; i++) imag[i + 1] = this.harmonics[i];
      wave = ctx.createPeriodicWave(real, imag);
    }

    // N detuned oscillators -> shared mix (level-compensated) -> filters
    const n = Math.max(1, Math.round(this.voices.count));
    this.voiceMix = ctx.createGain();
    this.voiceMix.gain.value = 1 / Math.sqrt(n);

    const baseFreq = this.sweep.enabled ? Math.max(1, this.sweep.from) : this.frequency;
    for (let i = 0; i < n; i++) {
      const osc = ctx.createOscillator();
      if (wave) {
        osc.setPeriodicWave(wave);
      } else {
        osc.type = this.type;
      }
      osc.frequency.value = baseFreq;
      osc.detune.value = this.voices.spread * (i - (n - 1) / 2);
      osc.connect(this.voiceMix);
      osc.start();
      this.oscillators.push(osc);
    }

    // VoiceMix -> HP -> LP -> Mid -> Gain -> Pan -> Dest
    this.voiceMix.connect(hp);
    hp.connect(lp);
    lp.connect(mid);
    mid.connect(this.gainNode);
    this.gainNode.connect(this.panNode);
    this.panNode.connect(dest);

    if (this.sweep.enabled) {
      this.scheduleSweep();
    }
  }

  stop() {
    clearTimeout(this._sweepTimer);
    this._sweepTimer = null;

    if (this.swellLfo) {
      try {
        this.swellLfo.stop();
        this.swellLfo.disconnect();
      } catch (e) { }
      this.swellLfo = null;
    }

    if (this.swellLfoGain) {
      this.swellLfoGain.disconnect();
      this.swellLfoGain = null;
    }

    this.oscillators.forEach(osc => {
      try {
        osc.stop();
        osc.disconnect();
      } catch (e) { }
    });
    this.oscillators = [];

    if (this.voiceMix) {
      this.voiceMix.disconnect();
      this.voiceMix = null;
    }

    for (const key of ['hp', 'lp', 'mid']) {
      if (this.filters[key].node) {
        this.filters[key].node.disconnect();
        this.filters[key].node = null;
      }
    }

    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }

    if (this.panNode) {
      this.panNode.disconnect();
      this.panNode = null;
    }
  }
}

// ---------- Master EQ & Reverb ----------

const reverb = { mix: 0, decay: 2.8 };
let convNode;
let wetGain;

function makeImpulse(seconds) {
  const rate = audioCtx.sampleRate;
  const len = Math.max(1, Math.floor(rate * seconds));
  const buf = audioCtx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
  }
  return buf;
}

function updateMasterFilters() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;

  if (masterFilters.hp.node) {
    masterFilters.hp.node.frequency.setTargetAtTime(masterFilters.hp.freq, t, 0.05);
  }
  if (masterFilters.lp.node) {
    masterFilters.lp.node.frequency.setTargetAtTime(masterFilters.lp.freq, t, 0.05);
  }
  if (masterFilters.mid.node) {
    masterFilters.mid.node.frequency.setTargetAtTime(masterFilters.mid.freq, t, 0.05);
    masterFilters.mid.node.gain.setTargetAtTime(masterFilters.mid.gain, t, 0.05);
  }
}

function createAudioGraph() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (!masterGain) {
    masterGain = audioCtx.createGain();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = vizSettings.fftSize;
    analyser.smoothingTimeConstant = vizSettings.smoothing;
    timeLength = analyser.fftSize;
    freqLength = analyser.frequencyBinCount;
    timeArray = new Uint8Array(timeLength);
    freqArray = new Uint8Array(freqLength);

    // Stereo taps for the XY scope
    analyserL = audioCtx.createAnalyser();
    analyserR = audioCtx.createAnalyser();
    analyserL.fftSize = vizSettings.fftSize;
    analyserR.fftSize = vizSettings.fftSize;
    timeArrayL = new Uint8Array(analyserL.fftSize);
    timeArrayR = new Uint8Array(analyserR.fftSize);
    const splitter = audioCtx.createChannelSplitter(2);

    const hp = audioCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = masterFilters.hp.freq;
    masterFilters.hp.node = hp;

    const lp = audioCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = masterFilters.lp.freq;
    masterFilters.lp.node = lp;

    const mid = audioCtx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = masterFilters.mid.freq;
    mid.gain.value = masterFilters.mid.gain;
    masterFilters.mid.node = mid;

    // MasterGain -> HP -> LP -> Mid -> Analyser -> Dest
    //                              \-> Splitter -> AnalyserL/R (XY taps)
    masterGain.gain.value = parseFloat(masterVolumeSlider.value);

    masterGain.connect(hp);
    hp.connect(lp);
    lp.connect(mid);
    mid.connect(analyser);
    analyser.connect(audioCtx.destination);
    mid.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);

    // Reverb send: Mid -> Convolver -> Wet gain -> Analyser
    convNode = audioCtx.createConvolver();
    convNode.buffer = makeImpulse(reverb.decay);
    wetGain = audioCtx.createGain();
    wetGain.gain.value = reverb.mix;
    mid.connect(convNode);
    convNode.connect(wetGain);
    wetGain.connect(analyser);
  }
}

// ---------- Channel list ----------

function refreshChannelListUI() {
  channelCount.textContent = channels.length;
  emptyHint.classList.toggle('hidden', channels.length > 0);
}

function addChannel(cfg) {
  const channel = new Channel(nextChannelId++, cfg);
  channels.push(channel);
  channelsContainer.appendChild(channel.element);
  refreshChannelListUI();

  if (isPlaying && audioCtx && masterGain) {
    channel.start(audioCtx, masterGain);
  }
}

function removeChannel(id) {
  const index = channels.findIndex(c => c.id === id);
  if (index !== -1) {
    const channel = channels[index];
    channel.stop();
    channel.element.remove();
    channels.splice(index, 1);
    refreshChannelListUI();
  }
}

function applyPreset(preset) {
  const wasPlaying = isPlaying;
  stopAll();
  channels.slice().forEach(c => removeChannel(c.id));
  preset.channels.forEach(cfg => addChannel(cfg));
  if (wasPlaying) startAll();
}

// ---------- Transport ----------

function setPlayingUI(playing) {
  document.body.classList.toggle('playing', playing);
  playPauseButton.classList.toggle('playing', playing);
  playPauseLabel.textContent = playing ? 'Pause' : 'Play';
  statusText.textContent = playing ? 'Live' : 'Standby';
}

function startAll() {
  if (isPlaying) return;
  if (!audioCtx) createAudioGraph();
  if (audioCtx.state === 'suspended') audioCtx.resume();

  channels.forEach(ch => ch.start(audioCtx, masterGain));
  isPlaying = true;
  setPlayingUI(true);
}

function stopAll() {
  channels.forEach(ch => ch.stop());
  releaseAllKeys();
  isPlaying = false;
  setPlayingUI(false);
}

function togglePlay() {
  if (isPlaying) {
    stopAll();
  } else {
    startAll();
  }
}

function updateMasterVolume(val) {
  if (masterGain) {
    masterGain.gain.setTargetAtTime(val, audioCtx.currentTime, 0.01);
  }
}

// ---------- Visualization ----------

// Fades the frame for trails when enabled, otherwise clears to transparent.
function paintBackground() {
  if (vizSettings.trails > 0) {
    ctx.fillStyle = `rgba(10, 13, 19, ${1 - vizSettings.trails})`;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.clearRect(0, 0, W, H);
  }
}

function dominantFreq() {
  analyser.getByteFrequencyData(freqArray);
  let peak = 0;
  let peakIdx = 0;
  for (let i = 0; i < freqArray.length; i++) {
    if (freqArray[i] > peak) {
      peak = freqArray[i];
      peakIdx = i;
    }
  }
  const binSize = (audioCtx ? audioCtx.sampleRate : 44100) / analyser.fftSize;
  return peakIdx * binSize;
}

function setFftSize(n) {
  vizSettings.fftSize = n;
  if (!analyser) return;
  analyser.fftSize = n;
  analyserL.fftSize = n;
  analyserR.fftSize = n;
  timeLength = analyser.fftSize;
  freqLength = analyser.frequencyBinCount;
  timeArray = new Uint8Array(timeLength);
  freqArray = new Uint8Array(freqLength);
  timeArrayL = new Uint8Array(analyserL.fftSize);
  timeArrayR = new Uint8Array(analyserR.fftSize);
}

function draw() {
  requestAnimationFrame(draw);
  if (!analyser) return;

  if (vizMode === 'lissajous') {
    analyserL.getByteTimeDomainData(timeArrayL);
    analyserR.getByteTimeDomainData(timeArrayR);
    drawLissajous();
    return;
  }

  paintBackground();

  if (vizMode === 'waveform') {
    analyser.getByteTimeDomainData(timeArray);
    drawWaveform();
  } else if (vizMode === 'spectrum') {
    analyser.getByteFrequencyData(freqArray);
    drawSpectrum();
  } else if (vizMode === 'radial') {
    analyser.getByteFrequencyData(freqArray);
    drawRadial();
  }
}

function drawWaveform() {
  ctx.lineWidth = vizSettings.lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowBlur = vizSettings.glow;

  if (vizSettings.colorMode === 'freq') {
    const c = getFrequencyColor(dominantFreq());
    ctx.strokeStyle = c;
    ctx.shadowColor = c;
  } else {
    const gradient = ctx.createLinearGradient(0, 0, W, 0);
    gradient.addColorStop(0, colors.primary);
    gradient.addColorStop(1, colors.highlight);
    ctx.strokeStyle = gradient;
    ctx.shadowColor = colors.primary;
  }

  ctx.beginPath();
  const sliceWidth = W / timeLength;
  const mid = H / 2;
  let x = 0;

  for (let i = 0; i < timeLength; i++) {
    const v = timeArray[i] / 128.0;
    const y = mid + (v - 1) * mid * vizSettings.sensitivity;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
    x += sliceWidth;
  }

  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawSpectrum() {
  const binSize = (audioCtx ? audioCtx.sampleRate : 44100) / analyser.fftSize;
  const barWidth = W / freqLength;
  let x = 0;

  for (let i = 0; i < freqLength; i++) {
    const v = freqArray[i];
    if (v > 8) {
      const barHeight = Math.min((v / 255) * H * vizSettings.sensitivity, H);
      const freq = i * binSize;

      if (vizSettings.colorMode === 'accent') {
        ctx.fillStyle = colors.primary;
      } else if (freq >= 20 && freq <= 2000) {
        ctx.fillStyle = getFrequencyColor(freq);
      } else {
        const hue = (i / freqLength) * 300;
        ctx.fillStyle = `hsl(${hue}, 50%, 40%)`;
      }

      ctx.fillRect(x, H - barHeight, Math.max(barWidth * 0.75, 1), barHeight);
    }
    x += barWidth;
  }
}

function drawRadial() {
  const centerX = W / 2;
  const centerY = H / 2;
  const maxRadius = Math.min(centerX, centerY) - 40;
  const binSize = (audioCtx ? audioCtx.sampleRate : 44100) / analyser.fftSize;

  radialPhase += 0.004 * vizSettings.motion;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.globalCompositeOperation = 'screen';
  ctx.shadowBlur = vizSettings.glow * 0.4;

  for (let i = 0; i < freqLength; i += 2) {
    const energy = freqArray[i] / 255;
    if (energy < 0.05) continue;

    const freq = i * binSize;
    let color = colors.primary;
    if (vizSettings.colorMode !== 'accent' && freq >= 20 && freq <= 2000) {
      color = getFrequencyColor(freq);
    }

    const radius = Math.min(energy * vizSettings.sensitivity, 1.4) * maxRadius;
    const angle = (i / freqLength) * Math.PI * 4 + radialPhase;
    const offsetAngle = angle
      + Math.sin(performance.now() * 0.001 * vizSettings.motion + i) * 0.1;

    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.lineWidth = vizSettings.lineWidth * (0.6 + energy * 0.8);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(offsetAngle) * radius, Math.sin(offsetAngle) * radius);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(Math.cos(offsetAngle) * radius, Math.sin(offsetAngle) * radius, 2 + energy * 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawLissajous() {
  // XY scope keeps a faint persistence by default; Trails slider overrides it.
  if (vizSettings.trails > 0) {
    paintBackground();
  } else {
    ctx.fillStyle = 'rgba(10, 13, 19, 0.22)';
    ctx.fillRect(0, 0, W, H);
  }

  const cx = W / 2;
  const cy = H / 2;
  const R = (Math.min(W, H) / 2 - 40) * Math.min(vizSettings.sensitivity, 1.5);

  let strokeColor = colors.primary;
  if (vizSettings.colorMode === 'freq') {
    strokeColor = getFrequencyColor(dominantFreq());
  }

  ctx.lineWidth = Math.max(1, vizSettings.lineWidth - 1);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = strokeColor;
  ctx.shadowColor = strokeColor;
  ctx.shadowBlur = vizSettings.glow * 0.7;

  ctx.beginPath();
  const step = 2;
  for (let i = 0; i < timeArrayL.length; i += step) {
    const x = cx + ((timeArrayL[i] - 128) / 128) * R;
    const y = cy - ((timeArrayR[i] - 128) / 128) * R;
    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

// ---------- Piano play mode ----------

const playMode = { enabled: false, octave: 4, wave: 'pad', mode: 'play' };

// Key -> semitone offset from C{octave} (two rows of the typing keyboard)
const KEY_NOTES = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
  q: 12, '2': 13, w: 14, '3': 15, e: 16, r: 17, '5': 18, t: 19, '6': 20,
  y: 21, '7': 22, u: 23, i: 24, '9': 25, o: 26, '0': 27, p: 28,
};

const keyVoices = new Map(); // semitone -> { osc, g }
const heldNotes = new Set(); // semitones held in steer mode
let padWaveCache = null;

function padWave() {
  if (!padWaveCache) {
    const n = HARMONIC_COUNT;
    const real = new Float32Array(n + 1);
    const imag = new Float32Array(n + 1);
    [1, 0.3, 0.12, 0.06].forEach((v, i) => { imag[i + 1] = v; });
    padWaveCache = audioCtx.createPeriodicWave(real, imag);
  }
  return padWaveCache;
}

function noteFreq(sem) {
  const midi = 12 * (playMode.octave + 1) + sem;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function setKeyDown(sem, down) {
  const el = document.querySelector(`#piano [data-sem="${sem}"]`);
  if (el) el.classList.toggle('down', down);
}

function noteOn(sem) {
  if (!audioCtx) createAudioGraph();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  if (keyVoices.has(sem)) noteOff(sem, true);

  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  if (playMode.wave === 'pad') {
    osc.setPeriodicWave(padWave());
  } else {
    osc.type = playMode.wave;
  }
  osc.frequency.value = noteFreq(sem);

  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.3, t + 0.025);

  osc.connect(g);
  g.connect(masterGain);
  osc.start();

  keyVoices.set(sem, { osc, g });
  setKeyDown(sem, true);
}

function noteOff(sem, immediate = false) {
  const v = keyVoices.get(sem);
  if (!v) return;
  keyVoices.delete(sem);

  const t = audioCtx.currentTime;
  v.g.gain.cancelScheduledValues(t);
  v.g.gain.setValueAtTime(v.g.gain.value, t);
  v.g.gain.setTargetAtTime(0, t, immediate ? 0.01 : 0.18);

  const { osc, g } = v;
  setTimeout(() => {
    try {
      osc.stop();
      osc.disconnect();
      g.disconnect();
    } catch (e) { }
  }, immediate ? 80 : 900);

  setKeyDown(sem, false);
}

// Steer mode: held keys pull each channel to the nearest held pitch class,
// keeping the channel's register; releasing glides it back to its base frequency.
function nearestHeldFreq(base) {
  const baseSem = 69 + 12 * Math.log2(base / 440);
  const baseOct = Math.floor(baseSem / 12) - 1;
  let best = base;
  let bestDist = Infinity;
  for (const sem of heldNotes) {
    const pc = sem % 12;
    for (let oct = baseOct - 1; oct <= baseOct + 2; oct++) {
      const midi = 12 * (oct + 1) + pc;
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      const d = Math.abs(Math.log2(f / base));
      if (d < bestDist) {
        bestDist = d;
        best = f;
      }
    }
  }
  return best;
}

function steerChannels() {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  channels.forEach(ch => {
    if (!ch.oscillators.length) return;
    const target = heldNotes.size ? nearestHeldFreq(ch.frequency) : ch.frequency;
    ch.oscillators.forEach(osc =>
      osc.frequency.setTargetAtTime(target, t, 0.3));
  });
}

function pressKey(sem) {
  if (playMode.mode === 'steer') {
    heldNotes.add(sem);
    setKeyDown(sem, true);
    if (!isPlaying) startAll();
    steerChannels();
  } else {
    noteOn(sem);
  }
}

function releaseKey(sem) {
  if (playMode.mode === 'steer') {
    heldNotes.delete(sem);
    setKeyDown(sem, false);
    steerChannels();
  } else {
    noteOff(sem);
  }
}

function releaseAllKeys() {
  [...keyVoices.keys()].forEach(sem => noteOff(sem));
  if (heldNotes.size) {
    heldNotes.clear();
    document.querySelectorAll('#piano .pk.down')
      .forEach(el => el.classList.remove('down'));
    steerChannels();
  }
}

function setOctave(oct) {
  playMode.octave = Math.min(7, Math.max(1, oct));
  document.getElementById('oct-val').textContent = `Oct ${playMode.octave}`;
}

function setPlayMode(on) {
  playMode.enabled = on;
  document.getElementById('piano-bar').classList.toggle('hidden', !on);
  document.getElementById('piano-toggle').classList.toggle('open', on);
  if (!on) releaseAllKeys();
}

function buildPiano() {
  const piano = document.getElementById('piano');
  const WHITES = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24, 26, 28];
  const letter = {};
  for (const [k, v] of Object.entries(KEY_NOTES)) letter[v] = k;

  WHITES.forEach(sem => {
    const el = document.createElement('button');
    el.className = 'pk white';
    el.dataset.sem = sem;
    el.innerHTML = `<span class="pk-key">${letter[sem]}</span>`;
    piano.appendChild(el);
  });

  const whitesBefore = sem => WHITES.filter(w => w < sem).length;
  Object.values(KEY_NOTES)
    .filter(sem => !WHITES.includes(sem))
    .forEach(sem => {
      const el = document.createElement('button');
      el.className = 'pk black';
      el.dataset.sem = sem;
      el.style.left = `calc(${whitesBefore(sem) * (100 / WHITES.length)}% - 1.7%)`;
      el.innerHTML = `<span class="pk-key">${letter[sem]}</span>`;
      piano.appendChild(el);
    });

  piano.querySelectorAll('.pk').forEach(el => {
    const sem = parseInt(el.dataset.sem, 10);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pressKey(sem);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev =>
      el.addEventListener(ev, () => releaseKey(sem)));
    el.addEventListener('contextmenu', e => e.preventDefault());
  });
}

function resizeCanvas() {
  const parent = canvas.parentElement;
  if (!parent) return;
  const dpr = window.devicePixelRatio || 1;
  W = parent.clientWidth;
  H = parent.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resizeCanvas);

// ---------- About dialog (renders README.md) ----------

function renderMarkdown(md) {
  const esc = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  let html = '';
  let para = [];
  let list = null;
  let inCode = false;
  let codeBuf = [];
  const flushPara = () => {
    if (para.length) { html += `<p>${para.map(inline).join(' ')}</p>`; para = []; }
  };
  const flushList = () => {
    if (list) { html += `<ul>${list.map(i => `<li>${inline(i)}</li>`).join('')}</ul>`; list = null; }
  };

  for (const line of md.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        html += `<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`;
        codeBuf = [];
        inCode = false;
      } else {
        flushPara(); flushList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    const t = line.trim();
    if (!t) { flushPara(); flushList(); continue; }
    if (/^-{3,}$/.test(t)) { flushPara(); flushList(); html += '<hr>'; continue; }

    const h = t.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      flushPara(); flushList();
      const lvl = h[1].length;
      html += `<h${lvl}>${inline(h[2])}</h${lvl}>`;
      continue;
    }

    const li = t.match(/^[-*]\s+(.*)/);
    if (li) { flushPara(); list = list || []; list.push(li[1]); continue; }

    flushList();
    para.push(t);
  }
  flushPara(); flushList();
  return html;
}

// ---------- Events ----------

function bindEvents() {
  addChannelButton.addEventListener('click', () => addChannel());

  masterVolumeSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    masterVolumeVal.textContent = fmtPct(val);
    paintRange(masterVolumeSlider);
    updateMasterVolume(val);
  });
  paintRange(masterVolumeSlider);

  // Viz mode segmented control
  vizSeg.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      vizSeg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
      vizMode = btn.dataset.viz;
    });
  });

  // Viz display dock
  const dockToggle = document.getElementById('viz-dock-toggle');
  const dockPanel = document.getElementById('viz-dock-panel');
  dockToggle.addEventListener('click', () => {
    dockPanel.classList.toggle('hidden');
    dockToggle.classList.toggle('open');
  });

  const bindVizSlider = (id, valId, key, fmt, onChange) => {
    const el = document.getElementById(id);
    const valEl = document.getElementById(valId);
    el.addEventListener('input', (e) => {
      vizSettings[key] = parseFloat(e.target.value);
      valEl.textContent = fmt(vizSettings[key]);
      paintRange(el);
      if (onChange) onChange(vizSettings[key]);
    });
    paintRange(el);
  };

  bindVizSlider('viz-sens', 'viz-sens-val', 'sensitivity', fmtPct);
  bindVizSlider('viz-smooth', 'viz-smooth-val', 'smoothing', fmtPct, (v) => {
    if (analyser) {
      analyser.smoothingTimeConstant = v;
      analyserL.smoothingTimeConstant = v;
      analyserR.smoothingTimeConstant = v;
    }
  });
  bindVizSlider('viz-glow', 'viz-glow-val', 'glow', v => `${Math.round(v)}px`);
  bindVizSlider('viz-lw', 'viz-lw-val', 'lineWidth', v => `${v}px`);
  bindVizSlider('viz-trails', 'viz-trails-val', 'trails', fmtPct);
  bindVizSlider('viz-motion', 'viz-motion-val', 'motion', v => `${v.toFixed(1)}×`);

  document.querySelectorAll('#viz-fft button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#viz-fft button')
        .forEach(b => b.classList.toggle('active', b === btn));
      setFftSize(parseInt(btn.dataset.fft, 10));
    });
  });

  document.querySelectorAll('#viz-color button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#viz-color button')
        .forEach(b => b.classList.toggle('active', b === btn));
      vizSettings.colorMode = btn.dataset.color;
    });
  });

  document.getElementById('viz-grid').addEventListener('change', (e) => {
    document.querySelector('.visualizer-panel').classList.toggle('no-grid', !e.target.checked);
  });

  // Piano play mode
  document.getElementById('piano-toggle')
    .addEventListener('click', () => setPlayMode(!playMode.enabled));
  document.getElementById('oct-down')
    .addEventListener('click', () => setOctave(playMode.octave - 1));
  document.getElementById('oct-up')
    .addEventListener('click', () => setOctave(playMode.octave + 1));
  document.querySelectorAll('#piano-mode button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#piano-mode button')
        .forEach(b => b.classList.toggle('active', b === btn));
      playMode.mode = btn.dataset.pmode;
      releaseAllKeys();
    });
  });
  document.querySelectorAll('#piano-wave button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#piano-wave button')
        .forEach(b => b.classList.toggle('active', b === btn));
      playMode.wave = btn.dataset.pwave;
    });
  });

  // Preset chips
  PRESETS.forEach(preset => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = preset.name;
    btn.addEventListener('click', () => applyPreset(preset));
    presetsContainer.appendChild(btn);
  });

  playPauseButton.addEventListener('click', togglePlay);
  stopButton.addEventListener('click', stopAll);

  // About dialog — fetches and renders README.md once
  const aboutOverlay = document.getElementById('about-overlay');
  const aboutBody = document.getElementById('about-body');
  const aboutToggle = document.getElementById('about-toggle');
  let aboutLoaded = false;
  const openAbout = () => {
    aboutOverlay.classList.remove('hidden');
    aboutToggle.classList.add('open');
    if (aboutLoaded) return;
    aboutLoaded = true;
    fetch('README.md')
      .then(r => { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(md => { aboutBody.innerHTML = renderMarkdown(md); })
      .catch(() => {
        aboutBody.innerHTML = '<p>Could not load README.md — read it on ' +
          '<a href="https://github.com/ramigb/freqGen" target="_blank" rel="noopener">GitHub</a>.</p>';
      });
  };
  const closeAbout = () => {
    aboutOverlay.classList.add('hidden');
    aboutToggle.classList.remove('open');
  };
  aboutToggle.addEventListener('click', openAbout);
  document.getElementById('credits-about').addEventListener('click', openAbout);
  document.getElementById('about-close').addEventListener('click', closeAbout);
  aboutOverlay.addEventListener('click', (e) => {
    if (e.target === aboutOverlay) closeAbout();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !aboutOverlay.classList.contains('hidden')) closeAbout();
  });

  // Spacebar toggles play (unless typing in an input)
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON'].includes(e.target.tagName)) {
      e.preventDefault();
      togglePlay();
      return;
    }
    if (playMode.enabled && !['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) {
      const k = e.key.toLowerCase();
      if (k in KEY_NOTES) {
        e.preventDefault();
        if (!e.repeat) pressKey(KEY_NOTES[k]);
      } else if (e.key === 'ArrowLeft') {
        setOctave(playMode.octave - 1);
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        setOctave(playMode.octave + 1);
        e.preventDefault();
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    if (!playMode.enabled) return;
    const sem = KEY_NOTES[e.key.toLowerCase()];
    if (sem !== undefined) releaseKey(sem);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAllKeys();
  });

  // Master EQ drawer
  const masterEqToggle = document.getElementById('master-eq-toggle');
  const masterEqContainer = document.getElementById('master-eq-container');
  masterEqToggle.addEventListener('click', () => {
    masterEqContainer.classList.toggle('hidden');
    masterEqToggle.classList.toggle('open');
  });

  const bindMasterEq = (id, valId, get, set, fmt) => {
    const slider = document.getElementById(id);
    const valEl = document.getElementById(valId);
    slider.addEventListener('input', (e) => {
      set(parseFloat(e.target.value));
      valEl.textContent = fmt(get());
      paintRange(slider);
      updateMasterFilters();
    });
    paintRange(slider);
  };

  bindMasterEq('master-hp', 'm-hp-val',
    () => masterFilters.hp.freq, v => masterFilters.hp.freq = v, fmtHz);
  bindMasterEq('master-lp', 'm-lp-val',
    () => masterFilters.lp.freq, v => masterFilters.lp.freq = v, fmtHz);
  bindMasterEq('master-mid-freq', 'm-mid-freq-val',
    () => masterFilters.mid.freq, v => masterFilters.mid.freq = v, fmtHz);
  bindMasterEq('master-mid-gain', 'm-mid-gain-val',
    () => masterFilters.mid.gain, v => masterFilters.mid.gain = v, fmtDb);

  // Reverb drawer
  const reverbToggle = document.getElementById('reverb-toggle');
  const reverbContainer = document.getElementById('reverb-container');
  reverbToggle.addEventListener('click', () => {
    reverbContainer.classList.toggle('hidden');
    reverbToggle.classList.toggle('open');
  });

  const reverbMix = document.getElementById('reverb-mix');
  const reverbMixVal = document.getElementById('rv-mix-val');
  reverbMix.addEventListener('input', (e) => {
    reverb.mix = parseFloat(e.target.value);
    reverbMixVal.textContent = fmtPct(reverb.mix);
    paintRange(reverbMix);
    if (wetGain) {
      wetGain.gain.setTargetAtTime(reverb.mix, audioCtx.currentTime, 0.02);
    }
  });
  paintRange(reverbMix);

  const reverbDecay = document.getElementById('reverb-decay');
  const reverbDecayVal = document.getElementById('rv-decay-val');
  reverbDecay.addEventListener('input', (e) => {
    reverbDecayVal.textContent = `${parseFloat(e.target.value).toFixed(1)} s`;
    paintRange(reverbDecay);
  });
  // Regenerating the impulse is heavier — do it once the slider settles
  reverbDecay.addEventListener('change', (e) => {
    reverb.decay = parseFloat(e.target.value);
    if (convNode) convNode.buffer = makeImpulse(reverb.decay);
  });
  paintRange(reverbDecay);
}

function init() {
  bindEvents();
  buildPiano();
  resizeCanvas();
  createAudioGraph();
  addChannel();
  draw();
}

init();
