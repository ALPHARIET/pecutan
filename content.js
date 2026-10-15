// Pecutan: cambuk yang menempel di kursor, mencambuk saat klik kiri.
// Tali cambuk disimulasikan dengan fisika Verlet sehingga ikut berayun
// mengikuti gerakan mouse; klik kiri memicu ayunan dan suara "ctar!".
(() => {
  if (window.__pecutanLoaded) return;
  window.__pecutanLoaded = true;
  console.info('[Pecutan] aktif di halaman ini');

  // --- Bentuk cambuk ---
  const SEGMENTS = 20;
  const SEG_LEN = 8;
  const HANDLE_LEN = 34;
  const GRIP_OFFSET = { x: 14, y: 20 }; // gagang dipegang di kanan bawah panah kursor

  // --- Fisika ---
  const GRAVITY = 1800; // px/s²
  const STEP = 1 / 240; // langkah simulasi tetap (detik)
  const DAMPING = 0.993;
  const ITERATIONS = 12;

  // --- Ayunan saat klik (sudut gagang, 0 = kanan, positif = ke bawah) ---
  // Tangan mundur menjauhi titik klik, mengangkat cambuk lewat atas, lalu
  // menghantam sehingga ujung tali mendarat tepat di titik klik.
  const DEG = Math.PI / 180;
  const ANGLE_IDLE = 65 * DEG;
  const UP = -90 * DEG;
  const ROPE_LEN = SEGMENTS * SEG_LEN;
  const STRIKE_REACH = HANDLE_LEN + ROPE_LEN * 0.8; // jarak tangan ke titik klik saat menghantam
  const STRIKE_DIRS = [35, 145, -35, -145].map((d) => d * DEG); // posisi tangan dari titik klik, urut prioritas
  const EDGE_MARGIN = 24;
  const T_WINDUP = 0.12;
  const T_STRIKE = 0.1;
  const T_HOLD = 0.05;
  const T_RETURN = 0.35;

  const state = { enabled: true, muted: false };
  const mouse = { x: 0, y: 0, seen: false, inside: true };
  let prevMouse = { x: 0, y: 0 };
  let points = [];
  let lastGrip = { x: 0, y: 0 };
  let handleAngle = ANGLE_IDLE;
  let tiltAngle = 0;
  let crack = null;
  let effects = [];
  let canvas = null;
  let ctx = null;
  let rafId = 0;
  let lastTime = 0;
  let accumulator = 0;
  let idleTime = 0;
  let audio = null;
  let pendingCount = 0;
  let countTimer = 0;

  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const easeOut = (t) => 1 - (1 - t) ** 3;
  const easeIn = (t) => t * t * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t; // lewat jalur terpendek

  // Setelah extension di-reload, API chrome.* di tab lama melempar error.
  function safe(fn) {
    try {
      return fn();
    } catch {
      return undefined;
    }
  }

  // ---------------------------------------------------------------- storage

  safe(() =>
    chrome.storage.local.get({ enabled: true, muted: false }, (v) => {
      state.enabled = v.enabled;
      state.muted = v.muted;
      applyEnabled();
    })
  );

  safe(() =>
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.enabled) {
        state.enabled = changes.enabled.newValue;
        applyEnabled();
      }
      if (changes.muted) state.muted = changes.muted.newValue;
    })
  );

  function incrementCount() {
    pendingCount++;
    clearTimeout(countTimer);
    countTimer = setTimeout(() => {
      const add = pendingCount;
      pendingCount = 0;
      safe(() =>
        chrome.storage.local.get({ count: 0 }, (v) => {
          safe(() => chrome.storage.local.set({ count: v.count + add }));
        })
      );
    }, 300);
  }

  function applyEnabled() {
    if (!state.enabled) crack = null;
    wake();
  }

  // ----------------------------------------------------------------- canvas

  function ensureCanvas() {
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'pecutan-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      const style = {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        margin: '0',
        padding: '0',
        border: '0',
        display: 'block',
        'max-width': 'none',
        'pointer-events': 'none',
        'z-index': '2147483647',
      };
      for (const [k, v] of Object.entries(style)) canvas.style.setProperty(k, v, 'important');
      ctx = canvas.getContext('2d');
      resize();
    }
    if (!canvas.isConnected) document.documentElement.appendChild(canvas);
  }

  function resize() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    wake();
  }

  // ---------------------------------------------------------------- physics

  function gripPos(mx, my) {
    return { x: mx + GRIP_OFFSET.x, y: my + GRIP_OFFSET.y };
  }

  function handleTip(grip, angle) {
    return { x: grip.x + Math.cos(angle) * HANDLE_LEN, y: grip.y + Math.sin(angle) * HANDLE_LEN };
  }

  function resetRope() {
    lastGrip = gripPos(mouse.x, mouse.y);
    const tip = handleTip(lastGrip, handleAngle);
    points = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const y = tip.y + i * SEG_LEN;
      points.push({ x: tip.x, y, px: tip.x, py: y });
    }
  }

  function startCrack(tx, ty) {
    // Pilih posisi tangan yang masih muat di layar.
    let dir = STRIKE_DIRS[0];
    for (const d of STRIKE_DIRS) {
      const gx = tx + Math.cos(d) * STRIKE_REACH;
      const gy = ty + Math.sin(d) * STRIKE_REACH;
      if (gx > EDGE_MARGIN && gx < innerWidth - EDGE_MARGIN && gy > EDGE_MARGIN && gy < innerHeight - EDGE_MARGIN) {
        dir = d;
        break;
      }
    }
    const live = gripPos(mouse.x, mouse.y);
    crack = {
      t: 0,
      cracked: false,
      target: { x: tx, y: ty },
      strikeGrip: { x: tx + Math.cos(dir) * STRIKE_REACH, y: ty + Math.sin(dir) * STRIKE_REACH },
      startOffset: { x: lastGrip.x - live.x, y: lastGrip.y - live.y },
      fromAngle: handleAngle,
      windAngle: lerpAngle(dir, UP, 0.5), // diangkat ke belakang-atas
      strikeAngle: dir + Math.PI, // menunjuk ke titik klik
    };
  }

  // Pose tangan selama ayunan: geseran dari posisi kursor, sudut gagang, dan
  // seberapa kuat ujung tali ditarik ke titik klik (0..1).
  function crackPose(c, live) {
    const t1 = T_WINDUP;
    const t2 = t1 + T_STRIKE;
    const t3 = t2 + T_HOLD;
    const t4 = t3 + T_RETURN;
    const sx = c.strikeGrip.x - live.x;
    const sy = c.strikeGrip.y - live.y;
    if (c.t < t1) {
      const p = easeOut(c.t / t1);
      return {
        ox: lerp(c.startOffset.x, sx, p),
        oy: lerp(c.startOffset.y, sy, p),
        angle: lerpAngle(c.fromAngle, c.windAngle, p),
        pull: 0,
      };
    }
    if (c.t < t2) {
      const p = easeIn((c.t - t1) / T_STRIKE);
      return { ox: sx, oy: sy, angle: lerpAngle(c.windAngle, c.strikeAngle, p), pull: p };
    }
    if (c.t < t3) return { ox: sx, oy: sy, angle: c.strikeAngle, pull: 1 };
    if (c.t < t4) {
      const r = (c.t - t3) / T_RETURN;
      const p = easeInOut(r);
      return {
        ox: lerp(sx, 0, p),
        oy: lerp(sy, 0, p),
        angle: lerpAngle(c.strikeAngle, ANGLE_IDLE + tiltAngle, p),
        pull: Math.max(0, 1 - r * 6),
      };
    }
    return null;
  }

  function step(dt, mx, my) {
    const live = gripPos(mx, my);
    let grip = live;
    let pull = 0;
    let target = null;
    if (crack) {
      crack.t += dt;
      if (!crack.cracked && crack.t >= T_WINDUP + T_STRIKE) {
        crack.cracked = true;
        spawnCrack(crack.target.x, crack.target.y);
        if (!state.muted) playCrack();
      }
      const pose = crackPose(crack, live);
      if (pose) {
        grip = { x: live.x + pose.ox, y: live.y + pose.oy };
        handleAngle = pose.angle;
        pull = pose.pull;
        target = crack.target;
      } else {
        crack = null;
      }
    }
    if (!crack) {
      handleAngle += wrapAngle(ANGLE_IDLE + tiltAngle - handleAngle) * Math.min(1, dt * 12);
    }
    lastGrip = grip;

    const tip = handleTip(grip, handleAngle);
    const tail = points[SEGMENTS];
    const g = GRAVITY * dt * dt;

    for (let i = 1; i < points.length; i++) {
      const p = points[i];
      const vx = (p.x - p.px) * DAMPING;
      const vy = (p.y - p.py) * DAMPING;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy + g;
    }
    const head = points[0];
    head.px = head.x;
    head.py = head.y;

    for (let k = 0; k < ITERATIONS; k++) {
      head.x = tip.x;
      head.y = tip.y;
      if (pull > 0) {
        tail.x = lerp(tail.x, target.x, pull);
        tail.y = lerp(tail.y, target.y, pull);
      }
      for (let i = 0; i < SEGMENTS; i++) {
        const a = points[i];
        const b = points[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        const diff = (d - SEG_LEN) / d;
        if (i === 0) {
          b.x -= dx * diff;
          b.y -= dy * diff;
        } else {
          a.x += dx * diff * 0.5;
          a.y += dy * diff * 0.5;
          b.x -= dx * diff * 0.5;
          b.y -= dy * diff * 0.5;
        }
      }
    }
    // Saat hantaman penuh, ujung tali dikunci tepat di titik klik.
    if (pull >= 1) {
      tail.x = target.x;
      tail.y = target.y;
    }
  }

  // ---------------------------------------------------------------- effects

  function spawnCrack(x, y) {
    const rays = [];
    for (let i = 0; i < 10; i++) {
      rays.push({ a: (i / 10) * Math.PI * 2 + Math.random() * 0.3, len: 10 + Math.random() * 10 });
    }
    effects.push({ type: 'burst', x, y, t: 0, life: 0.28, rays });
    effects.push({ type: 'text', x, y, t: 0, life: 0.6, rot: (Math.random() - 0.5) * 0.6 });
  }

  function drawEffects() {
    for (const fx of effects) {
      const p = fx.t / fx.life;
      ctx.save();
      if (fx.type === 'burst') {
        ctx.globalAlpha = 1 - p;
        ctx.lineCap = 'round';
        for (const [color, width] of [['rgba(0,0,0,0.55)', 4.5], ['#ffd23f', 2.5]]) {
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          for (const ray of fx.rays) {
            const r0 = 4 + p * 14;
            const r1 = r0 + ray.len * (1 - p);
            ctx.moveTo(fx.x + Math.cos(ray.a) * r0, fx.y + Math.sin(ray.a) * r0);
            ctx.lineTo(fx.x + Math.cos(ray.a) * r1, fx.y + Math.sin(ray.a) * r1);
          }
          ctx.stroke();
        }
      } else {
        ctx.globalAlpha = 1 - Math.max(0, (p - 0.5) / 0.5);
        ctx.translate(fx.x, fx.y - 14 - p * 22);
        ctx.rotate(fx.rot);
        const s = 0.6 + easeOut(Math.min(1, p * 4)) * 0.6;
        ctx.scale(s, s);
        ctx.font = '900 18px system-ui, -apple-system, "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#3b2314';
        ctx.strokeText('CTAR!', 0, 0);
        ctx.fillStyle = '#ffd23f';
        ctx.fillText('CTAR!', 0, 0);
      }
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------- draw

  function draw() {
    ensureCanvas();
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (state.enabled && mouse.seen && mouse.inside) drawWhip();
    drawEffects();
  }

  function drawWhip() {
    const grip = lastGrip;
    const dir = { x: Math.cos(handleAngle), y: Math.sin(handleAngle) };
    const tip = handleTip(grip, handleAngle);
    const butt = { x: grip.x - dir.x * 6, y: grip.y - dir.y * 6 };

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Tali: garis luar terang dulu supaya tetap terlihat di tema gelap.
    for (const outline of [true, false]) {
      for (let i = 0; i < SEGMENTS; i++) {
        const a = points[i];
        const b = points[i + 1];
        const w = lerp(4, 1.2, i / SEGMENTS);
        ctx.strokeStyle = outline ? 'rgba(255,255,255,0.55)' : '#4a2c17';
        ctx.lineWidth = outline ? w + 2.5 : w;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Rumbai di ujung tali.
    const end = points[SEGMENTS];
    const prev = points[SEGMENTS - 1];
    const ex = end.x - prev.x;
    const ey = end.y - prev.y;
    const el = Math.hypot(ex, ey) || 1;
    ctx.strokeStyle = '#d8b67a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x + (ex / el) * 7, end.y + (ey / el) * 7);
    ctx.stroke();

    // Gagang.
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 9.5;
    ctx.beginPath();
    ctx.moveTo(butt.x, butt.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.strokeStyle = '#7a4a24';
    ctx.lineWidth = 7;
    ctx.stroke();

    // Lilitan pegangan.
    ctx.strokeStyle = '#3b2314';
    ctx.lineWidth = 1.5;
    const nx = -dir.y * 3.5;
    const ny = dir.x * 3.5;
    for (let i = 0; i < 3; i++) {
      const cx = grip.x + dir.x * (4 + i * 5);
      const cy = grip.y + dir.y * (4 + i * 5);
      ctx.beginPath();
      ctx.moveTo(cx - nx, cy - ny);
      ctx.lineTo(cx + nx, cy + ny);
      ctx.stroke();
    }

    // Pangkal gagang.
    ctx.fillStyle = '#3b2314';
    ctx.beginPath();
    ctx.arc(butt.x, butt.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // ------------------------------------------------------------------- loop

  function frame(now) {
    rafId = 0;
    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;

    const moved = mouse.x !== prevMouse.x || mouse.y !== prevMouse.y;
    if (dt > 0) {
      const vx = (mouse.x - prevMouse.x) / dt;
      tiltAngle += (clamp(vx * 0.0005, -0.6, 0.6) - tiltAngle) * Math.min(1, dt * 8);
    }

    if (mouse.seen && state.enabled) {
      accumulator += dt;
      const steps = Math.floor(accumulator / STEP);
      for (let s = 1; s <= steps; s++) {
        const f = s / steps;
        step(STEP, lerp(prevMouse.x, mouse.x, f), lerp(prevMouse.y, mouse.y, f));
      }
      accumulator -= steps * STEP;
    }
    prevMouse = { x: mouse.x, y: mouse.y };

    for (const fx of effects) fx.t += dt;
    effects = effects.filter((fx) => fx.t < fx.life);

    draw();

    idleTime = moved ? 0 : idleTime + dt;
    if (shouldSleep()) return;
    rafId = requestAnimationFrame(frame);
  }

  function shouldSleep() {
    if (crack || effects.length) return false;
    if (!state.enabled || !mouse.seen || !mouse.inside) return true;
    if (idleTime < 0.5) return false;
    return points.every((p) => Math.hypot(p.x - p.px, p.y - p.py) < 0.05);
  }

  function wake() {
    if (rafId) return;
    lastTime = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ audio

  function getAudio() {
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audio = new AC();
    }
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }

  function noise(ac, duration) {
    const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * duration), ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    src.buffer = buffer;
    return src;
  }

  function playWhoosh(delay) {
    const ac = getAudio();
    if (!ac) return;
    const t = ac.currentTime + delay;
    const src = noise(ac, 0.25);
    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.exponentialRampToValueAtTime(2200, t + 0.2);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.connect(filter).connect(gain).connect(ac.destination);
    src.start(t);
    src.stop(t + 0.25);
  }

  function playCrack() {
    const ac = getAudio();
    if (!ac) return;
    const t = ac.currentTime;

    // Letupan tajam: derau frekuensi tinggi dengan serangan sangat cepat.
    const src = noise(ac, 0.15);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.9, t + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(hp).connect(gain).connect(ac.destination);
    src.start(t);
    src.stop(t + 0.15);

    // Hentakan pendek supaya bunyinya lebih "padat".
    const osc = ac.createOscillator();
    osc.frequency.setValueAtTime(900, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.03);
    const og = ac.createGain();
    og.gain.setValueAtTime(0.35, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    osc.connect(og).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  }

  // ----------------------------------------------------------------- events

  function updateMouse(e) {
    const jumped = Math.hypot(e.clientX - mouse.x, e.clientY - mouse.y) > 400;
    const wasAway = !mouse.seen || !mouse.inside;
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.inside = true;
    if (wasAway || jumped) {
      mouse.seen = true;
      prevMouse = { x: mouse.x, y: mouse.y };
      resetRope();
    }
  }

  addEventListener(
    'mousemove',
    (e) => {
      updateMouse(e);
      wake();
    },
    { capture: true, passive: true }
  );

  addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 0 || !state.enabled) return;
      updateMouse(e);
      getAudio();
      startCrack(e.clientX, e.clientY);
      if (!state.muted) playWhoosh(T_WINDUP);
      incrementCount();
      wake();
    },
    { capture: true, passive: true }
  );

  addEventListener(
    'mouseout',
    (e) => {
      if (e.relatedTarget) return;
      mouse.inside = false;
      wake();
    },
    { capture: true, passive: true }
  );

  addEventListener('resize', resize, { passive: true });
})();
