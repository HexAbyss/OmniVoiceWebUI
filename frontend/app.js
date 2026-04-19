/**
 * OmniVoice Frontend — app.js
 *
 * Architecture:
 *   OmniVoiceAPI       — thin HTTP client for the FastAPI backend
 *   WaveformVisualizer — canvas-based waveform renderer + playhead
 *   OmniVoiceApp       — main UI controller
 */

// ---------------------------------------------------------------------------
// Config — change API_BASE to point to your running server in production
// ---------------------------------------------------------------------------
const API_BASE = window.OMNIVOICE_API_BASE ?? '';  // same origin by default (served by FastAPI)


// ===========================================================================
// OmniVoiceAPI
// ===========================================================================
class OmniVoiceAPI {
  constructor(base = '') {
    this.base = base.replace(/\/$/, '');
  }

  async health() {
    const r = await fetch(`${this.base}/api/health`);
    if (!r.ok) throw new Error(`Health check failed: ${r.status}`);
    return r.json();
  }

  async getDevice() {
    const r = await fetch(`${this.base}/api/device`);
    if (!r.ok) throw new Error(`Device fetch failed: ${r.status}`);
    return r.json();  // { current, available, is_reloading, model_loaded }
  }

  async switchDevice(device) {
    const r = await fetch(`${this.base}/api/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device }),
    });
    if (!r.ok) {
      let detail = `HTTP ${r.status}`;
      try { const j = await r.json(); detail = j.detail ?? detail; } catch {}
      throw new Error(detail);
    }
    return r.json();
  }

  async languages() {
    const r = await fetch(`${this.base}/api/languages`);
    if (!r.ok) throw new Error(`Languages fetch failed: ${r.status}`);
    return r.json();   // { languages: string[] }
  }

  async voiceDesignOptions() {
    const r = await fetch(`${this.base}/api/voice-design-options`);
    if (!r.ok) throw new Error(`Voice design options fetch failed: ${r.status}`);
    return r.json();   // { categories: { [name]: { options, info } } }
  }

  /**
   * Submit a TTS job. Returns job metadata { job_id, status }.
   * @param {FormData} formData
   * @returns {Promise<{job_id: string, status: string}>}
   */
  async generate(formData) {
    const r = await fetch(`${this.base}/api/generate`, {
      method: 'POST',
      body: formData,
    });
    if (!r.ok) {
      let detail = `HTTP ${r.status}`;
      try {
        const j = await r.json();
        detail = j.detail ?? detail;
      } catch {}
      throw new Error(detail);
    }
    return r.json();  // { job_id, status: "queued" }
  }

  /** @param {string} jobId */
  async getJobStatus(jobId) {
    const r = await fetch(`${this.base}/api/jobs/${jobId}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();  // { job_id, status, error }
  }

  /**
   * @param {string} jobId
   * @returns {Promise<Blob>} WAV audio blob
   */
  async getJobAudio(jobId) {
    const r = await fetch(`${this.base}/api/jobs/${jobId}/audio`);
    if (!r.ok) {
      let detail = `HTTP ${r.status}`;
      try {
        const j = await r.json();
        detail = j.detail ?? detail;
      } catch {}
      throw new Error(detail);
    }
    return r.blob();
  }

}


// ===========================================================================
// WaveformVisualizer
// ===========================================================================
class WaveformVisualizer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this._peaks = null;
    this._animId = null;
  }

  /**
   * Decode audio blob, compute peaks, and draw static waveform.
   * @param {Blob} blob
   */
  async visualize(blob) {
    this._clear();
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    let audioBuffer;
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    } finally {
      audioCtx.close();
    }

    const rawData = audioBuffer.getChannelData(0);
    this._peaks   = this._computePeaks(rawData, this._numBars());
    this._draw(0);
    return audioBuffer.duration;
  }

  /** Update playhead progress (0–1). */
  updateProgress(ratio) {
    if (!this._peaks) return;
    this._draw(ratio);
  }

  clear() {
    this._peaks = null;
    this._clear();
  }

  // ---- private ----

  _clear() {
    const { canvas, ctx } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  _numBars() {
    return Math.floor(this.canvas.clientWidth / 4);
  }

  _computePeaks(channelData, numBars) {
    const blockSize = Math.floor(channelData.length / numBars);
    const peaks = [];
    for (let i = 0; i < numBars; i++) {
      let max = 0;
      const start = i * blockSize;
      for (let j = 0; j < blockSize; j++) {
        const abs = Math.abs(channelData[start + j]);
        if (abs > max) max = abs;
      }
      peaks.push(max);
    }
    // Normalise
    const globalMax = Math.max(...peaks, 0.001);
    return peaks.map(p => p / globalMax);
  }

  _draw(progress) {
    const { canvas, ctx } = this;
    const dpr    = window.devicePixelRatio || 1;
    const w      = canvas.clientWidth;
    const h      = canvas.clientHeight;

    // Sync canvas buffer size
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    }

    ctx.clearRect(0, 0, w, h);

    if (!this._peaks) return;

    const peaks   = this._peaks;
    const numBars = peaks.length;
    const barW    = w / numBars;
    const gap     = Math.max(1, barW * 0.25);
    const bw      = barW - gap;
    const midY    = h / 2;
    const playX   = progress * w;

    for (let i = 0; i < numBars; i++) {
      const x       = i * barW + gap / 2;
      const barH    = Math.max(2, peaks[i] * (h * 0.46));
      const played  = (x + bw / 2) < playX;

      ctx.fillStyle = played
        ? 'rgba(124, 58, 237, 0.95)'
        : 'rgba(124, 58, 237, 0.3)';

      const radius = Math.min(bw / 2, 3);
      ctx.beginPath();
      this._roundRect(ctx, x, midY - barH, bw, barH * 2, radius);
      ctx.fill();
    }
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}


