// Модуль таймера отдыха (фоновый через системные метки времени), секундомера Планки и Wake Lock

let audioCtx = null;
let wakeLockSentinel = null;
let restIntervalId = null;

export function unlockAudioContext() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  } catch {
    // ignore
  }
}

/**
 * Сигнал ТОЛЬКО в самом конце отдыха (мягкий двойной бип + вибрация, не ставит музыку на паузу)
 */
export function triggerRestFinishedAlert({ soundEnabled = true, vibrationEnabled = true } = {}) {
  if (vibrationEnabled && navigator.vibrate) {
    try {
      navigator.vibrate([350, 140, 350, 140, 550]);
    } catch {
      // ignore
    }
  }

  if (soundEnabled) {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        if (!audioCtx) audioCtx = new AudioContextClass();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const now = audioCtx.currentTime;
        const notes = [
          { freq: 660, start: 0, dur: 0.16 },
          { freq: 880, start: 0.2, dur: 0.28 }
        ];
        for (const n of notes) {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(n.freq, now + n.start);
          gain.gain.setValueAtTime(0.001, now + n.start);
          gain.gain.exponentialRampToValueAtTime(0.28, now + n.start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + n.start + n.dur);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now + n.start);
          osc.stop(now + n.start + n.dur + 0.02);
        }
      }
    } catch {
      // ignore
    }
  }

  // Если вкладка свёрнута — отправляем системное уведомление через Service Worker
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification('Отдых завершён! 💪', {
            body: 'Пора приступать к следующему подходу',
            icon: './icon.svg',
            vibrate: [350, 140, 350],
            tag: 'ddx-rest-timer',
            renotify: true
          });
        });
      }
    } catch {
      // ignore
    }
  }
}

export async function requestNotificationPermissionIfNeeded() {
  if ('Notification' in window && Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch {
      // ignore
    }
  }
}

// === SCREEN WAKE LOCK (чтобы экран Vivo X300 не гас на тренировке) ===

export async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return false;
  try {
    if (wakeLockSentinel && !wakeLockSentinel.released) return true;
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      // Освобождён при сворачивании
    });
    return true;
  } catch {
    return false;
  }
}

export async function releaseWakeLock() {
  if (wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch {
      // ignore
    }
    wakeLockSentinel = null;
  }
}

export function isWakeLockActive() {
  return !!(wakeLockSentinel && !wakeLockSentinel.released);
}

// === ЦИКЛ ОТСЧЁТА ТАЙМЕРА ОТДЫХА ===

export function startRestTimerLoop(getActiveWorkoutFn, onTickFn, onCompleteFn) {
  if (restIntervalId) clearInterval(restIntervalId);

  const checkTimer = () => {
    const active = getActiveWorkoutFn();
    if (!active || !active.restTimer || !active.restTimer.endTime) {
      return;
    }
    const remainingMs = active.restTimer.endTime - Date.now();
    if (remainingMs <= 0) {
      onCompleteFn();
    } else {
      const remainingSec = Math.ceil(remainingMs / 1000);
      onTickFn(remainingSec, active.restTimer.totalSeconds || 60);
    }
  };

  checkTimer();
  restIntervalId = setInterval(checkTimer, 250);
}

export function stopRestTimerLoop() {
  if (restIntervalId) {
    clearInterval(restIntervalId);
    restIntervalId = null;
  }
}

