const frequencySlider = document.getElementById('frequency');
const frequencyNumber = document.getElementById('frequencyNumber');
const waveformSelect = document.getElementById('waveform');
const visualizationSelect = document.getElementById('visualization');
const volumeSlider = document.getElementById('volume');
const playPauseButton = document.getElementById('playPause');
const stopButton = document.getElementById('stop');
const canvas = document.getElementById('scope');
const ctx = canvas.getContext('2d');

let audioCtx;
let oscillator;
let gainNode;
let analyser;
let dataArray;
let bufferLength;
let isPlaying = false;

const colors = {
  primary: '#6cf3c7',
  primarySoft: 'rgba(108, 243, 199, 0.35)',
  highlight: '#8be9fd',
};

function createAudioGraph() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  gainNode = audioCtx.createGain();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  bufferLength = analyser.fftSize;
  dataArray = new Uint8Array(bufferLength);

  gainNode.gain.value = parseFloat(volumeSlider.value);
  gainNode.connect(analyser);
  analyser.connect(audioCtx.destination);
}

function startTone() {
  if (isPlaying) return;
  if (!audioCtx) {
    createAudioGraph();
  }

  oscillator = audioCtx.createOscillator();
  oscillator.type = waveformSelect.value;
  oscillator.frequency.value = parseFloat(frequencySlider.value);
  oscillator.connect(gainNode);
  oscillator.start();

  isPlaying = true;
  playPauseButton.textContent = 'Pause';
}

function stopTone() {
  if (oscillator) {
    oscillator.stop();
    oscillator.disconnect();
    oscillator = null;
  }
  isPlaying = false;
  playPauseButton.textContent = 'Play';
}

function togglePlay() {
  if (!audioCtx) {
    createAudioGraph();
  }

  if (isPlaying) {
    stopTone();
  } else {
    startTone();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }
}

function updateFrequency(value) {
  const clamped = Math.min(Math.max(value, 20), 2000);
  frequencySlider.value = clamped;
  frequencyNumber.value = clamped;
  if (oscillator) {
    oscillator.frequency.setValueAtTime(clamped, audioCtx.currentTime);
  }
}

function updateWaveform(type) {
  if (oscillator) {
    oscillator.type = type;
  }
}

function updateVolume(level) {
  if (gainNode) {
    gainNode.gain.setTargetAtTime(level, audioCtx.currentTime, 0.01);
  }
}

function draw() {
  requestAnimationFrame(draw);
  if (!analyser) return;

  const visMode = visualizationSelect.value;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (visMode === 'waveform') {
    analyser.getByteTimeDomainData(dataArray);
    drawWaveform();
  } else if (visMode === 'spectrum') {
    analyser.getByteFrequencyData(dataArray);
    drawSpectrum();
  } else if (visMode === 'radial') {
    analyser.getByteFrequencyData(dataArray);
    drawRadial();
  }
}

function drawWaveform() {
  ctx.lineWidth = 3;
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
  gradient.addColorStop(0, colors.primary);
  gradient.addColorStop(1, colors.highlight);
  ctx.strokeStyle = gradient;

  ctx.beginPath();
  const sliceWidth = (canvas.width * 1.0) / bufferLength;
  let x = 0;

  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * canvas.height) / 2;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }

    x += sliceWidth;
  }

  ctx.stroke();
}

function drawSpectrum() {
  const barWidth = (canvas.width / bufferLength) * 8;
  let x = 0;
  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 255;
    const barHeight = v * canvas.height;
    const hue = 140 + v * 80;
    ctx.fillStyle = `hsl(${hue}, 90%, 60%)`;
    ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
    x += barWidth + 1;
  }
}

function drawRadial() {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const maxRadius = Math.min(centerX, centerY) - 10;

  ctx.save();
  ctx.translate(centerX, centerY);

  for (let i = 0; i < bufferLength; i += 8) {
    const energy = dataArray[i] / 255;
    const radius = energy * maxRadius;
    const angle = (i / bufferLength) * Math.PI * 2;
    ctx.strokeStyle = `rgba(108, 243, 199, ${Math.max(0.1, energy)})`;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
    ctx.stroke();
  }

  ctx.restore();
}

function bindEvents() {
  frequencySlider.addEventListener('input', (e) => updateFrequency(parseFloat(e.target.value)));
  frequencyNumber.addEventListener('input', (e) => updateFrequency(parseFloat(e.target.value)));
  waveformSelect.addEventListener('change', (e) => updateWaveform(e.target.value));
  volumeSlider.addEventListener('input', (e) => updateVolume(parseFloat(e.target.value)));
  visualizationSelect.addEventListener('change', () => {});

  playPauseButton.addEventListener('click', togglePlay);
  stopButton.addEventListener('click', () => {
    stopTone();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isPlaying) {
      stopTone();
    }
  });
}

function init() {
  bindEvents();
  createAudioGraph();
  draw();
}

init();
