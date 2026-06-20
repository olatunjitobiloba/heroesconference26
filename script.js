(function () {
  const mode = document.currentScript?.dataset.mode || "audience";
  const params = new URLSearchParams(location.search);
  const room = params.get("room") || "adullam-main";
  const tokenKey = `heroes-raffle-token:${room}`;
  const settingsKey = `heroes-raffle-settings:v1:${room}`;
  const versionKey = `heroes-raffle-version:v1:${room}`;

  const els = {
    body: document.body,
    drawNumber: document.getElementById("drawNumber"),
    drawMark: document.getElementById("drawMark"),
    drawButton: document.getElementById("drawButton"),
    fullscreenButton: document.getElementById("fullscreenButton"),
    resetButton: document.getElementById("resetButton"),
    copyButton: document.getElementById("copyButton"),
    minInput: document.getElementById("minInput"),
    maxInput: document.getElementById("maxInput"),
    drawCountInput: document.getElementById("drawCountInput"),
    uniqueToggle: document.getElementById("uniqueToggle"),
    winnerList: document.getElementById("winnerList"),
    remainingCount: document.getElementById("remainingCount"),
    meterFill: document.getElementById("meterFill"),
    liveStatus: document.getElementById("liveStatus"),
    syncStatus: document.getElementById("syncStatus"),
    roomName: document.getElementById("roomName"),
    canvas: document.getElementById("burstCanvas"),
    loginPanel: document.getElementById("loginPanel"),
    adminPanel: document.getElementById("adminPanel"),
    loginForm: document.getElementById("loginForm"),
    pinInput: document.getElementById("pinInput"),
    loginError: document.getElementById("loginError"),
    audienceNote: document.getElementById("audienceNote")
  };

  const ctx = els.canvas.getContext("2d");
  const particles = [];
  let rolling = false;
  let syncing = false;
  let lastVersion = readStoredVersion();
  let pollTimer = null;
  let state = defaultState();

  if (els.roomName) els.roomName.textContent = room;
  if (mode === "audience") document.body.classList.add("audience-mode");

  function defaultState() {
    return {
      min: 1,
      max: 1000,
      drawCount: 1,
      unique: true,
      winners: [],
      current: null,
      drawing: false,
      target: null,
      version: 0,
      message: "Live draw ready"
    };
  }

  function hydrateBackgroundVideo() {
    document.querySelectorAll(".stage-video[data-src]").forEach((video) => {
      if (video.src) return;
      const source = video.dataset.src;
      if (!source) return;
      video.src = source;
      video.load();
      video.play().catch(() => {
        // Background video is decorative; ignore autoplay failures.
      });
    });
  }

  function hydrateSpeakerVideos() {
    const videos = [...document.querySelectorAll(".speaker-strip video")];

    const startVideo = (video) => {
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.playsInline = true;
      if (!video.src && video.dataset.src) {
        video.src = video.dataset.src;
        video.load();
      }
      video.play().catch(() => {
        // Retry below when media is ready or the user first interacts.
      });
    };

    const playAll = () => {
      videos.forEach(startVideo);
    };

    videos.forEach((video) => {
      video.addEventListener("canplay", () => startVideo(video), { once: true });
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) playAll();
    });
    window.addEventListener("pageshow", playAll);
    document.addEventListener("pointerdown", playAll, { once: true });
    document.addEventListener("keydown", playAll, { once: true });

    videos.forEach((video, index) => {
      window.setTimeout(() => startVideo(video), 250 + index * 250);
    });
  }

  function token() {
    return localStorage.getItem(tokenKey) || "";
  }

  function readStoredVersion() {
    return Number(localStorage.getItem(versionKey)) || 0;
  }

  function writeStoredVersion(value) {
    const nextVersion = Number(value) || 0;
    if (nextVersion > readStoredVersion()) {
      localStorage.setItem(versionKey, String(nextVersion));
    }
  }

  function readStoredSettings() {
    try {
      return JSON.parse(localStorage.getItem(settingsKey)) || {};
    } catch {
      return {};
    }
  }

  async function api(path, options = {}) {
    const { auth = true, timeoutMs = 10000, headers: optionHeaders = {}, ...fetchOptions } = options;
    const headers = { "Content-Type": "application/json", ...optionHeaders };
    if (auth && token()) headers.Authorization = `Bearer ${token()}`;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(path, {
        ...fetchOptions,
        headers,
        cache: "no-store",
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Request failed with ${response.status}`);
      }
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Connection timed out");
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function login(event) {
    event.preventDefault();
    setLoginError("");
    try {
      const data = await api("/api/state?action=login", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ pin: els.pinInput.value, room })
      });
      localStorage.setItem(tokenKey, data.token);
      unlockAdmin();
      await syncNow();
    } catch (error) {
      setLoginError(error.message);
    }
  }

  function unlockAdmin() {
    if (els.loginPanel) els.loginPanel.classList.add("is-hidden");
    if (els.adminPanel) els.adminPanel.classList.remove("is-locked");
    if (els.drawButton) els.drawButton.disabled = false;
    if (els.liveStatus) els.liveStatus.textContent = "Admin connected";
  }

  function setLoginError(message) {
    if (els.loginError) els.loginError.textContent = message;
  }

  async function syncNow() {
    if (syncing) return;
    syncing = true;
    try {
      const remote = await api(`/api/state?room=${encodeURIComponent(room)}`, { auth: false });
      const previousCurrent = state.current;
      const next = { ...defaultState(), ...remote };
      const storedVersion = readStoredVersion();
      const currentVersion = Math.max(lastVersion, storedVersion);

      if (next.version && next.version < currentVersion) {
        render();
        setSync("Live channel: online");
        return;
      }

      const versionAdvanced = next.version > lastVersion;
      const currentChanged = next.current !== null && next.current !== previousCurrent;
      const shouldAnimate = versionAdvanced && (next.drawing || (mode === "audience" && currentChanged));
      const shouldBurst = next.current !== null && versionAdvanced && !next.drawing && !shouldAnimate;
      state = next;
      lastVersion = Math.max(lastVersion, state.version || 0);
      writeStoredVersion(lastVersion);

      if (shouldAnimate) {
        await animateRemoteDraw(state.target || state.current);
        render();
      } else {
        render();
        if (shouldBurst) burst();
      }
      setSync("Live channel: online");
    } catch {
      loadLocalFallback();
      setSync("Live channel: retrying");
    } finally {
      syncing = false;
    }
  }

  function setSync(text) {
    if (els.syncStatus) els.syncStatus.textContent = text;
    if (els.audienceNote) els.audienceNote.textContent = text.replace("Live channel: ", "");
  }

  function loadLocalFallback() {
    try {
      state = { ...defaultState(), ...readStoredSettings(), version: readStoredVersion() };
      render();
    } catch {
      render();
    }
  }

  function saveLocalFallback() {
    localStorage.setItem(
      settingsKey,
      JSON.stringify({
        min: state.min,
        max: state.max,
        drawCount: state.drawCount,
        unique: state.unique
      })
    );
    writeStoredVersion(state.version);
  }

  function clampSettings() {
    if (!els.minInput) return;
    let min = clamp(Number(els.minInput.value) || 1, 1, 1000);
    let max = clamp(Number(els.maxInput.value) || 1000, 1, 1000);
    if (min > max) [min, max] = [max, min];

    state.min = min;
    state.max = max;
    state.drawCount = clamp(Number(els.drawCountInput.value) || 1, 1, 50);
    state.unique = els.uniqueToggle.checked;

    els.minInput.value = state.min;
    els.maxInput.value = state.max;
    els.drawCountInput.value = state.drawCount;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  async function draw() {
    if (rolling) return;
    clampSettings();
    rolling = true;
    els.drawButton.disabled = true;
    try {
      const remote = await api("/api/state?action=draw", {
        method: "POST",
        body: JSON.stringify({
          room,
          min: state.min,
          max: state.max,
          drawCount: state.drawCount,
          unique: state.unique
        })
      });
      state = { ...defaultState(), ...remote };
      lastVersion = state.version || lastVersion;
      writeStoredVersion(lastVersion);
      await animateRemoteDraw(state.target);
      await syncNow();
    } catch (error) {
      if (els.liveStatus) els.liveStatus.textContent = error.message;
    } finally {
      rolling = false;
      els.drawButton.disabled = false;
    }
  }

  async function animateRemoteDraw(target) {
    if (!target) {
      render();
      return;
    }
    rolling = true;
    if (els.drawButton) els.drawButton.disabled = true;
    els.drawNumber.classList.remove("is-winner");
    els.drawNumber.classList.add("is-rolling");
    if (els.liveStatus) els.liveStatus.textContent = "Drawing winner";
    await rollTo(target);
    els.drawNumber.classList.remove("is-rolling");
    els.drawNumber.classList.add("is-winner");
    if (els.liveStatus) els.liveStatus.textContent = "Winner locked";
    burst();
    playChime();
    rolling = false;
    if (els.drawButton && mode === "admin") els.drawButton.disabled = false;
  }

  function rollTo(winner) {
    const duration = 4500;
    const start = performance.now();
    const min = state.min || 1;
    const max = state.max || 1000;

    return new Promise((resolve) => {
      function frame(now) {
        const progress = Math.min(1, (now - start) / duration);
        const flicker = progress < 0.9 ? randomInt(min, max) : winner;
        els.drawNumber.textContent = String(flicker).padStart(3, "0");
        els.drawMark.textContent = progress < 0.9 ? "The cave is stirring" : "Birthplace of kings";

        if (progress < 1) {
          requestAnimationFrame(frame);
        } else {
          els.drawNumber.textContent = String(winner).padStart(3, "0");
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  function randomInt(min, max) {
    const range = max - min + 1;
    const bucket = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / range) * range;
    do {
      crypto.getRandomValues(bucket);
    } while (bucket[0] >= limit);
    return min + (bucket[0] % range);
  }

  function availableNumbers() {
    const used = new Set(state.winners.map((winner) => winner.number));
    const numbers = [];
    for (let n = state.min; n <= state.max; n += 1) {
      if (!state.unique || !used.has(n)) numbers.push(n);
    }
    return numbers;
  }

  function render() {
    if (els.minInput) {
      els.minInput.value = state.min;
      els.maxInput.value = state.max;
      els.drawCountInput.value = state.drawCount;
      els.uniqueToggle.checked = state.unique;
    }

    if (!rolling) {
      els.drawNumber.textContent = state.current === null ? "---" : String(state.current).padStart(3, "0");
    }
    els.drawMark.textContent = `From ${state.min} to ${state.max}`;
    if (els.liveStatus) els.liveStatus.textContent = state.message || "Live draw ready";

    const total = state.max - state.min + 1;
    const remaining = availableNumbers().length;
    if (els.remainingCount) els.remainingCount.textContent = remaining;
    if (els.meterFill) els.meterFill.style.width = `${total ? (remaining / total) * 100 : 0}%`;

    if (els.winnerList) {
      els.winnerList.innerHTML = "";
      state.winners.slice(0, 80).forEach((winner, index) => {
        const item = document.createElement("li");
        const number = document.createElement("strong");
        const meta = document.createElement("span");
        number.textContent = String(winner.number).padStart(3, "0");
        meta.textContent = `Draw ${state.winners.length - index}`;
        item.append(number, meta);
        els.winnerList.appendChild(item);
      });
    }

    saveLocalFallback();
  }

  async function reset() {
    if (!confirm("Reset all drawn winners for this room?")) return;
    try {
      state = await api("/api/state?action=reset", {
        method: "POST",
        body: JSON.stringify({ room, min: state.min, max: state.max })
      });
      lastVersion = state.version || lastVersion;
      writeStoredVersion(lastVersion);
      render();
    } catch (error) {
      if (els.liveStatus) els.liveStatus.textContent = error.message;
    }
  }

  function setMode(nextMode) {
    document.body.classList.toggle("audience-mode", nextMode === "audience");
    document.querySelectorAll(".mode-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.mode === nextMode || button.textContent.trim().toLowerCase() === nextMode);
    });
  }

  function copyWinners() {
    const text = state.winners
      .slice()
      .reverse()
      .map((winner, index) => `${index + 1}. ${String(winner.number).padStart(3, "0")}`)
      .join("\n");
    navigator.clipboard.writeText(text || "No winners yet");
    if (els.liveStatus) els.liveStatus.textContent = "Winner list copied";
  }

  function burst() {
    resizeCanvas();
    const originX = window.innerWidth * (document.body.classList.contains("audience-mode") ? 0.5 : 0.42);
    const originY = window.innerHeight * 0.52;
    for (let i = 0; i < 120; i += 1) {
      particles.push({
        x: originX,
        y: originY,
        vx: (Math.random() - 0.5) * 12,
        vy: (Math.random() - 0.8) * 12,
        life: 1,
        size: Math.random() * 5 + 2,
        color: Math.random() > 0.45 ? "#f4d06f" : "#fff3bb"
      });
    }
  }

  function animateParticles() {
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.16;
      p.life -= 0.018;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size * 1.8);
      if (p.life <= 0) particles.splice(i, 1);
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(animateParticles);
  }

  function resizeCanvas() {
    els.canvas.width = window.innerWidth * devicePixelRatio;
    els.canvas.height = window.innerHeight * devicePixelRatio;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function playChime() {
    try {
      const audio = new AudioContext();
      const gain = audio.createGain();
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.7);
      gain.connect(audio.destination);

      [523.25, 659.25, 783.99].forEach((freq, index) => {
        const osc = audio.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;
        osc.connect(gain);
        osc.start(audio.currentTime + index * 0.055);
        osc.stop(audio.currentTime + 0.62 + index * 0.055);
      });
    } catch {
      // Some browsers require a user gesture for sound.
    }
  }

  els.loginForm?.addEventListener("submit", login);
  els.drawButton?.addEventListener("click", draw);
  els.resetButton?.addEventListener("click", reset);
  els.copyButton?.addEventListener("click", copyWinners);
  els.fullscreenButton?.addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  });

  document.querySelectorAll(".mode-button[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  [els.minInput, els.maxInput, els.drawCountInput, els.uniqueToggle].filter(Boolean).forEach((input) => {
    input.addEventListener("change", async () => {
      clampSettings();
      render();
      try {
        await api("/api/state?action=settings", {
          method: "POST",
          body: JSON.stringify({
            room,
            min: state.min,
            max: state.max,
            drawCount: state.drawCount,
            unique: state.unique
          })
        });
      } catch {
        setSync("Live channel: local fallback");
      }
    });
  });

  resizeCanvas();
  animateParticles();
  const startMedia = () => {
    hydrateSpeakerVideos();
    window.setTimeout(hydrateBackgroundVideo, 3200);
  };
  if (document.readyState === "complete") {
    startMedia();
  } else {
    window.addEventListener("load", startMedia, { once: true });
  }

  if (mode === "admin" && token()) {
    unlockAdmin();
  }
  if (mode === "audience") {
    setSync("Live channel: connecting");
  }

  syncNow();
  pollTimer = setInterval(() => {
    if (!rolling) syncNow();
  }, mode === "audience" ? 2500 : 4000);

  window.addEventListener("beforeunload", () => clearInterval(pollTimer));
  window.addEventListener("resize", resizeCanvas);
}());