// ===========================================================================
// OmniVoiceApp
// ===========================================================================
class OmniVoiceApp {
  constructor() {
    this.api        = new OmniVoiceAPI(API_BASE);
    this.mode       = 'clone';   // 'clone' | 'design' | 'auto'
    this._audioBlob = null;
    this._audioUrl  = null;

    this._designOptions = {};  // { [category]: { options, info } }
    this._selectedAttrs = {};  // { [category]: Set<string> }

    this._switchingDevice = false;

    this.viz = new WaveformVisualizer(document.getElementById('waveform-canvas'));
  }

  // -------------------------------------------------------------------------
  // Initialisation
  // -------------------------------------------------------------------------

  async init() {
    this._cacheElements();
    this._setupEventListeners();
    await Promise.all([
      this._checkHealth(),
      this._loadLanguages(),
      this._loadVoiceDesignOptions(),
      this._initDeviceSwitcher(),
    ]);
  }

  _cacheElements() {
    // Header
    this.$statusIndicator = document.getElementById('status-indicator');
    this.$statusLabel     = document.getElementById('status-label');

    // Mode tabs
    this.$tabs     = document.querySelectorAll('.tab-btn');
    this.$panels   = {
      clone:  document.getElementById('panel-clone'),
      design: document.getElementById('panel-design'),
      auto:   document.getElementById('panel-auto'),
    };

    // Inputs
    this.$textInput     = document.getElementById('text-input');
    this.$charCount     = document.getElementById('char-count');
    this.$langInput     = document.getElementById('language-input');
    this.$langDatalist  = document.getElementById('languages-list');

    // Clone mode
    this.$dropZone      = document.getElementById('drop-zone');
    this.$refAudioInput = document.getElementById('ref-audio-input');
    this.$refAudioPrev  = document.getElementById('ref-audio-preview');
    this.$refAudioName  = document.getElementById('ref-audio-name');
    this.$removeAudioBtn= document.getElementById('remove-audio-btn');
    this.$refTextInput  = document.getElementById('ref-text-input');

    // Design mode
    this.$instructPrev  = document.getElementById('instruct-preview');

    // Device switcher
    this.$devSwitcher  = document.getElementById('device-switcher');
    this.$devBtnCpu    = document.getElementById('dev-btn-cpu');
    this.$devBtnCuda   = document.getElementById('dev-btn-cuda');
    // Advanced
    this.$stepsInput    = document.getElementById('steps-input');
    this.$stepsValue    = document.getElementById('steps-value');
    this.$speedInput    = document.getElementById('speed-input');
    this.$speedValue    = document.getElementById('speed-value');
    this.$durationInput = document.getElementById('duration-input');
    this.$cfgInput      = document.getElementById('cfg-input');
    this.$cfgValue      = document.getElementById('cfg-value');
    this.$denoiseCheck  = document.getElementById('denoise-check');
    this.$preprocessChk = document.getElementById('preprocess-check');
    this.$postprocessChk= document.getElementById('postprocess-check');

    // Generate
    this.$generateBtn   = document.getElementById('generate-btn');
    this.$generateText  = document.getElementById('generate-btn-text');
    this.$generateSpinner = document.getElementById('generate-btn-spinner');
    this.$generateIcon  = document.getElementById('generate-btn-icon');

    // Output states
    this.$outputIdle    = document.getElementById('output-idle');
    this.$outputLoading = document.getElementById('output-loading');
    this.$loadingMsg    = document.getElementById('loading-msg');
    this.$outputError   = document.getElementById('output-error');
    this.$errorMsg      = document.getElementById('error-msg');
    this.$outputResult  = document.getElementById('output-result');

    // Result
    this.$waveformWrap  = document.querySelector('.waveform-wrap');
    this.$waveformProg  = document.getElementById('waveform-progress');
    this.$playPauseBtn  = document.getElementById('play-pause-btn');
    this.$playIcon      = document.getElementById('play-icon');
    this.$pauseIcon     = document.getElementById('pause-icon');
    this.$currentTime   = document.getElementById('current-time');
    this.$totalTime     = document.getElementById('total-time');
    this.$audioPlayer   = document.getElementById('audio-player');
    this.$downloadBtn   = document.getElementById('download-btn');
    this.$regenerateBtn = document.getElementById('regenerate-btn');
    this.$resultModeBadge = document.getElementById('result-mode-badge');
    this.$resultLangBadge = document.getElementById('result-lang-badge');
    this.$dismissErrBtn = document.getElementById('dismiss-error-btn');
  }

  // -------------------------------------------------------------------------
  // Event listeners
  // -------------------------------------------------------------------------

  _setupEventListeners() {
    // Mode tabs
    this.$tabs.forEach(btn => {
      btn.addEventListener('click', () => this._setMode(btn.dataset.mode));
    });

    // Text char count
    this.$textInput.addEventListener('input', () => {
      const len = this.$textInput.value.length;
      this.$charCount.textContent = `${len.toLocaleString()} char${len === 1 ? '' : 's'}`;
    });

    // Drop zone
    this.$dropZone.addEventListener('click', () => this.$refAudioInput.click());
    this.$dropZone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.$refAudioInput.click(); }
    });
    this.$dropZone.addEventListener('dragover', e => { e.preventDefault(); this.$dropZone.classList.add('drag-over'); });
    this.$dropZone.addEventListener('dragleave',  () => this.$dropZone.classList.remove('drag-over'));
    this.$dropZone.addEventListener('drop', e => {
      e.preventDefault();
      this.$dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) this._setRefAudio(file);
    });
    this.$refAudioInput.addEventListener('change', () => {
      const file = this.$refAudioInput.files[0];
      if (file) this._setRefAudio(file);
    });
    this.$removeAudioBtn.addEventListener('click', e => {
      e.stopPropagation();
      this._clearRefAudio();
    });

    // Range sliders
    this.$stepsInput.addEventListener('input', () => {
      this.$stepsValue.textContent = this.$stepsInput.value;
    });
    this.$speedInput.addEventListener('input', () => {
      this.$speedValue.textContent = `${parseFloat(this.$speedInput.value).toFixed(2)}×`;
    });
    this.$cfgInput.addEventListener('input', () => {
      this.$cfgValue.textContent = parseFloat(this.$cfgInput.value).toFixed(1);
    });

    // Sync displayed values with the actual slider position.
    // The browser may restore the slider to its previous position on reload
    // while JS re-initialises the label from the HTML default — these dispatches fix that.
    this.$stepsInput.dispatchEvent(new Event('input'));
    this.$speedInput.dispatchEvent(new Event('input'));
    this.$cfgInput.dispatchEvent(new Event('input'));

    // Generate
    this.$generateBtn.addEventListener('click', () => this._handleGenerate());

    // Output result — audio player
    this.$playPauseBtn.addEventListener('click', () => this._togglePlay());
    this.$audioPlayer.addEventListener('timeupdate', () => this._onTimeUpdate());
    this.$audioPlayer.addEventListener('ended', () => this._onAudioEnd());
    this.$waveformWrap.addEventListener('click', e => this._seekTo(e));

    // Download
    this.$downloadBtn.addEventListener('click', () => this._download());

    // Regenerate
    this.$regenerateBtn.addEventListener('click', () => this._handleGenerate());

    // Dismiss error
    this.$dismissErrBtn.addEventListener('click', () => this._showState('idle'));

    // Resize: redraw waveform on resize
    const ro = new ResizeObserver(() => {
      if (this._audioBlob) this.viz.updateProgress(this._getPlayProgress());
    });
    ro.observe(this.$waveformWrap);
  }

  // -------------------------------------------------------------------------
  // Device switcher
  // -------------------------------------------------------------------------

  async _initDeviceSwitcher() {
    try {
      const info = await this.api.getDevice();
      this._applyDeviceInfo(info);

      // Wire click handlers
      [this.$devBtnCpu, this.$devBtnCuda].forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.disabled || btn.classList.contains('active')) return;
          this._switchDevice(btn.dataset.device);
        });
      });
    } catch {
      // Non-critical — hide the switcher if backend unreachable
      if (this.$devSwitcher) this.$devSwitcher.style.display = 'none';
    }
  }

  _applyDeviceInfo(info) {
    const current   = info.current ?? 'cpu';
    const available = info.available ?? ['cpu'];

    // Show/hide GPU button based on availability
    this.$devBtnCuda.style.display = available.includes('cuda') ? '' : 'none';

    // Active state
    this.$devBtnCpu .classList.toggle('active', current === 'cpu');
    this.$devBtnCuda.classList.toggle('active', current === 'cuda' || current === 'mps');

    // Re-enable if not switching
    if (!info.is_reloading) {
      [this.$devBtnCpu, this.$devBtnCuda].forEach(b => {
        b.disabled = false;
        b.classList.remove('switching');
      });
    }
  }

  async _switchDevice(device) {
    this._switchingDevice = true;

    // Disable buttons and show visual feedback
    [this.$devBtnCpu, this.$devBtnCuda].forEach(b => {
      b.disabled = true;
      b.classList.remove('active');
    });
    const target = device === 'cuda' ? this.$devBtnCuda : this.$devBtnCpu;
    target.classList.add('switching');
    const originalText = target.textContent;
    target.textContent = device === 'cuda' ? 'GPU…' : 'CPU…';

    this._setStatus('loading', `Switching to ${device === 'cuda' ? 'GPU' : 'CPU'}…`);

    try {
      await this.api.switchDevice(device);
    } catch (err) {
      this._setStatus('error', err.message);
      target.textContent = originalText;
      target.disabled = false;
      target.classList.remove('switching');
      this._switchingDevice = false;
      return;
    }

    // Poll until model is ready on new device
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const info = await this.api.getDevice();
        if (info.model_loaded && !info.is_reloading) {
          target.textContent = originalText;
          this._applyDeviceInfo(info);
          this._setStatus('ok', `Ready · ${info.current}`);
          this._switchingDevice = false;
          return;
        }
        const elapsed = ((i + 1) * 3);
        this._setStatus('loading', `Loading model on ${device === 'cuda' ? 'GPU' : 'CPU'}… (${elapsed}s)`);
      } catch { /* keep polling */ }
    }

    // Timeout
    target.textContent = originalText;
    target.disabled = false;
    target.classList.remove('switching');
    this._switchingDevice = false;
    this._setStatus('error', 'Device switch timed out. Please restart.');
  }

  // -------------------------------------------------------------------------
  // Mode switching
  // -------------------------------------------------------------------------

  _setMode(mode) {
    this.mode = mode;

    this.$tabs.forEach(btn => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active);
    });
    Object.entries(this.$panels).forEach(([key, el]) => {
      el.classList.toggle('hidden', key !== mode);
    });
  }

  // -------------------------------------------------------------------------
  // Reference audio
  // -------------------------------------------------------------------------

  _setRefAudio(file) {
    this._refAudioFile = file;
    this.$refAudioName.textContent = file.name;
    this.$refAudioPrev.classList.remove('hidden');
    this.$dropZone.classList.add('hidden');
  }

  _clearRefAudio() {
    this._refAudioFile = null;
    this.$refAudioInput.value = '';
    this.$refAudioPrev.classList.add('hidden');
    this.$dropZone.classList.remove('hidden');
  }

  // -------------------------------------------------------------------------
  // API helpers
  // -------------------------------------------------------------------------

  async _checkHealth() {
    try {
      const data = await this.api.health();
      if (data.model_loaded) {
        this._setStatus('ok', `Ready · ${data.device}`);
      } else {
        this._setStatus('loading', 'Loading model…');
        // Retry in 5 s
        setTimeout(() => this._checkHealth(), 5000);
      }
    } catch {
      this._setStatus('error', 'Server unreachable');
    }
  }

  async _loadLanguages() {
    try {
      const { languages } = await this.api.languages();
      const fragment = document.createDocumentFragment();
      languages.forEach(lang => {
        const opt = document.createElement('option');
        opt.value = lang;
        fragment.appendChild(opt);
      });
      this.$langDatalist.appendChild(fragment);
    } catch {
      // Non-critical — user can still type free-text
    }
  }

  async _loadVoiceDesignOptions() {
    try {
      const { categories } = await this.api.voiceDesignOptions();
      this._designOptions = categories;
      this._buildDesignUI(categories);
    } catch {
      // Non-critical
    }
  }

  // -------------------------------------------------------------------------
  // Voice design UI
  // -------------------------------------------------------------------------

  _buildDesignUI(categories) {
    const idMap = {
      'Gender':         'attr-Gender',
      'Age':            'attr-Age',
      'Pitch':          'attr-Pitch',
      'Style':          'attr-Style',
      'English Accent': 'attr-English-Accent',
      'Chinese Dialect':'attr-Chinese-Dialect',
    };

    Object.entries(categories).forEach(([cat, { options }]) => {
      const containerId = idMap[cat];
      if (!containerId) return;
      const container = document.getElementById(containerId);
      if (!container) return;
      const chipsEl = container.querySelector('.attr-chips');
      if (!chipsEl) return;

      this._selectedAttrs[cat] = new Set();

      options.forEach(opt => {
        const chip = document.createElement('button');
        chip.type        = 'button';
        chip.className   = 'attr-chip';
        chip.textContent = opt;
        chip.setAttribute('aria-pressed', 'false');

        chip.addEventListener('click', () => {
          const wasSelected = chip.classList.contains('selected');
          // Single-select per category — deselect all siblings first
          chipsEl.querySelectorAll('.attr-chip').forEach(c => {
            c.classList.remove('selected');
            c.setAttribute('aria-pressed', 'false');
          });
          this._selectedAttrs[cat].clear();
          // Toggle: clicking the already-selected chip deselects it
          if (!wasSelected) {
            chip.classList.add('selected');
            chip.setAttribute('aria-pressed', 'true');
            this._selectedAttrs[cat].add(opt);
          }
          this._updateInstructPreview();
        });
        chipsEl.appendChild(chip);
      });
    });
  }

  _updateInstructPreview() {
    const parts = [];
    Object.values(this._selectedAttrs).forEach(set => {
      set.forEach(v => parts.push(v));
    });
    this.$instructPrev.value = parts.join(', ');
  }

  _buildInstructString() {
    // Prefer manual edit of the preview field over chips
    return this.$instructPrev.value.trim() || null;
  }

  // -------------------------------------------------------------------------
  // Generate
  // -------------------------------------------------------------------------

  async _handleGenerate() {
    const text = this.$textInput.value.trim();
    if (!text) {
      this.$textInput.focus();
      this.$textInput.classList.add('shake');
      this.$textInput.addEventListener('animationend', () => this.$textInput.classList.remove('shake'), { once: true });
      return;
    }

    if (this.mode === 'clone' && !this._refAudioFile) {
      this.$dropZone.classList.add('drag-over');
      setTimeout(() => this.$dropZone.classList.remove('drag-over'), 600);
      return;
    }

    this._setGenerating(true);
    this._showState('loading');
    this.$loadingMsg.textContent = 'Generating audio…';

    const fd = new FormData();
    fd.append('text',    text);
    fd.append('mode',    this.mode);

    const lang = this.$langInput.value.trim();
    if (lang && lang !== 'Auto') fd.append('language', lang);

    if (this.mode === 'clone' && this._refAudioFile) {
      fd.append('ref_audio', this._refAudioFile);
      const refText = this.$refTextInput.value.trim();
      if (refText) fd.append('ref_text', refText);
    }

    if (this.mode === 'design') {
      const instruct = this._buildInstructString();
      if (instruct) fd.append('instruct', instruct);
    }

    fd.append('num_step',          this.$stepsInput.value);
    fd.append('guidance_scale',    this.$cfgInput.value);
    fd.append('speed',             this.$speedInput.value);
    fd.append('denoise',           this.$denoiseCheck.checked);
    fd.append('preprocess_prompt', this.$preprocessChk.checked);
    fd.append('postprocess_output',this.$postprocessChk.checked);

    const durationVal = parseFloat(this.$durationInput.value);
    if (!isNaN(durationVal) && durationVal > 0) {
      fd.append('duration', durationVal);
    }

    try {
      const { job_id } = await this.api.generate(fd);
      this.$loadingMsg.textContent = 'Inference running…';
      await this._pollJob(job_id, lang);
    } catch (err) {
      this._showError(err.message || 'Unknown error');
      this._setGenerating(false);
    }
  }

  /**
   * Poll a job until done or error, then show the result.
   * @param {string} jobId
   * @param {string} lang — language label for the result badge
   */
  async _pollJob(jobId, lang) {
    const INTERVAL_MS = 2000;
    const MAX_POLLS   = 300;   // 10 minutes max
    const startedAt   = Date.now();  // track real wall-clock time

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise(r => setTimeout(r, INTERVAL_MS));
      const elapsed = Math.round((Date.now() - startedAt) / 1000);

      let data;
      try {
        data = await this.api.getJobStatus(jobId);
      } catch (err) {
        this._showError(`Polling error: ${err.message}`);
        this._setGenerating(false);
        return;
      }

      if (data.status === 'done') {
        this.$loadingMsg.textContent = 'Fetching audio…';
        try {
          const blob = await this.api.getJobAudio(jobId);
          await this._showResult(blob, lang);
        } catch (err) {
          this._showError(err.message || 'Failed to fetch audio');
        } finally {
          this._setGenerating(false);
        }
        return;
      }

      if (data.status === 'error') {
        this._showError(data.error || 'Inference failed');
        this._setGenerating(false);
        return;
      }

      const statusLabel = data.status === 'queued' ? 'Queued…' : 'Generating audio…';
      this.$loadingMsg.textContent = `${statusLabel} (${Math.round(elapsed)}s)`;
    }

    this._showError('Timeout: inference is taking too long. Please try again.');
    this._setGenerating(false);
  }

  // -------------------------------------------------------------------------
  // Output states
  // -------------------------------------------------------------------------

  _showState(state) {
    this.$outputIdle   .classList.toggle('hidden', state !== 'idle');
    this.$outputLoading.classList.toggle('hidden', state !== 'loading');
    this.$outputError  .classList.toggle('hidden', state !== 'error');
    this.$outputResult .classList.toggle('hidden', state !== 'result');

    // Reset output panel alignment
    const panel = document.querySelector('.panel-output');
    if (state === 'result') {
      panel.style.alignItems = 'stretch';
    } else {
      panel.style.alignItems = 'center';
    }
  }

  _showError(msg) {
    this.$errorMsg.textContent = msg;
    this._showState('error');
  }

  async _showResult(blob, lang) {
    // Revoke previous URL
    if (this._audioUrl) URL.revokeObjectURL(this._audioUrl);
    this._audioBlob = blob;
    this._audioUrl  = URL.createObjectURL(blob);

    // Set audio source
    this.$audioPlayer.src = this._audioUrl;
    await this.$audioPlayer.load();

    this.$currentTime.textContent  = '0:00';
    this.$totalTime.textContent    = '0:00';
    this.$waveformProg.style.width = '0%';

    // Badges
    const modeLabel = { clone: 'Voice Cloning', design: 'Voice Design', auto: 'Auto Voice' };
    this.$resultModeBadge.textContent = modeLabel[this.mode] ?? this.mode;
    this.$resultLangBadge.textContent = lang && lang !== 'Auto' ? lang : 'Auto-detected';

    // Show panel BEFORE visualising — the canvas needs a non-zero clientWidth to draw correctly
    this._showState('result');

    // Draw waveform (canvas is now visible)
    try {
      const duration = await this.viz.visualize(blob);
      this.$totalTime.textContent = this._formatTime(duration);
    } catch { /* non-critical — waveform renderer may not be available on all browsers */ }
  }

  // -------------------------------------------------------------------------
  // Audio playback
  // -------------------------------------------------------------------------

  _togglePlay() {
    if (this.$audioPlayer.paused) {
      this.$audioPlayer.play();
      this.$playIcon .classList.add('hidden');
      this.$pauseIcon.classList.remove('hidden');
      this.$playPauseBtn.setAttribute('aria-label', 'Pause');
    } else {
      this.$audioPlayer.pause();
      this.$pauseIcon.classList.add('hidden');
      this.$playIcon .classList.remove('hidden');
      this.$playPauseBtn.setAttribute('aria-label', 'Play');
    }
  }

  _onTimeUpdate() {
    const p = this._getPlayProgress();
    this.$currentTime.textContent  = this._formatTime(this.$audioPlayer.currentTime);
    this.$waveformProg.style.width = `${p * 100}%`;
    this.viz.updateProgress(p);
  }

  _onAudioEnd() {
    this.$pauseIcon.classList.add('hidden');
    this.$playIcon .classList.remove('hidden');
    this.$playPauseBtn.setAttribute('aria-label', 'Play');
    this.$waveformProg.style.width = '0%';
    this.viz.updateProgress(0);
  }

  _seekTo(e) {
    const rect  = this.$waveformWrap.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    if (this.$audioPlayer.duration) {
      this.$audioPlayer.currentTime = ratio * this.$audioPlayer.duration;
    }
  }

  _getPlayProgress() {
    const dur = this.$audioPlayer.duration;
    if (!dur) return 0;
    return this.$audioPlayer.currentTime / dur;
  }

  // -------------------------------------------------------------------------
  // Download
  // -------------------------------------------------------------------------

  _download() {
    if (!this._audioUrl) return;
    const a   = document.createElement('a');
    a.href    = this._audioUrl;
    a.download = `omnivoice-${Date.now()}.wav`;
    a.click();
  }

  // -------------------------------------------------------------------------
  // UI utilities
  // -------------------------------------------------------------------------

  _setGenerating(generating) {
    this.$generateBtn.disabled = generating;
    this.$generateText.textContent = generating ? 'Generating…' : 'Generate Speech';
    this.$generateSpinner.classList.toggle('hidden', !generating);
    this.$generateIcon   .classList.toggle('hidden', generating);
  }

  _setStatus(type, label) {
    this.$statusIndicator.className = `status-indicator status-${type}`;
    this.$statusLabel.textContent = label;
  }

  _formatTime(secs) {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

}


// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
const app = new OmniVoiceApp();
app.init().catch(console.error);
