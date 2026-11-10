import {
  EQUIPMENT_TYPES,
  MUSCLE_GROUPS,
  ANGLE_PRESETS,
  FOUR_WEEK_CYCLE
} from './data.js';

import {
  initDatabase,
  getAppState,
  setAppState,
  getActiveWorkout,
  saveActiveWorkout,
  getAllExercises,
  saveExercise,
  deleteExercise,
  getAllRoutines,
  saveRoutine,
  getAllWorkoutsHistory,
  getExercisePrefill,
  finishAndSaveWorkout,
  deleteWorkoutFromHistory,
  updateWorkoutInHistory,
  getExerciseProgressionHistory,
  exportFullDatabase,
  importFullDatabase,
  checkStorageStatus,
  roundWeightClean,
  formatMatrixWeightLabel,
  formatDurationMMSS,
  parseDurationInput
} from './db.js';

import {
  unlockAudioContext,
  triggerRestFinishedAlert,
  requestNotificationPermissionIfNeeded,
  acquireWakeLock,
  releaseWakeLock,
  isWakeLockActive,
  startRestTimerLoop
} from './timer.js';

import {
  SUPABASE_SQL_SNIPPET,
  pushToSupabase,
  pullFromSupabase
} from './supabase.js';

// === ГЛОБАЛЬНОЕ СОСТОЯНИЕ UI ===
const state = {
  activeTab: 'workout', // 'workout' | 'calendar' | 'exercises' | 'settings'
  exercises: [],
  routines: [],
  workoutsHistory: [],
  cycleState: { currentStep: 0, manualDeloadOverride: null },
  warmupConfig: { upper: [], lower: [] },
  settings: {
    restTimerSeconds: 60,
    endSoundEnabled: true,
    vibrationEnabled: true,
    wakeLockEnabled: true,
    deloadPercent: 18,
    supabaseUrl: '',
    supabaseAnonKey: '',
    supabaseAutoSync: true,
    lastCloudSyncAt: null
  },
  storageStatus: { persisted: false, usageMB: 0 },
  activeWorkout: null,
  // Секундомер для планки (если запущен в текущем подходе)
  plankTimer: {
    running: false,
    exIndex: null,
    setIndex: null,
    startTimeMs: null,
    elapsedSeconds: 0,
    intervalId: null
  },
  // Состояние календаря
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(),
  selectedCalendarDate: null,
  // Фильтр упражнений
  muscleFilter: 'Все',
  // Открытая модалка
  modal: null, // { type, data }
  deferredInstallPrompt: null
};

// === УТИЛИТЫ ===
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function showToast(message, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = 'toast';
  if (isError) {
    el.style.borderColor = '#ef4444';
  }
  el.innerHTML = `<span>${isError ? '⚠️' : '✅'}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.25s';
    setTimeout(() => el.remove(), 260);
  }, 2800);
}

function formatDateRu(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function formatDateTimeRu(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function toLocalDateKey(isoStr) {
  const d = new Date(isoStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// === ЗАГРУЗКА ДАННЫХ ===
async function reloadAllData() {
  state.exercises = await getAllExercises();
  state.routines = await getAllRoutines();
  state.workoutsHistory = await getAllWorkoutsHistory();
  state.cycleState = (await getAppState('cycle_state')) || { currentStep: 0, manualDeloadOverride: null };
  state.warmupConfig = (await getAppState('warmup_config')) || { upper: [], lower: [] };
  const savedSettings = await getAppState('settings');
  if (savedSettings) {
    state.settings = { ...state.settings, ...savedSettings };
  }
  state.activeWorkout = await getActiveWorkout();
  state.storageStatus = await checkStorageStatus();
}

// === УПРАВЛЕНИЕ АКТИВНОЙ ТРЕНИРОВКОЙ ===

function isCurrentDeloadActive() {
  const stepIndex = (state.cycleState.currentStep || 0) % FOUR_WEEK_CYCLE.length;
  const cycleItem = FOUR_WEEK_CYCLE[stepIndex] || FOUR_WEEK_CYCLE[0];
  if (state.cycleState.manualDeloadOverride !== null && state.cycleState.manualDeloadOverride !== undefined) {
    return !!state.cycleState.manualDeloadOverride;
  }
  return !!cycleItem.isDeload;
}

async function startWorkoutFromRoutine(routineId) {
  unlockAudioContext();
  requestNotificationPermissionIfNeeded();

  const isDeload = isCurrentDeloadActive();
  const stepIndex = (state.cycleState.currentStep || 0) % FOUR_WEEK_CYCLE.length;
  const cycleItem = FOUR_WEEK_CYCLE[stepIndex] || FOUR_WEEK_CYCLE[0];

  const exMap = new Map(state.exercises.map((e) => [e.id, e]));
  let routine = state.routines.find((r) => r.id === routineId);

  if (!routine) {
    // Свободная тренировка
    routine = {
      id: 'free_workout',
      code: 'Своб.',
      name: 'Свободная тренировка',
      warmupType: 'upper',
      items: state.exercises.slice(0, 3).map((e) => ({
        exerciseId: e.id,
        sets: e.defaultSets || 3,
        repRange: e.repRange || '10'
      }))
    };
  }

  const warmupList = state.warmupConfig[routine.warmupType || 'upper'] || state.warmupConfig.upper || [];
  const workoutExercises = [];

  for (const item of routine.items) {
    const ex = exMap.get(item.exerciseId);
    if (!ex) continue;

    const eq = ex.defaultEquipment || 'matrix';
    const angle = ex.defaultAngle || '';
    const prefill = await getExercisePrefill(ex, eq, isDeload, state.settings.deloadPercent || 18, angle);

    // В неделю разгрузки убираем 1 подход из каждого упражнения (напр. 2 вместо 3)
    const targetSetsCount = isDeload
      ? Math.max(1, (item.sets || ex.defaultSets || 3) - 1)
      : (item.sets || ex.defaultSets || 3);

    const sets = [];
    for (let i = 0; i < targetSetsCount; i++) {
      sets.push({
        setNumber: i + 1,
        baseWeight: prefill.baseWeight,
        addonWeight: prefill.addonWeight,
        weight: prefill.weight,
        reps: prefill.reps,
        isCompleted: false,
        completedAt: null
      });
    }

    workoutExercises.push({
      exerciseId: ex.id,
      name: ex.name,
      muscleGroup: ex.muscleGroup,
      equipmentUsed: eq,
      angleVariant: angle,
      isTimeBased: !!ex.isTimeBased,
      repRange: item.repRange || ex.repRange || '8–10',
      seatSettings: ex.seatSettings || '',
      prevSummaryText: prefill.prevSummaryText,
      sets
    });
  }

  const newActive = {
    id: `w_${Date.now()}`,
    routineId: routine.id,
    routineName: routine.name,
    routineCode: routine.code || routine.name,
    startedAt: new Date().toISOString(),
    isDeload,
    cycleWeek: cycleItem.week,
    cycleStep: stepIndex,
    warmupType: routine.warmupType || 'upper',
    warmupCompleted: false,
    warmupCheckedIndices: [],
    restTimer: null, // { endTime, totalSeconds }
    exercises: workoutExercises
  };

  state.activeWorkout = newActive;
  await saveActiveWorkout(newActive);

  if (state.settings.wakeLockEnabled) {
    await acquireWakeLock();
  }

  renderApp();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// === ОБНОВЛЕНИЕ ВЕСОВ И ПОВТОРЕНИЙ В ПОДХОДЕ (С КАСКАДОМ ВПЕРЁД) ===

async function updateSetField(exIndex, setIndex, field, rawValue) {
  if (!state.activeWorkout) return;
  const exBlock = state.activeWorkout.exercises[exIndex];
  if (!exBlock) return;
  const currentSet = exBlock.sets[setIndex];
  if (!currentSet) return;

  if (field === 'baseWeight') {
    const val = Math.max(0, parseFloat(String(rawValue).replace(',', '.')) || 0);
    currentSet.baseWeight = val;
    currentSet.weight = roundWeightClean(val + (Number(currentSet.addonWeight) || 0));

    // Правило 2: вес переходит со сделанного/изменённого подхода во все следующие ещё не выполненные подходы
    for (let i = setIndex + 1; i < exBlock.sets.length; i++) {
      if (!exBlock.sets[i].isCompleted) {
        exBlock.sets[i].baseWeight = currentSet.baseWeight;
        exBlock.sets[i].addonWeight = currentSet.addonWeight;
        exBlock.sets[i].weight = currentSet.weight;
      }
    }
  } else if (field === 'addonWeight') {
    const val = Number(rawValue) || 0;
    currentSet.addonWeight = val;
    currentSet.weight = roundWeightClean((Number(currentSet.baseWeight) || 0) + val);

    // Каскадируем довесок во все следующие ещё не выполненные подходы
    for (let i = setIndex + 1; i < exBlock.sets.length; i++) {
      if (!exBlock.sets[i].isCompleted) {
        exBlock.sets[i].baseWeight = currentSet.baseWeight;
        exBlock.sets[i].addonWeight = currentSet.addonWeight;
        exBlock.sets[i].weight = currentSet.weight;
      }
    }
  } else if (field === 'reps') {
    if (exBlock.isTimeBased) {
      currentSet.reps = parseDurationInput(rawValue);
    } else {
      currentSet.reps = Math.max(0, parseInt(rawValue, 10) || 0);
    }
  }

  await saveActiveWorkout(state.activeWorkout);
}

async function toggleSetCompleted(exIndex, setIndex) {
  if (!state.activeWorkout) return;
  unlockAudioContext();

  const exBlock = state.activeWorkout.exercises[exIndex];
  if (!exBlock) return;
  const currentSet = exBlock.sets[setIndex];
  if (!currentSet) return;

  const nowCompleted = !currentSet.isCompleted;
  currentSet.isCompleted = nowCompleted;
  currentSet.completedAt = nowCompleted ? new Date().toISOString() : null;

  if (nowCompleted) {
    // При завершении подхода: его фактический вес переходит на следующий ещё не выполненный подход
    for (let i = setIndex + 1; i < exBlock.sets.length; i++) {
      if (!exBlock.sets[i].isCompleted) {
        exBlock.sets[i].baseWeight = currentSet.baseWeight;
        exBlock.sets[i].addonWeight = currentSet.addonWeight;
        exBlock.sets[i].weight = currentSet.weight;
      }
    }

    // Автоматически запускаем таймер отдыха (по умолчанию 60 сек)
    const restSec = Number(state.settings.restTimerSeconds) || 60;
    state.activeWorkout.restTimer = {
      endTime: Date.now() + restSec * 1000,
      totalSeconds: restSec
    };
  }

  await saveActiveWorkout(state.activeWorkout);
  renderApp();
}

// === УПРАВЛЕНИЕ ТАЙМЕРОМ ОТДЫХА ===

async function adjustRestTimer(deltaSeconds) {
  if (!state.activeWorkout || !state.activeWorkout.restTimer) return;
  const rt = state.activeWorkout.restTimer;
  const newEndTime = Math.max(Date.now() + 1000, rt.endTime + deltaSeconds * 1000);
  rt.endTime = newEndTime;
  rt.totalSeconds = Math.max(15, (rt.totalSeconds || 60) + deltaSeconds);
  await saveActiveWorkout(state.activeWorkout);
  renderRestTimerBarOnly();
}

async function cancelRestTimer() {
  if (!state.activeWorkout) return;
  state.activeWorkout.restTimer = null;
  await saveActiveWorkout(state.activeWorkout);
  renderRestTimerBarOnly();
}

function renderRestTimerBarOnly() {
  const container = document.getElementById('rest-timer-mount');
  if (!container) return;

  const active = state.activeWorkout;
  if (!active || !active.restTimer || !active.restTimer.endTime) {
    container.innerHTML = '';
    return;
  }

  const remainingMs = Math.max(0, active.restTimer.endTime - Date.now());
  const remainingSec = Math.ceil(remainingMs / 1000);
  const totalSec = Math.max(1, active.restTimer.totalSeconds || 60);
  const pct = Math.min(100, Math.max(0, (remainingSec / totalSec) * 100));

  const timeFormatted = formatDurationMMSS(remainingSec);

  container.innerHTML = `
    <div class="rest-timer-bar">
      <div class="rest-timer-top">
        <div>
          <div style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Таймер отдыха</div>
          <div class="rest-countdown" id="rest-countdown-val">${timeFormatted}</div>
        </div>
        <div class="rest-controls">
          <button class="rest-btn" data-action="rest-adjust" data-delta="-15">-15с</button>
          <button class="rest-btn" data-action="rest-adjust" data-delta="15">+15с</button>
          <button class="rest-btn skip" data-action="rest-cancel" title="Сбросить таймер">✕</button>
        </div>
      </div>
      <div class="rest-progress-track">
        <div class="rest-progress-fill" id="rest-progress-fill" style="width:${pct}%"></div>
      </div>
    </div>
  `;
}

// === СЕКУНДОМЕР ПЛАНКИ ===
function togglePlankStopwatch(exIndex, setIndex) {
  const pt = state.plankTimer;
  if (pt.running && pt.exIndex === exIndex && pt.setIndex === setIndex) {
    // Останавливаем и записываем время в подход
    clearInterval(pt.intervalId);
    const totalSec = Math.max(1, Math.round((Date.now() - pt.startTimeMs) / 1000));
    pt.running = false;
    pt.intervalId = null;
    updateSetField(exIndex, setIndex, 'reps', String(totalSec)).then(() => {
      showToast(`Планка: записано ${formatDurationMMSS(totalSec)}`);
      renderApp();
    });
  } else {
    if (pt.intervalId) clearInterval(pt.intervalId);
    pt.running = true;
    pt.exIndex = exIndex;
    pt.setIndex = setIndex;
    pt.startTimeMs = Date.now();
    pt.elapsedSeconds = 0;
    pt.intervalId = setInterval(() => {
      pt.elapsedSeconds = Math.floor((Date.now() - pt.startTimeMs) / 1000);
      const badgeEl = document.getElementById(`plank-live-${exIndex}-${setIndex}`);
      if (badgeEl) {
        badgeEl.textContent = `⏹ Стоп (${formatDurationMMSS(pt.elapsedSeconds)})`;
      }
    }, 250);
    renderApp();
  }
}

// === ГЛАВНЫЙ РЕНДЕР ПРИЛОЖЕНИЯ ===

function renderApp() {
  const root = document.getElementById('app-root');
  if (!root) return;

  const wakeActive = isWakeLockActive();

  root.innerHTML = `
    <div class="app-container">
      <header class="top-header">
        <div class="brand-title">
          <div class="brand-logo">SKIBIDI</div>
          <div class="brand-text">
            <h1>SKIBIDI Gym Tracker</h1>
            <p>${state.activeWorkout ? 'Активная тренировка в зале' : 'Личный дневник (Верх А / Низ / Верх Б)'}</p>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          ${
            state.deferredInstallPrompt
              ? `<button class="btn btn-primary btn-sm" data-action="install-pwa">📲 Установить</button>`
              : ''
          }
          ${
            state.activeWorkout
              ? `<span class="status-pill ${wakeActive ? 'active-wake' : ''}">
                  ${wakeActive ? '⚡ Экран активен' : '💾 Автосохранение'}
                 </span>`
              : `<span class="status-pill">
                  ${state.storageStatus.persisted ? '🛡️ БД защищена' : '📱 Локальная БД'}
                 </span>`
          }
        </div>
      </header>

      <main id="main-view">
        ${renderCurrentTab()}
      </main>
    </div>

    <div id="rest-timer-mount"></div>

    <nav class="bottom-nav">
      <div class="bottom-nav-inner">
        <button class="nav-item ${state.activeTab === 'workout' ? 'active' : ''}" data-tab="workout">
          ${state.activeWorkout ? '<span class="nav-dot-live"></span>' : ''}
          <span style="font-size:18px;">🏋️</span>
          <span>Тренировка</span>
        </button>
        <button class="nav-item ${state.activeTab === 'calendar' ? 'active' : ''}" data-tab="calendar">
          <span style="font-size:18px;">📅</span>
          <span>Календарь</span>
        </button>
        <button class="nav-item ${state.activeTab === 'exercises' ? 'active' : ''}" data-tab="exercises">
          <span style="font-size:18px;">📈</span>
          <span>Прогресс</span>
        </button>
        <button class="nav-item ${state.activeTab === 'settings' ? 'active' : ''}" data-tab="settings">
          <span style="font-size:18px;">☁️</span>
          <span>Бэкап</span>
        </button>
      </div>
    </nav>

    ${renderModal()}
  `;

  renderRestTimerBarOnly();
}

function renderCurrentTab() {
  switch (state.activeTab) {
    case 'workout':
      return state.activeWorkout ? renderActiveWorkoutScreen() : renderWorkoutSelectorScreen();
    case 'calendar':
      return renderCalendarScreen();
    case 'exercises':
      return renderExercisesAndProgressScreen();
    case 'settings':
      return renderSettingsAndBackupScreen();
    default:
      return renderWorkoutSelectorScreen();
  }
}

// === ВКЛАДКА 1А: ЭКРАН ВЫБОРА ТРЕНИРОВКИ И 4-НЕДЕЛЬНОГО ЦИКЛА ===

function renderWorkoutSelectorScreen() {
  const currentStep = (state.cycleState.currentStep || 0) % FOUR_WEEK_CYCLE.length;
  const currentCycleItem = FOUR_WEEK_CYCLE[currentStep] || FOUR_WEEK_CYCLE[0];
  const isDeload = isCurrentDeloadActive();
  const exMap = new Map(state.exercises.map((e) => [e.id, e]));

  // Рендерим 4 коробки недель цикла
  const weeksHtml = [1, 2, 3, 4].map((weekNum) => {
    const stepsForWeek = FOUR_WEEK_CYCLE.filter((c) => c.week === weekNum);
    const isCurrentWeek = currentCycleItem.week === weekNum;
    const dotsHtml = stepsForWeek.map((st) => {
      let cls = 'cycle-dot';
      if (st.step < currentStep) cls += ' done';
      else if (st.step === currentStep) cls += ' current';
      return `<span class="${cls}" title="${st.dayLabel}"></span>`;
    }).join('');

    const schemeLabel = weekNum === 1 || weekNum === 3
      ? 'А · Низ · Б'
      : weekNum === 2
        ? 'Б · Низ · А'
        : 'Разгрузка';

    return `
      <div class="cycle-week-box ${isCurrentWeek ? 'active' : ''} ${weekNum === 4 ? 'deload' : ''}" data-action="set-cycle-week" data-week="${weekNum}">
        <div class="cycle-week-title">Нед. ${weekNum}</div>
        <div class="cycle-dots">${dotsHtml}</div>
        <div style="font-size:10px; color:var(--text-muted); margin-top:4px;">${schemeLabel}</div>
      </div>
    `;
  }).join('');

  const routinesHtml = state.routines.map((routine) => {
    const isRecommended = routine.id === currentCycleItem.routineId;
    const badgeCls = routine.badgeColor === 'blue'
      ? 'badge-blue'
      : routine.badgeColor === 'purple'
        ? 'badge-purple'
        : 'badge-emerald';

    const exListPreview = routine.items.map((item, idx) => {
      const ex = exMap.get(item.exerciseId);
      if (!ex) return '';
      const setsCount = isDeload ? Math.max(1, (item.sets || 3) - 1) : (item.sets || 3);
      return `
        <div style="display:flex; justify-content:space-between; font-size:13px; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.04);">
          <span style="color:var(--text-main);">${idx + 1}. ${escapeHtml(ex.name)}</span>
          <span style="color:var(--text-muted); font-weight:700; white-space:nowrap; margin-left:8px;">${setsCount} × ${escapeHtml(item.repRange || ex.repRange)}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="card ${isRecommended ? 'card-recommended' : ''} ${isDeload && isRecommended ? 'card-deload' : ''}">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:6px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="badge ${badgeCls}">${escapeHtml(routine.code)}</span>
            ${isRecommended ? `<span class="badge badge-emerald">★ По плану (${currentCycleItem.dayLabel}, Нед. ${currentCycleItem.week})</span>` : ''}
            ${isDeload ? `<span class="badge badge-amber">Разгрузка -1 подход</span>` : ''}
          </div>
          <button class="btn btn-secondary btn-sm" data-action="edit-routine" data-routine-id="${routine.id}">✎ Шаблон</button>
        </div>

        <h2 style="margin:0 0 4px 0; font-size:19px; font-weight:800;">${escapeHtml(routine.name)}</h2>
        <p style="margin:0 0 12px 0; font-size:13px; color:var(--text-muted);">${escapeHtml(routine.subtitle || '')}</p>

        <div style="margin-bottom:14px;">
          ${exListPreview}
        </div>

        <button class="btn ${isRecommended ? 'btn-primary' : 'btn-secondary'} btn-block" data-action="start-workout" data-routine-id="${routine.id}">
          ▶ Начать «${escapeHtml(routine.name)}»
        </button>
      </div>
    `;
  }).join('');

  return `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-size:12px; font-weight:700; color:var(--text-muted); text-transform:uppercase;">Чередование Пн / Ср / Пт</div>
          <div style="font-size:16px; font-weight:800; margin-top:2px;">
            Неделя ${currentCycleItem.week} (${currentCycleItem.dayLabel}) — ${currentCycleItem.week === 4 ? 'Разгрузка' : 'Рабочая'}
          </div>
        </div>
        <button class="btn btn-secondary btn-sm" data-action="cycle-step-next" title="Сдвинуть день по плану">Сменить шаг ↻</button>
      </div>

      <div class="cycle-grid">
        ${weeksHtml}
      </div>

      <div class="toggle-row" data-action="toggle-deload-mode">
        <div>
          <div style="font-size:14px; font-weight:800; color:${isDeload ? '#fbbf24' : 'var(--text-main)'};">
            ⚡ Неделя разгрузки (-1 подход и -${state.settings.deloadPercent || 18}% вес)
          </div>
          <div style="font-size:12px; color:var(--text-muted);">
            На 4-й неделе включается автоматически (или включи вручную)
          </div>
        </div>
        <div class="switch ${isDeload ? 'on' : ''}"></div>
      </div>
    </div>

    ${routinesHtml}

    <div class="card" style="text-align:center;">
      <p style="margin:0 0 10px 0; font-size:13px; color:var(--text-muted);">Хочешь потренироваться вне шаблона?</p>
      <button class="btn btn-secondary btn-block" data-action="start-workout" data-routine-id="free_workout">
        + Запустить свободную тренировку
      </button>
    </div>
  `;
}

// === ВКЛАДКА 1Б: ЭКРАН АКТИВНОЙ ТРЕНИРОВКИ ===

function renderActiveWorkoutScreen() {
  const active = state.activeWorkout;
  if (!active) return '';

  const totalSets = active.exercises.reduce((acc, ex) => acc + ex.sets.length, 0);
  const doneSets = active.exercises.reduce((acc, ex) => acc + ex.sets.filter((s) => s.isCompleted).length, 0);

  // 1. Блок Настраиваемой Разминки (без записи в статистику!)
  const warmupItems = state.warmupConfig[active.warmupType || 'upper'] || state.warmupConfig.upper || [];
  const checkedSet = new Set(active.warmupCheckedIndices || []);

  let warmupHtml = '';
  if (active.warmupCompleted) {
    warmupHtml = `
      <div class="warmup-card completed" style="display:flex; justify-content:space-between; align-items:center;">
        <div style="font-size:14px; font-weight:700; color:#34d399;">
          ✓ Разминка перед тренировкой выполнена
        </div>
        <button class="btn btn-secondary btn-sm" data-action="toggle-warmup-done">Развернуть</button>
      </div>
    `;
  } else {
    const itemsListHtml = warmupItems.map((text, idx) => {
      const isChecked = checkedSet.has(idx);
      return `
        <div class="warmup-item ${isChecked ? 'checked' : ''}" data-action="toggle-warmup-item" data-idx="${idx}">
          <div class="warmup-check">${isChecked ? '✓' : ''}</div>
          <span>${escapeHtml(text)}</span>
        </div>
      `;
    }).join('');

    warmupHtml = `
      <div class="warmup-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <div>
            <span class="badge badge-amber">🔥 Разминка (не идёт в статистику)</span>
          </div>
          <button class="btn btn-secondary btn-sm" data-action="open-warmup-editor">✎ Настроить</button>
        </div>
        <div style="margin-bottom:10px;">
          ${itemsListHtml}
        </div>
        <button class="btn btn-amber btn-block btn-sm" data-action="toggle-warmup-done">
          ✓ Разминка выполнена — свернуть блок
        </button>
      </div>
    `;
  }

  // 2. Карточки упражнений
  const exercisesHtml = active.exercises.map((exBlock, exIdx) => {
    const eqInfo = EQUIPMENT_TYPES[exBlock.equipmentUsed] || EQUIPMENT_TYPES.matrix;
    const allSetsDone = exBlock.sets.length > 0 && exBlock.sets.every((s) => s.isCompleted);

    const setsHtml = exBlock.sets.map((s, sIdx) => {
      return renderSingleSetRow(exBlock, exIdx, s, sIdx, eqInfo);
    }).join('');

    return `
      <div class="exercise-card ${allSetsDone ? 'all-done' : ''}">
        <div class="ex-header">
          <div style="flex:1;">
            <h3 class="ex-title">${exIdx + 1}. ${escapeHtml(exBlock.name)}</h3>
            <div class="ex-meta-row">
              <button class="equipment-chip" data-action="open-equipment-Modal" data-ex-index="${exIdx}" title="Сменить снаряд или угол наклона/хват">
                ⚙️ ${escapeHtml(eqInfo.shortLabel)} ▾
              </button>
              <button class="equipment-chip" data-action="open-equipment-Modal" data-ex-index="${exIdx}" title="Угол скамьи / хват / вариация">
                📐 ${escapeHtml(exBlock.angleVariant || 'Угол / Хват')} ▾
              </button>
              <span class="badge badge-neutral">${exBlock.sets.length} × ${escapeHtml(exBlock.repRange)}</span>
            </div>
          </div>
          <div style="display:flex; gap:5px;">
            <button class="btn btn-secondary btn-sm" data-action="open-swap-exercise" data-ex-index="${exIdx}" title="Заменить упражнение">
              ⇄
            </button>
            <button class="btn btn-secondary btn-sm" data-action="open-exercise-history" data-exercise-id="${exBlock.exerciseId}" title="График прогрессии">
              📈
            </button>
          </div>
        </div>

        ${
          exBlock.prevSummaryText
            ? `<div class="prev-banner">
                 <span>⏮ ${escapeHtml(exBlock.prevSummaryText)}</span>
                 ${active.isDeload ? `<span class="badge badge-amber">Разгрузка</span>` : ''}
               </div>`
            : ''
        }

        <div class="seat-note-bar" data-action="edit-seat-note" data-ex-index="${exIdx}">
          <span>🪑 Настройка / заметка: <strong>${escapeHtml(exBlock.seatSettings || 'Нажми, чтобы записать сиденье в SKIBIDI')}</strong></span>
          <span>✎</span>
        </div>

        <div class="sets-list">
          ${setsHtml}
        </div>

        <div style="display:flex; justify-content:space-between; gap:8px; margin-top:10px;">
          <button class="btn btn-secondary btn-sm" style="flex:1;" data-action="remove-set" data-ex-index="${exIdx}">
            − Убрать подход
          </button>
          <button class="btn btn-secondary btn-sm" style="flex:1;" data-action="add-set" data-ex-index="${exIdx}">
            + Добавить подход
          </button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="card" style="padding:12px 14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="badge badge-emerald">Идёт тренировка</span>
            ${active.isDeload ? `<span class="badge badge-amber">Разгрузка</span>` : ''}
          </div>
          <h2 style="margin:4px 0 0 0; font-size:18px; font-weight:800;">${escapeHtml(active.routineName)}</h2>
        </div>
        <div style="text-align:right;">
          <div style="font-size:12px; color:var(--text-muted);">Выполнено</div>
          <div style="font-size:18px; font-weight:900; color:var(--accent-emerald);">${doneSets} / ${totalSets}</div>
        </div>
      </div>
    </div>

    ${warmupHtml}

    ${exercisesHtml}

    <div class="card" style="display:flex; flex-direction:column; gap:10px;">
      <button class="btn btn-secondary btn-block" data-action="open-add-exercise-to-workout">
        + Добавить упражнение в текущую тренировку
      </button>

      <button class="btn btn-primary btn-block" data-action="finish-workout">
        🏁 Завершить и сохранить тренировку (${doneSets} подх.)
      </button>

      <button class="btn btn-danger btn-block btn-sm" data-action="cancel-workout">
        ✕ Отменить и сбросить тренировку
      </button>
    </div>
  `;
}

function renderSingleSetRow(exBlock, exIdx, s, sIdx, eqInfo) {
  const isCompleted = !!s.isCompleted;
  const totalWeight = roundWeightClean((Number(s.baseWeight) || 0) + (Number(s.addonWeight) || 0));

  // Режим 1: Упражнение на время (Планка)
  if (exBlock.isTimeBased) {
    const isPlankRunningHere =
      state.plankTimer.running &&
      state.plankTimer.exIndex === exIdx &&
      state.plankTimer.setIndex === sIdx;

    return `
      <div class="set-row ${isCompleted ? 'completed' : ''}">
        <div class="set-main-line">
          <div class="set-num">${sIdx + 1}</div>
          <div class="input-box">
            <label>Время (ММ:СС или сек)</label>
            <input
              type="text"
              class="gym-input"
              value="${escapeHtml(formatDurationMMSS(s.reps))}"
              data-action="set-input"
              data-field="reps"
              data-ex-index="${exIdx}"
              data-set-index="${sIdx}"
            />
          </div>
          <div class="input-box">
            <label>Секундомер</label>
            <button
              class="btn ${isPlankRunningHere ? 'btn-amber' : 'btn-secondary'} btn-block"
              style="height:48px; padding:0 8px; font-size:14px;"
              id="plank-live-${exIdx}-${sIdx}"
              data-action="toggle-plank-timer"
              data-ex-index="${exIdx}"
              data-set-index="${sIdx}"
            >
              ${isPlankRunningHere ? `⏹ Стоп (${formatDurationMMSS(state.plankTimer.elapsedSeconds)})` : '▶ Старт'}
            </button>
          </div>
          <button
            class="check-set-btn"
            data-action="toggle-set-done"
            data-ex-index="${exIdx}"
            data-set-index="${sIdx}"
            title="Подход выполнен"
          >
            ✓
          </button>
        </div>
      </div>
    `;
  }

  // Режим 2: Свой вес (Подтягивания на кол-во раз)
  if (eqInfo.isBodyweight) {
    return `
      <div class="set-row ${isCompleted ? 'completed' : ''}">
        <div class="set-main-line">
          <div class="set-num">${sIdx + 1}</div>
          <div class="input-box" style="flex:0.9;">
            <label>Доп. вес (кг)</label>
            <input
              type="text"
              inputmode="decimal"
              class="gym-input"
              placeholder="Свой вес"
              value="${s.baseWeight > 0 ? s.baseWeight : ''}"
              data-action="set-input"
              data-field="baseWeight"
              data-ex-index="${exIdx}"
              data-set-index="${sIdx}"
            />
          </div>
          <div class="input-box" style="flex:1.1;">
            <label>Повторения (раз)</label>
            <input
              type="number"
              inputmode="numeric"
              class="gym-input"
              value="${s.reps}"
              data-action="set-input"
              data-field="reps"
              data-ex-index="${exIdx}"
              data-set-index="${sIdx}"
            />
          </div>
          <button
            class="check-set-btn"
            data-action="toggle-set-done"
            data-ex-index="${exIdx}"
            data-set-index="${sIdx}"
          >
            ✓
          </button>
        </div>
      </div>
    `;
  }

  // Режим 3: Силовые подходы (Matrix / Блок с круговым регулятором +2.3 / +4.6, Штанга 20 кг, 2 Гантели в сумме, Своб. вес)
  let bottomHelperHtml = '';

  if (eqInfo.hasMatrixDial) {
    // Пункт 1 (Вариант А): Переключатель кругового регулятора Matrix [ 0 | +2.3 | +4.6 ]
    const curAddon = Number(s.addonWeight) || 0;
    bottomHelperHtml = `
      <div class="matrix-dial-row">
        <span class="matrix-dial-label" id="set-helper-${exIdx}-${sIdx}">
          Крутилка Matrix: <strong style="color:var(--text-main);">Итого ${totalWeight} кг</strong>
        </span>
        <div class="matrix-dial-group">
          <button class="dial-btn ${curAddon === 0 ? 'active' : ''}" data-action="set-addon" data-ex-index="${exIdx}" data-set-index="${sIdx}" data-addon="0">0</button>
          <button class="dial-btn ${curAddon === 2.3 ? 'active' : ''}" data-action="set-addon" data-ex-index="${exIdx}" data-set-index="${sIdx}" data-addon="2.3">+2.3</button>
          <button class="dial-btn ${curAddon === 4.6 ? 'active' : ''}" data-action="set-addon" data-ex-index="${exIdx}" data-set-index="${sIdx}" data-addon="4.6">+4.6</button>
        </div>
      </div>
    `;
  } else if (eqInfo.id === 'barbell') {
    // Помощник для штанги (стандартный гриф 20 кг)
    const perSide = totalWeight >= 20 ? roundWeightClean((totalWeight - 20) / 2) : 0;
    bottomHelperHtml = `
      <div class="helper-chips-row">
        <span id="set-helper-${exIdx}-${sIdx}">Гриф 20 кг ${perSide > 0 ? `+ блины по <strong>${perSide} кг</strong>/стор.` : '(пустой гриф)'}</span>
        <div style="display:flex; gap:4px;">
          <button class="quick-chip" data-action="quick-weight" data-ex-index="${exIdx}" data-set-index="${sIdx}" data-weight="20">20</button>
          <button class="quick-chip" data-action="quick-weight" data-ex-index="${exIdx}" data-set-index="${sIdx}" data-weight="30">30</button>
          <button class="quick-chip" data-action="quick-weight" data-ex-index="${exIdx}" data-set-index="${sIdx}" data-weight="40">40</button>
          <button class="quick-chip" data-action="quick-weight" data-ex-index="${exIdx}" data-set-index="${sIdx}" data-weight="50">50</button>
          <button class="quick-chip" data-action="quick-weight" data-ex-index="${exIdx}" data-set-index="${sIdx}" data-weight="60">60</button>
        </div>
      </div>
    `;
  } else if (eqInfo.id === 'dumbbell') {
    // Помощник для 2 гантелей (сумма двух гантелей)
    const eachDb = roundWeightClean(totalWeight / 2);
    bottomHelperHtml = `
      <div class="helper-chips-row">
        <span id="set-helper-${exIdx}-${sIdx}">Сумма 2 гантелей: <strong>по ${eachDb} кг</strong> в каждой руке</span>
        <div style="display:flex; gap:4px;">
          <button class="quick-chip" data-action="quick-weight" data-ex-index="${exIdx}" data-set-index="${sIdx}" data-weight="16">2×8=16</button>
          <button class="quick-chip" data-action="quick-weight" data-ex-index="${exIdx}" data-set-index="${sIdx}" data-weight="20">2×10=20</button>
          <button class="quick-chip" data-action="quick-weight" data-ex-index="${exIdx}" data-set-index="${sIdx}" data-weight="24">2×12=24</button>
          <button class="quick-chip" data-action="quick-weight" data-ex-index="${exIdx}" data-set-index="${sIdx}" data-weight="28">2×14=28</button>
        </div>
      </div>
    `;
  }

  const weightLabel = eqInfo.hasMatrixDial
    ? 'Плитка (кг)'
    : eqInfo.id === 'dumbbell'
      ? 'Сумма 2 гант. (кг)'
      : 'Вес (кг)';

  return `
    <div class="set-row ${isCompleted ? 'completed' : ''}">
      <div class="set-main-line">
        <div class="set-num">${sIdx + 1}</div>
        <div class="input-box">
          <label>${weightLabel}</label>
          <input
            type="text"
            inputmode="decimal"
            class="gym-input"
            value="${s.baseWeight}"
            data-action="set-input"
            data-field="baseWeight"
            data-ex-index="${exIdx}"
            data-set-index="${sIdx}"
          />
        </div>
        <div class="input-box">
          <label>Повторения</label>
          <input
            type="number"
            inputmode="numeric"
            class="gym-input"
            value="${s.reps}"
            data-action="set-input"
            data-field="reps"
            data-ex-index="${exIdx}"
            data-set-index="${sIdx}"
          />
        </div>
        <button
          class="check-set-btn"
          data-action="toggle-set-done"
          data-ex-index="${exIdx}"
          data-set-index="${sIdx}"
          title="Отметить подход выполненным"
        >
          ✓
        </button>
      </div>
      ${bottomHelperHtml}
    </div>
  `;
}

// === ВКЛАДКА 2: КАЛЕНДАРЬ И ИСТОРИЯ ТРЕНИРОВОК ===

function renderCalendarScreen() {
  const year = state.calendarYear;
  const month = state.calendarMonth;

  const monthNames = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];

  // Группируем тренировки по локальной дате YYYY-MM-DD
  const workoutsByDate = new Map();
  for (const w of state.workoutsHistory) {
    const key = toLocalDateKey(w.startedAt);
    if (!workoutsByDate.has(key)) workoutsByDate.set(key, []);
    workoutsByDate.get(key).push(w);
  }

  const firstDayOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Пн = 0 ... Вс = 6
  const startWeekday = (firstDayOfMonth.getDay() + 6) % 7;
  const todayKey = toLocalDateKey(new Date().toISOString());

  let cellsHtml = '';
  for (let i = 0; i < startWeekday; i++) {
    cellsHtml += `<div class="cal-day empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayWorkouts = workoutsByDate.get(dateKey) || [];
    const hasW = dayWorkouts.length > 0;
    const isToday = dateKey === todayKey;
    const isSelected = state.selectedCalendarDate === dateKey;

    const dots = dayWorkouts.map(() => `<span class="cal-dot"></span>`).join('');

    cellsHtml += `
      <div
        class="cal-day ${hasW ? 'has-workout' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}"
        data-action="select-cal-date"
        data-date="${dateKey}"
      >
        <span>${day}</span>
        ${hasW ? `<div class="cal-dot-row">${dots}</div>` : ''}
      </div>
    `;
  }

  // Список отображаемых тренировок (за выбранную дату или все последние)
  const listToRender = state.selectedCalendarDate
    ? (workoutsByDate.get(state.selectedCalendarDate) || [])
    : state.workoutsHistory;

  const historyCardsHtml = listToRender.length === 0
    ? `<div class="card" style="text-align:center; color:var(--text-muted);">
         ${state.selectedCalendarDate ? 'В выбранный день тренировок не было' : 'История тренировок пока пуста. Заверши первую тренировку!'}
       </div>`
    : listToRender.map((w) => renderWorkoutHistoryCard(w)).join('');

  return `
    <div class="card">
      <div class="calendar-header">
        <button class="btn btn-secondary btn-sm" data-action="cal-prev-month">◀</button>
        <div style="font-size:17px; font-weight:800;">${monthNames[month]} ${year}</div>
        <button class="btn btn-secondary btn-sm" data-action="cal-next-month">▶</button>
      </div>

      <div class="calendar-grid">
        <div class="cal-weekday">Пн</div>
        <div class="cal-weekday">Вт</div>
        <div class="cal-weekday">Ср</div>
        <div class="cal-weekday">Чт</div>
        <div class="cal-weekday">Пт</div>
        <div class="cal-weekday">Сб</div>
        <div class="cal-weekday">Вс</div>
        ${cellsHtml}
      </div>

      ${
        state.selectedCalendarDate
          ? `<div style="margin-top:12px; display:flex; justify-content:space-between; align-items:center;">
               <span style="font-size:13px; color:var(--text-muted);">Фильтр: ${state.selectedCalendarDate}</span>
               <button class="btn btn-secondary btn-sm" data-action="clear-cal-filter">Показать все (${state.workoutsHistory.length})</button>
             </div>`
          : ''
      }
    </div>

    <h3 style="margin:14px 4px 10px; font-size:16px; font-weight:800;">
      ${state.selectedCalendarDate ? 'Отчёт за выбранный день' : `История тренировок (${state.workoutsHistory.length})`}
    </h3>

    ${historyCardsHtml}
  `;
}

function renderWorkoutHistoryCard(w) {
  const durationMin = Math.max(1, Math.round((w.durationSeconds || 60) / 60));

  const exRowsHtml = (w.exercises || []).map((ex) => {
    const eqInfo = EQUIPMENT_TYPES[ex.equipmentUsed] || EQUIPMENT_TYPES.matrix;
    const angleTag = ex.angleVariant ? ` · 📐 ${escapeHtml(ex.angleVariant)}` : '';
    const setsPills = (ex.sets || []).map((s) => {
      if (ex.isTimeBased) {
        return `<span class="badge badge-neutral">${formatDurationMMSS(s.reps)}</span>`;
      }
      if (eqInfo.isBodyweight && (!s.weight || s.weight === 0)) {
        return `<span class="badge badge-neutral">${s.reps} раз</span>`;
      }
      const wLabel = s.addonWeight > 0 ? `${s.baseWeight}+${s.addonWeight}` : `${s.weight}`;
      return `<span class="badge badge-neutral">${wLabel} кг × ${s.reps}</span>`;
    }).join(' ');

    const startWeightNote =
      !ex.isTimeBased && ex.startingWeight > 0
        ? `<span style="font-size:11px; color:var(--accent-emerald);">Старт: ${ex.startingWeight} кг</span>`
        : '';

    return `
      <div style="padding:8px 0; border-top:1px solid rgba(255,255,255,0.06);">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; margin-bottom:4px;">
          <span style="font-size:14px; font-weight:700; cursor:pointer;" data-action="open-exercise-history" data-exercise-id="${ex.exerciseId}">
            ${escapeHtml(ex.name)} <span style="font-size:11px; color:var(--text-muted);">(${escapeHtml(eqInfo.shortLabel)}${angleTag}) 📈</span>
          </span>
          ${startWeightNote}
        </div>
        <div style="display:flex; flex-wrap:wrap; gap:5px;">
          ${setsPills}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
        <div>
          <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
            <span class="badge badge-emerald">${escapeHtml(w.routineName)}</span>
            ${w.isDeload ? `<span class="badge badge-amber">Разгрузка</span>` : ''}
          </div>
          <div style="font-size:12px; color:var(--text-muted);">
            📅 ${formatDateTimeRu(w.startedAt)} · ⏱ ${durationMin} мин · 🏋️ ${w.totalVolumeKg || 0} кг
          </div>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-secondary btn-sm" data-action="open-edit-history-workout" data-workout-id="${w.id}" title="Редактировать веса, повторения и углы в статистике">✎ Изм.</button>
          <button class="btn btn-danger btn-sm" data-action="delete-history-workout" data-workout-id="${w.id}" title="Удалить запись">🗑</button>
        </div>
      </div>
      ${exRowsHtml}
    </div>
  `;
}

// === ВКЛАДКА 3: ПРОГРЕССИЯ ВЕСОВ И БАЗА УПРАЖНЕНИЙ SKIBIDI ===

function renderExercisesAndProgressScreen() {
  const filterTabs = ['Все', ...MUSCLE_GROUPS];
  const filterPillsHtml = filterTabs.map((m) => `
    <button
      class="btn ${state.muscleFilter === m ? 'btn-primary' : 'btn-secondary'} btn-sm"
      data-action="set-muscle-filter"
      data-muscle="${m}"
    >
      ${escapeHtml(m)}
    </button>
  `).join('');

  const filteredExercises = state.muscleFilter === 'Все'
    ? state.exercises
    : state.exercises.filter((e) => e.muscleGroup === state.muscleFilter);

  const listHtml = filteredExercises.map((ex) => {
    const eqInfo = EQUIPMENT_TYPES[ex.defaultEquipment] || EQUIPMENT_TYPES.matrix;
    const initTotal = roundWeightClean((ex.initialBaseWeight || 0) + (ex.initialAddonWeight || 0));

    return `
      <div class="card" style="padding:14px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
          <div style="flex:1; cursor:pointer;" data-action="open-exercise-history" data-exercise-id="${ex.id}">
            <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
              <span class="badge badge-blue">${escapeHtml(ex.muscleGroup)}</span>
              <span class="badge badge-neutral">${escapeHtml(eqInfo.shortLabel)}</span>
            </div>
            <h3 style="margin:0 0 4px 0; font-size:16px; font-weight:800;">${escapeHtml(ex.name)}</h3>
            <div style="font-size:12px; color:var(--text-muted);">
              🪑 ${escapeHtml(ex.seatSettings || 'Без заметки')}
            </div>
            <div style="font-size:12px; color:var(--accent-emerald); margin-top:4px; font-weight:700;">
              ${ex.isTimeBased ? `Ориентир: ${formatDurationMMSS(ex.initialReps)}` : initTotal > 0 ? `Базовый вес: ${formatMatrixWeightLabel(ex.initialBaseWeight, ex.initialAddonWeight, initTotal)}` : 'Собственный вес'} · Посмотреть график 📈
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" data-action="open-edit-exercise" data-exercise-id="${ex.id}">✎</button>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <div>
          <h2 style="margin:0; font-size:18px; font-weight:800;">Справочник SKIBIDI и Прогрессия</h2>
          <p style="margin:2px 0 0 0; font-size:12px; color:var(--text-muted);">Нажми на упражнение для графика роста весов</p>
        </div>
        <button class="btn btn-primary btn-sm" data-action="open-new-exercise">+ Новое</button>
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:6px;">
        ${filterPillsHtml}
      </div>
    </div>

    ${listHtml}
  `;
}

// === ВКЛАДКА 4: БЭКАП (JSON + SUPABASE) И НАСТРОЙКИ ===

function renderSettingsAndBackupScreen() {
  const s = state.settings;
  const syncTimeText = s.lastCloudSyncAt
    ? formatDateTimeRu(s.lastCloudSyncAt)
    : 'Ещё не синхронизировалось';

  return `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <h2 style="margin:0; font-size:18px; font-weight:800;">☁️ Облако Supabase (Бесплатно)</h2>
        <span class="badge ${s.supabaseUrl && s.supabaseAnonKey ? 'badge-emerald' : 'badge-neutral'}">
          ${s.supabaseUrl && s.supabaseAnonKey ? 'Подключено' : 'Не задано'}
        </span>
      </div>
      <p style="margin:0 0 12px 0; font-size:13px; color:var(--text-muted);">
        Защита от очистки кэша браузера: вся база тренировок автоматически дублируется в твой бесплатный проект Supabase.
      </p>

      <div class="form-group">
        <label>Supabase Project URL</label>
        <input
          type="url"
          id="input-supabase-url"
          class="text-input"
          placeholder="https://xxxxxxxxxxxx.supabase.co"
          value="${escapeHtml(s.supabaseUrl || '')}"
        />
      </div>

      <div class="form-group">
        <label>Supabase Anon Public Key</label>
        <input
          type="password"
          id="input-supabase-key"
          class="text-input"
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
          value="${escapeHtml(s.supabaseAnonKey || '')}"
        />
      </div>

      <div class="toggle-row" data-action="toggle-setting" data-key="supabaseAutoSync" style="margin-bottom:12px;">
        <div>
          <div style="font-size:14px; font-weight:700;">Авто-бэкап в Supabase после тренировки</div>
          <div style="font-size:12px; color:var(--text-muted);">Последняя синхр.: ${syncTimeText}</div>
        </div>
        <div class="switch emerald ${s.supabaseAutoSync ? 'on' : ''}"></div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">
        <button class="btn btn-primary btn-sm" data-action="supabase-push">☁️ Выгрузить в облако</button>
        <button class="btn btn-secondary btn-sm" data-action="supabase-pull">⬇️ Скачать из облака</button>
      </div>

      <button class="btn btn-secondary btn-block btn-sm" data-action="open-supabase-sql-modal">
        📋 Показать SQL-код создания таблицы в Supabase (1 раз)
      </button>
    </div>

    <div class="card">
      <h2 style="margin:0 0 6px 0; font-size:18px; font-weight:800;">📦 Локальный Экспорт / Импорт (JSON)</h2>
      <p style="margin:0 0 12px 0; font-size:13px; color:var(--text-muted);">
        Хранилище в браузере: <strong>${state.storageStatus.persisted ? 'Защищено от автоочистки ОС' : 'Стандартное IndexedDB'}</strong> (${state.storageStatus.usageMB} МБ).
      </p>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px;">
        <button class="btn btn-primary btn-sm" data-action="export-json-file">💾 Скачать JSON</button>
        <button class="btn btn-secondary btn-sm" data-action="share-json-file">📤 Поделиться (TG)</button>
      </div>

      <label class="btn btn-secondary btn-block btn-sm" style="cursor:pointer;">
        📂 Восстановить базу из файла JSON
        <input type="file" id="import-json-input" accept=".json,application/json" style="display:none;" />
      </label>
    </div>

    <div class="card">
      <h2 style="margin:0 0 10px 0; font-size:18px; font-weight:800;">⏱ Таймер отдыха и сигналы</h2>

      <div class="form-group">
        <label>Время отдыха по умолчанию (сек)</label>
        <div style="display:flex; gap:8px;">
          ${[45, 60, 90, 120].map((sec) => `
            <button
              class="btn ${Number(s.restTimerSeconds) === sec ? 'btn-primary' : 'btn-secondary'} btn-sm"
              style="flex:1;"
              data-action="set-default-rest"
              data-sec="${sec}"
            >
              ${sec}с
            </button>
          `).join('')}
        </div>
      </div>

      <div class="toggle-row" data-action="toggle-setting" data-key="endSoundEnabled">
        <div>
          <div style="font-size:14px; font-weight:700;">Звуковой сигнал ТОЛЬКО в конце отдыха</div>
          <div style="font-size:12px; color:var(--text-muted);">Без звуков во время тренировки (не глушит музыку)</div>
        </div>
        <div class="switch emerald ${s.endSoundEnabled ? 'on' : ''}"></div>
      </div>

      <div class="toggle-row" data-action="toggle-setting" data-key="vibrationEnabled">
        <div>
          <div style="font-size:14px; font-weight:700;">Вибрация по окончании отдыха</div>
          <div style="font-size:12px; color:var(--text-muted);">Виброотклик телефона при 00:00</div>
        </div>
        <div class="switch emerald ${s.vibrationEnabled ? 'on' : ''}"></div>
      </div>

      <div class="toggle-row" data-action="toggle-setting" data-key="wakeLockEnabled">
        <div>
          <div style="font-size:14px; font-weight:700;">Не гасить экран на активной тренировке</div>
          <div style="font-size:12px; color:var(--text-muted);">Screen Wake Lock API для Vivo X300</div>
        </div>
        <div class="switch emerald ${s.wakeLockEnabled ? 'on' : ''}"></div>
      </div>
    </div>
  `;
}

// === МОДАЛЬНЫЕ ОКНА ===

function renderModal() {
  if (!state.modal) return '';
  const { type, data } = state.modal;

  // 1. Быстрая смена снаряда И угла наклона / хвата в упражнении
  if (type === 'equipment_switcher') {
    const exBlock = state.activeWorkout?.exercises?.[data.exIndex];
    if (!exBlock) return '';

    const currentAngle = exBlock.angleVariant || '';

    const anglePillsHtml = ANGLE_PRESETS.map((a) => {
      const active = currentAngle === a.id;
      return `
        <button
          class="btn ${active ? 'btn-primary' : 'btn-secondary'} btn-sm"
          data-action="select-angle-for-active"
          data-ex-index="${data.exIndex}"
          data-angle="${escapeHtml(a.id)}"
        >
          ${escapeHtml(a.id || 'Стандарт')}
        </button>
      `;
    }).join('');

    const optionsHtml = Object.values(EQUIPMENT_TYPES).map((eq) => {
      const isSelected = exBlock.equipmentUsed === eq.id;
      return `
        <div
          class="card ${isSelected ? 'card-recommended' : ''}"
          style="padding:11px; margin-bottom:8px; cursor:pointer;"
          data-action="select-equipment-for-active"
          data-ex-index="${data.exIndex}"
          data-eq-id="${eq.id}"
        >
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="font-size:15px;">${escapeHtml(eq.label)}</strong>
            ${isSelected ? `<span class="badge badge-emerald">Выбрано</span>` : ''}
          </div>
          <div style="font-size:12px; color:var(--text-muted); margin-top:3px;">${escapeHtml(eq.hint)}</div>
        </div>
      `;
    }).join('');

    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-sheet">
          <div class="modal-header">
            <h3>Снаряд и Угол: ${escapeHtml(exBlock.name)}</h3>
            <button class="btn btn-secondary btn-sm" data-action="close-modal">✕</button>
          </div>

          <div style="margin-bottom:14px; padding-bottom:12px; border-bottom:1px solid var(--border-subtle);">
            <div style="font-size:12px; font-weight:700; color:var(--text-muted); margin-bottom:6px; text-transform:uppercase;">
              📐 Угол скамьи / Хват / Вариант (учитывается в статистике и весах)
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px;">
              ${anglePillsHtml}
            </div>
            <div style="display:flex; gap:6px;">
              <input
                type="text"
                id="custom-angle-input"
                class="text-input"
                style="min-height:38px; padding:6px 10px; font-size:13px;"
                placeholder="Или свой угол/хват (напр. 30° верх груди)"
                value="${escapeHtml(currentAngle)}"
              />
              <button class="btn btn-primary btn-sm" data-action="save-custom-angle-active" data-ex-index="${data.exIndex}">Применить</button>
            </div>
          </div>

          <div style="font-size:12px; font-weight:700; color:var(--text-muted); margin-bottom:6px; text-transform:uppercase;">
            ⚙️ Тип снаряда
          </div>
          ${optionsHtml}
        </div>
      </div>
    `;
  }

  // 1Б. Редактирование сохранённой тренировки в статистике / истории
  if (type === 'edit_history_workout') {
    const w = data.workout;
    if (!w) return '';

    const exBlocksHtml = (w.exercises || []).map((ex, exIdx) => {
      const eqInfo = EQUIPMENT_TYPES[ex.equipmentUsed] || EQUIPMENT_TYPES.matrix;
      const setsRowsHtml = (ex.sets || []).map((s, sIdx) => `
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:6px; background:var(--bg-input); padding:6px 8px; border-radius:10px;">
          <span style="font-size:12px; font-weight:800; width:22px; color:var(--text-muted);">#${sIdx + 1}</span>
          ${
            ex.isTimeBased
              ? `<div style="flex:1;">
                   <label style="font-size:10px; color:var(--text-muted); display:block;">Время (сек)</label>
                   <input type="number" class="text-input hist-set-input" style="min-height:34px; padding:4px 8px;" data-ex-idx="${exIdx}" data-set-idx="${sIdx}" data-field="reps" value="${s.reps}" />
                 </div>`
              : `<div style="flex:1;">
                   <label style="font-size:10px; color:var(--text-muted); display:block;">Плитка/Вес (кг)</label>
                   <input type="number" step="0.1" class="text-input hist-set-input" style="min-height:34px; padding:4px 8px;" data-ex-idx="${exIdx}" data-set-idx="${sIdx}" data-field="baseWeight" value="${s.baseWeight ?? s.weight ?? 0}" />
                 </div>
                 <div style="width:76px;">
                   <label style="font-size:10px; color:var(--text-muted); display:block;">Довесок</label>
                   <select class="select-input hist-set-input" style="min-height:34px; padding:4px;" data-ex-idx="${exIdx}" data-set-idx="${sIdx}" data-field="addonWeight">
                     <option value="0" ${Number(s.addonWeight) === 0 ? 'selected' : ''}>0</option>
                     <option value="2.3" ${Number(s.addonWeight) === 2.3 ? 'selected' : ''}>+2.3</option>
                     <option value="4.6" ${Number(s.addonWeight) === 4.6 ? 'selected' : ''}>+4.6</option>
                   </select>
                 </div>
                 <div style="width:74px;">
                   <label style="font-size:10px; color:var(--text-muted); display:block;">Повтор.</label>
                   <input type="number" class="text-input hist-set-input" style="min-height:34px; padding:4px 8px;" data-ex-idx="${exIdx}" data-set-idx="${sIdx}" data-field="reps" value="${s.reps}" />
                 </div>`
          }
          <button class="btn btn-danger btn-sm" style="margin-top:14px; padding:4px 8px; min-height:34px;" data-action="hist-remove-set" data-ex-idx="${exIdx}" data-set-idx="${sIdx}">✕</button>
        </div>
      `).join('');

      return `
        <div style="background:var(--bg-elevated); border:1px solid var(--border-subtle); border-radius:14px; padding:10px; margin-bottom:10px;">
          <div style="font-weight:800; font-size:14px; margin-bottom:6px;">${exIdx + 1}. ${escapeHtml(ex.name)}</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px;">
            <div>
              <label style="font-size:10px; color:var(--text-muted);">Снаряд</label>
              <select class="select-input hist-ex-meta" style="min-height:34px; padding:4px 8px; font-size:12px;" data-ex-idx="${exIdx}" data-field="equipmentUsed">
                ${Object.values(EQUIPMENT_TYPES).map((eq) => `<option value="${eq.id}" ${ex.equipmentUsed === eq.id ? 'selected' : ''}>${eq.shortLabel}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:10px; color:var(--text-muted);">Угол / Хват</label>
              <input type="text" class="text-input hist-ex-meta" style="min-height:34px; padding:4px 8px; font-size:12px;" data-ex-idx="${exIdx}" data-field="angleVariant" placeholder="Напр. 30°" value="${escapeHtml(ex.angleVariant || '')}" />
            </div>
          </div>
          ${setsRowsHtml}
          <button class="btn btn-secondary btn-sm btn-block" data-action="hist-add-set" data-ex-idx="${exIdx}">+ Добавить подход</button>
        </div>
      `;
    }).join('');

    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-sheet">
          <div class="modal-header">
            <h3>✎ Правка статистики (${formatDateRu(w.startedAt)})</h3>
            <button class="btn btn-secondary btn-sm" data-action="close-modal">✕</button>
          </div>
          <p style="font-size:12px; color:var(--text-muted); margin-top:0;">
            Здесь можно исправить любые веса, повторения, довески Matrix, снаряд или угол скамьи в уже сохранённой тренировке:
          </p>
          ${exBlocksHtml}
          <button class="btn btn-primary btn-block" data-action="save-edited-history-workout">
            💾 Сохранить изменения в статистике
          </button>
        </div>
      </div>
    `;
  }

  // 2. График прогрессии и история по упражнению
  if (type === 'exercise_history') {
    const ex = state.exercises.find((e) => e.id === data.exerciseId);
    const sessions = data.sessions || [];
    const title = ex ? ex.name : 'История упражнения';

    let chartSvg = '';
    if (sessions.length >= 1) {
      const pts = sessions.slice(-10);
      const values = pts.map((p) => (ex?.isTimeBased ? p.maxReps : p.maxWeight));
      const minV = Math.min(...values);
      const maxV = Math.max(...values, minV + 5);
      const w = 320;
      const h = 120;

      const coords = pts.map((p, idx) => {
        const x = pts.length === 1 ? w / 2 : 24 + (idx / (pts.length - 1)) * (w - 48);
        const val = ex?.isTimeBased ? p.maxReps : p.maxWeight;
        const y = h - 24 - ((val - minV) / Math.max(1, maxV - minV)) * (h - 52);
        return { x, y, val, date: formatDateRu(p.date) };
      });

      const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
      const circlesHtml = coords.map((c) => `
        <circle cx="${c.x}" cy="${c.y}" r="5" fill="#10b981" />
        <text x="${c.x}" y="${c.y - 10}" fill="#f4f4f6" font-size="10" font-weight="700" text-anchor="middle">
          ${ex?.isTimeBased ? formatDurationMMSS(c.val) : `${c.val}кг`}
        </text>
      `).join('');

      chartSvg = `
        <div style="background:var(--bg-elevated); border-radius:14px; padding:10px; margin-bottom:12px;">
          <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px; font-weight:700;">
            Динамика роста (${ex?.isTimeBased ? 'время' : 'рабочий вес, кг'})
          </div>
          <svg viewBox="0 0 ${w} ${h}" style="width:100%; height:130px; overflow:visible;">
            <polyline fill="none" stroke="#10b981" stroke-width="3" points="${polylinePoints}" />
            ${circlesHtml}
          </svg>
        </div>
      `;
    }

    const rowsHtml = sessions.length === 0
      ? `<p style="color:var(--text-muted); text-align:center;">По этому упражнению пока нет сохранённых тренировок.</p>`
      : [...sessions].reverse().map((sess) => {
          const eqInfo = EQUIPMENT_TYPES[sess.equipmentUsed] || EQUIPMENT_TYPES.matrix;
          const angleInfo = sess.angleVariant ? ` · 📐 ${escapeHtml(sess.angleVariant)}` : '';
          const setsStr = sess.sets.map((s) =>
            ex?.isTimeBased
              ? formatDurationMMSS(s.reps)
              : `${s.addonWeight > 0 ? `${s.baseWeight}+${s.addonWeight}` : s.weight}кг × ${s.reps}`
          ).join(' · ');

          return `
            <div style="padding:9px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
              <div style="display:flex; justify-content:space-between; font-size:13px; font-weight:700;">
                <span>${formatDateRu(sess.date)} (${escapeHtml(eqInfo.shortLabel)}${angleInfo})</span>
                <span style="color:var(--accent-emerald);">
                  ${ex?.isTimeBased ? `Макс: ${formatDurationMMSS(sess.maxReps)}` : `Старт: ${sess.startingWeight} кг | Макс: ${sess.maxWeight} кг`}
                </span>
              </div>
              <div style="font-size:12px; color:var(--text-muted); margin-top:3px;">${setsStr}</div>
            </div>
          `;
        }).join('');

    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-sheet">
          <div class="modal-header">
            <h3>📈 ${escapeHtml(title)}</h3>
            <button class="btn btn-secondary btn-sm" data-action="close-modal">✕</button>
          </div>
          ${chartSvg}
          <div>${rowsHtml}</div>
        </div>
      </div>
    `;
  }

  // 3. Редактор Настраиваемой Разминки
  if (type === 'warmup_editor') {
    const upperText = (state.warmupConfig.upper || []).join('\n');
    const lowerText = (state.warmupConfig.lower || []).join('\n');

    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-sheet">
          <div class="modal-header">
            <h3>🔥 Настройка разминки</h3>
            <button class="btn btn-secondary btn-sm" data-action="close-modal">✕</button>
          </div>
          <p style="font-size:12px; color:var(--text-muted); margin-top:0;">
            Каждый пункт с новой строки. Разминка отображается в начале тренировки и не записывается в силовую статистику.
          </p>
          <div class="form-group">
            <label>Разминка для дней ВЕРХ А / ВЕРХ Б</label>
            <textarea id="warmup-upper-input" class="text-input" rows="4">${escapeHtml(upperText)}</textarea>
          </div>
          <div class="form-group">
            <label>Разминка для дня НИЗ + КОР</label>
            <textarea id="warmup-lower-input" class="text-input" rows="4">${escapeHtml(lowerText)}</textarea>
          </div>
          <button class="btn btn-primary btn-block" data-action="save-warmup-config">Сохранить разминку</button>
        </div>
      </div>
    `;
  }

  // 4. Создание / Редактирование упражнения в справочнике SKIBIDI
  if (type === 'edit_exercise') {
    const ex = data.exercise || {
      id: `ex_custom_${Date.now()}`,
      name: '',
      muscleGroup: 'Грудь',
      defaultEquipment: 'matrix',
      defaultAngle: '',
      isTimeBased: false,
      defaultSets: 3,
      repRange: '8–10',
      seatSettings: '',
      initialBaseWeight: 20,
      initialAddonWeight: 0,
      initialReps: 10
    };

    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-sheet">
          <div class="modal-header">
            <h3>${data.isNew ? 'Новое упражнение SKIBIDI' : 'Редактировать упражнение'}</h3>
            <button class="btn btn-secondary btn-sm" data-action="close-modal">✕</button>
          </div>

          <input type="hidden" id="edit-ex-id" value="${escapeHtml(ex.id)}" />
          <input type="hidden" id="edit-ex-add-to-active" value="${data.addToActive ? '1' : '0'}" />

          <div class="form-group">
            <label>Название упражнения / тренажёра (можно указать угол)</label>
            <input type="text" id="edit-ex-name" class="text-input" value="${escapeHtml(ex.name)}" placeholder="Напр. Жим гантелей на наклонной 30°" />
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <div class="form-group">
              <label>Мышечная группа</label>
              <select id="edit-ex-muscle" class="select-input">
                ${MUSCLE_GROUPS.map((m) => `<option value="${m}" ${ex.muscleGroup === m ? 'selected' : ''}>${m}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Основной снаряд</label>
              <select id="edit-ex-eq" class="select-input">
                ${Object.values(EQUIPMENT_TYPES).map((eq) => `<option value="${eq.id}" ${ex.defaultEquipment === eq.id ? 'selected' : ''}>${eq.label}</option>`).join('')}
              </select>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <div class="form-group">
              <label>Угол / Хват по умолчанию</label>
              <input type="text" id="edit-ex-angle" class="text-input" value="${escapeHtml(ex.defaultAngle || '')}" placeholder="Напр. 30° (Верх груди)" />
            </div>
            <div class="form-group">
              <label>Стартовый рабочий вес (кг)</label>
              <input type="number" step="0.1" id="edit-ex-weight" class="text-input" value="${ex.initialBaseWeight ?? 20}" />
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
            <div class="form-group">
              <label>Целевой диапазон повторений</label>
              <input type="text" id="edit-ex-reprange" class="text-input" value="${escapeHtml(ex.repRange || '8–10')}" />
            </div>
            <div class="form-group">
              <label>Настройки сиденья / заметка</label>
              <input type="text" id="edit-ex-seat" class="text-input" value="${escapeHtml(ex.seatSettings || '')}" placeholder="Сиденье 4, угол 30°" />
            </div>
          </div>

          ${
            !data.isNew
              ? `<button class="btn btn-secondary btn-block btn-sm" style="margin-bottom:8px;" data-action="clone-exercise-variant" data-exercise-id="${ex.id}">
                   ➕ Дублировать как отдельное упражнение под другой угол/хват
                 </button>`
              : ''
          }

          <div style="display:flex; gap:8px; margin-top:8px;">
            ${!data.isNew ? `<button class="btn btn-danger" data-action="delete-exercise-confirm" data-exercise-id="${ex.id}">🗑</button>` : ''}
            <button class="btn btn-primary btn-block" data-action="save-exercise-form">
              ${data.addToActive ? 'Сохранить и добавить в тренировку' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // 5. Редактирование шаблона дня (Добавление / удаление упражнений из Дня 1, 2, 3)
  if (type === 'edit_routine') {
    const routine = state.routines.find((r) => r.id === data.routineId);
    if (!routine) return '';
    const exMap = new Map(state.exercises.map((e) => [e.id, e]));

    const currentItemsHtml = routine.items.map((item, idx) => {
      const ex = exMap.get(item.exerciseId);
      if (!ex) return '';
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; padding:8px; background:var(--bg-elevated); border-radius:10px; margin-bottom:6px;">
          <div style="font-size:13px; font-weight:700; flex:1;">
            ${idx + 1}. ${escapeHtml(ex.name)} (${item.sets} × ${escapeHtml(item.repRange)})
          </div>
          <div style="display:flex; gap:4px;">
            ${idx > 0 ? `<button class="btn btn-secondary btn-sm" data-action="routine-move-up" data-routine-id="${routine.id}" data-idx="${idx}">↑</button>` : ''}
            <button class="btn btn-danger btn-sm" data-action="routine-remove-item" data-routine-id="${routine.id}" data-idx="${idx}">✕</button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-sheet">
          <div class="modal-header">
            <h3>Шаблон: ${escapeHtml(routine.name)}</h3>
            <button class="btn btn-secondary btn-sm" data-action="close-modal">✕</button>
          </div>

          <div style="margin-bottom:14px;">
            ${currentItemsHtml}
          </div>

          <div style="border-top:1px solid var(--border-subtle); padding-top:12px;">
            <div class="form-group">
              <label>Добавить упражнение в этот день</label>
              <select id="routine-add-ex-select" class="select-input">
                ${state.exercises.map((e) => `<option value="${e.id}">${escapeHtml(e.name)} (${e.muscleGroup})</option>`).join('')}
              </select>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
              <div class="form-group">
                <label>Кол-во подходов</label>
                <input type="number" id="routine-add-sets" class="text-input" value="3" />
              </div>
              <div class="form-group">
                <label>Повторения</label>
                <input type="text" id="routine-add-reps" class="text-input" value="8–10" />
              </div>
            </div>
            <button class="btn btn-primary btn-block btn-sm" data-action="routine-add-item" data-routine-id="${routine.id}">
              + Добавить в шаблон
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // 6. Добавление или замена упражнения прямо во время активной тренировки
  if (type === 'add_exercise_to_active') {
    const isSwap = data && typeof data.swapIndex === 'number';
    const listHtml = state.exercises.map((ex) => `
      <div
        class="card"
        style="padding:11px; margin-bottom:8px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;"
        data-action="pick-exercise-for-active"
        data-exercise-id="${ex.id}"
        data-swap-index="${isSwap ? data.swapIndex : ''}"
      >
        <div>
          <div style="font-weight:800; font-size:14px;">${escapeHtml(ex.name)}</div>
          <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(ex.muscleGroup)} · ${escapeHtml((EQUIPMENT_TYPES[ex.defaultEquipment] || EQUIPMENT_TYPES.matrix).shortLabel)}${ex.defaultAngle ? ` · 📐 ${escapeHtml(ex.defaultAngle)}` : ''}</div>
        </div>
        <span class="badge badge-emerald">${isSwap ? '⇄ Заменить' : '+ Добавить'}</span>
      </div>
    `).join('');

    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-sheet">
          <div class="modal-header">
            <h3>${isSwap ? 'Заменить упражнение' : 'Добавить упражнение в тренировку'}</h3>
            <button class="btn btn-secondary btn-sm" data-action="close-modal">✕</button>
          </div>
          <button class="btn btn-primary btn-block btn-sm" style="margin-bottom:12px;" data-action="open-new-exercise-from-active">
            + Создать новое упражнение вручную (с углом/мышцей)
          </button>
          ${listHtml}
        </div>
      </div>
    `;
  }

  // 7. SQL-инструкция для Supabase
  if (type === 'supabase_sql') {
    return `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <div class="modal-sheet">
          <div class="modal-header">
            <h3>Настройка бесплатного Supabase</h3>
            <button class="btn btn-secondary btn-sm" data-action="close-modal">✕</button>
          </div>
          <ol style="font-size:13px; color:var(--text-muted); padding-left:18px; margin-top:0;">
            <li>Зайди на <strong>supabase.com</strong> и создай бесплатный проект.</li>
            <li>Открой вкладку <strong>SQL Editor</strong>, вставь этот код и нажми <strong>Run</strong>:</li>
          </ol>
          <div class="code-block">${escapeHtml(SUPABASE_SQL_SNIPPET)}</div>
          <button class="btn btn-primary btn-block" style="margin-top:12px;" data-action="copy-supabase-sql">
            📋 Скопировать SQL-код
          </button>
        </div>
      </div>
    `;
  }

  return '';
}

// === ОБРАБОТЧИКИ СОБЫТИЙ ===

function attachEventListeners() {
  const root = document.getElementById('app-root');
  if (!root) return;

  // Ввод текста в поля подходов (без полной перерисовки DOM, чтобы не терялся фокус клавиатуры на телефоне!)
  root.addEventListener('input', async (e) => {
    const target = e.target;
    if (target.dataset.action === 'set-input') {
      const exIdx = Number(target.dataset.exIndex);
      const setIdx = Number(target.dataset.setIndex);
      const field = target.dataset.field;
      await updateSetField(exIdx, setIdx, field, target.value);

      // Если изменили вес в текущем подходе — обновляем значения в DOM у следующих незавершённых подходов и плашку Итого
      if (field === 'baseWeight' && state.activeWorkout) {
        const exBlock = state.activeWorkout.exercises[exIdx];
        if (exBlock) {
          const eqInfo = EQUIPMENT_TYPES[exBlock.equipmentUsed] || EQUIPMENT_TYPES.matrix;
          exBlock.sets.forEach((s, idx) => {
            if (idx > setIdx && !s.isCompleted) {
              const otherInput = root.querySelector(
                `input[data-action="set-input"][data-field="baseWeight"][data-ex-index="${exIdx}"][data-set-index="${idx}"]`
              );
              if (otherInput) otherInput.value = s.baseWeight;
            }
            if (idx >= setIdx && (idx === setIdx || !s.isCompleted)) {
              const helperEl = document.getElementById(`set-helper-${exIdx}-${idx}`);
              if (helperEl) {
                const tot = roundWeightClean((Number(s.baseWeight) || 0) + (Number(s.addonWeight) || 0));
                if (eqInfo.hasMatrixDial) {
                  helperEl.innerHTML = `Крутилка Matrix: <strong style="color:var(--text-main);">Итого ${tot} кг</strong>`;
                } else if (eqInfo.id === 'barbell') {
                  const perSide = tot >= 20 ? roundWeightClean((tot - 20) / 2) : 0;
                  helperEl.innerHTML = `Гриф 20 кг ${perSide > 0 ? `+ блины по <strong>${perSide} кг</strong>/стор.` : '(пустой гриф)'}`;
                } else if (eqInfo.id === 'dumbbell') {
                  const eachDb = roundWeightClean(tot / 2);
                  helperEl.innerHTML = `Сумма 2 гантелей: <strong>по ${eachDb} кг</strong> в каждой руке`;
                }
              }
            }
          });
        }
      }
    }

    // Правка полей в модалке редактирования истории
    if (target.classList.contains('hist-set-input') && state.modal?.type === 'edit_history_workout') {
      const w = state.modal.data.workout;
      const exIdx = Number(target.dataset.exIdx);
      const sIdx = Number(target.dataset.setIdx);
      const field = target.dataset.field;
      const s = w?.exercises?.[exIdx]?.sets?.[sIdx];
      if (s) {
        s[field] = parseFloat(target.value) || 0;
        s.weight = roundWeightClean((Number(s.baseWeight) || 0) + (Number(s.addonWeight) || 0));
      }
    }
    if (target.classList.contains('hist-ex-meta') && state.modal?.type === 'edit_history_workout') {
      const w = state.modal.data.workout;
      const exIdx = Number(target.dataset.exIdx);
      const field = target.dataset.field;
      const ex = w?.exercises?.[exIdx];
      if (ex) {
        ex[field] = target.value;
      }
    }

    // Сохранение полей Supabase на лету
    if (target.id === 'input-supabase-url') {
      state.settings.supabaseUrl = target.value.trim();
      await setAppState('settings', state.settings);
    }
    if (target.id === 'input-supabase-key') {
      state.settings.supabaseAnonKey = target.value.trim();
      await setAppState('settings', state.settings);
    }
  });

  // Импорт файла JSON
  root.addEventListener('change', async (e) => {
    const target = e.target;
    if (target.id === 'import-json-input' && target.files && target.files[0]) {
      try {
        const text = await target.files[0].text();
        const json = JSON.parse(text);
        await importFullDatabase(json);
        await reloadAllData();
        showToast('База данных успешно восстановлена из файла!');
        renderApp();
      } catch (err) {
        showToast(`Ошибка импорта: ${err.message}`, true);
      }
    }
  });

  // Клики по кнопкам
  root.addEventListener('click', async (e) => {
    // Переключение нижних вкладок
    const navBtn = e.target.closest('.nav-item');
    if (navBtn && navBtn.dataset.tab) {
      state.activeTab = navBtn.dataset.tab;
      renderApp();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;

    switch (action) {
      case 'close-modal':
        state.modal = null;
        renderApp();
        break;

      case 'close-modal-backdrop':
        if (e.target === actionEl) {
          state.modal = null;
          renderApp();
        }
        break;

      case 'toggle-deload-mode': {
        const current = isCurrentDeloadActive();
        state.cycleState.manualDeloadOverride = !current;
        await setAppState('cycle_state', state.cycleState);
        renderApp();
        break;
      }

      case 'cycle-step-next': {
        state.cycleState.currentStep = ((state.cycleState.currentStep || 0) + 1) % FOUR_WEEK_CYCLE.length;
        state.cycleState.manualDeloadOverride = null;
        await setAppState('cycle_state', state.cycleState);
        renderApp();
        break;
      }

      case 'set-cycle-week': {
        const weekNum = Number(actionEl.dataset.week) || 1;
        const firstStepOfWeek = FOUR_WEEK_CYCLE.find((c) => c.week === weekNum);
        if (firstStepOfWeek) {
          state.cycleState.currentStep = firstStepOfWeek.step;
          state.cycleState.manualDeloadOverride = null;
          await setAppState('cycle_state', state.cycleState);
          renderApp();
        }
        break;
      }

      case 'start-workout': {
        const routineId = actionEl.dataset.routineId;
        await startWorkoutFromRoutine(routineId);
        break;
      }

      case 'toggle-warmup-item': {
        if (!state.activeWorkout) break;
        const idx = Number(actionEl.dataset.idx);
        const arr = state.activeWorkout.warmupCheckedIndices || [];
        if (arr.includes(idx)) {
          state.activeWorkout.warmupCheckedIndices = arr.filter((i) => i !== idx);
        } else {
          state.activeWorkout.warmupCheckedIndices = [...arr, idx];
        }
        await saveActiveWorkout(state.activeWorkout);
        renderApp();
        break;
      }

      case 'toggle-warmup-done': {
        if (!state.activeWorkout) break;
        state.activeWorkout.warmupCompleted = !state.activeWorkout.warmupCompleted;
        await saveActiveWorkout(state.activeWorkout);
        renderApp();
        break;
      }

      case 'open-warmup-editor': {
        state.modal = { type: 'warmup_editor' };
        renderApp();
        break;
      }

      case 'save-warmup-config': {
        const uEl = document.getElementById('warmup-upper-input');
        const lEl = document.getElementById('warmup-lower-input');
        if (uEl && lEl) {
          state.warmupConfig = {
            upper: uEl.value.split('\n').map((s) => s.trim()).filter(Boolean),
            lower: lEl.value.split('\n').map((s) => s.trim()).filter(Boolean)
          };
          await setAppState('warmup_config', state.warmupConfig);
          state.modal = null;
          showToast('Чек-лист разминки сохранён');
          renderApp();
        }
        break;
      }

      case 'set-addon': {
        const exIdx = Number(actionEl.dataset.exIndex);
        const setIdx = Number(actionEl.dataset.setIndex);
        const addon = Number(actionEl.dataset.addon);
        await updateSetField(exIdx, setIdx, 'addonWeight', addon);
        renderApp();
        break;
      }

      case 'quick-weight': {
        const exIdx = Number(actionEl.dataset.exIndex);
        const setIdx = Number(actionEl.dataset.setIndex);
        const weight = Number(actionEl.dataset.weight);
        await updateSetField(exIdx, setIdx, 'baseWeight', weight);
        renderApp();
        break;
      }

      case 'toggle-set-done': {
        const exIdx = Number(actionEl.dataset.exIndex);
        const setIdx = Number(actionEl.dataset.setIndex);
        await toggleSetCompleted(exIdx, setIdx);
        break;
      }

      case 'toggle-plank-timer': {
        const exIdx = Number(actionEl.dataset.exIndex);
        const setIdx = Number(actionEl.dataset.setIndex);
        togglePlankStopwatch(exIdx, setIdx);
        break;
      }

      case 'add-set': {
        if (!state.activeWorkout) break;
        const exIdx = Number(actionEl.dataset.exIndex);
        const exBlock = state.activeWorkout.exercises[exIdx];
        if (exBlock) {
          const lastSet = exBlock.sets[exBlock.sets.length - 1] || { baseWeight: 20, addonWeight: 0, weight: 20, reps: 10 };
          exBlock.sets.push({
            setNumber: exBlock.sets.length + 1,
            baseWeight: lastSet.baseWeight,
            addonWeight: lastSet.addonWeight,
            weight: lastSet.weight,
            reps: lastSet.reps,
            isCompleted: false,
            completedAt: null
          });
          await saveActiveWorkout(state.activeWorkout);
          renderApp();
        }
        break;
      }

      case 'remove-set': {
        if (!state.activeWorkout) break;
        const exIdx = Number(actionEl.dataset.exIndex);
        const exBlock = state.activeWorkout.exercises[exIdx];
        if (exBlock && exBlock.sets.length > 1) {
          exBlock.sets.pop();
          await saveActiveWorkout(state.activeWorkout);
          renderApp();
        }
        break;
      }

      case 'edit-seat-note': {
        if (!state.activeWorkout) break;
        const exIdx = Number(actionEl.dataset.exIndex);
        const exBlock = state.activeWorkout.exercises[exIdx];
        if (!exBlock) break;
        const nextNote = window.prompt(`Настройка тренажёра / заметка для «${exBlock.name}»:`, exBlock.seatSettings || '');
        if (nextNote !== null) {
          exBlock.seatSettings = nextNote.trim();
          await saveActiveWorkout(state.activeWorkout);
          // Также сохраняем в справочник упражнений
          const catalogEx = state.exercises.find((e) => e.id === exBlock.exerciseId);
          if (catalogEx) {
            catalogEx.seatSettings = exBlock.seatSettings;
            await saveExercise(catalogEx);
          }
          renderApp();
        }
        break;
      }

      case 'open-equipment-Modal': {
        const exIndex = Number(actionEl.dataset.exIndex);
        state.modal = { type: 'equipment_switcher', data: { exIndex } };
        renderApp();
        break;
      }

      case 'select-equipment-for-active': {
        if (!state.activeWorkout) break;
        const exIndex = Number(actionEl.dataset.exIndex);
        const eqId = actionEl.dataset.eqId;
        const exBlock = state.activeWorkout.exercises[exIndex];
        const catalogEx = state.exercises.find((e) => e.id === exBlock?.exerciseId);

        if (exBlock && catalogEx) {
          exBlock.equipmentUsed = eqId;
          const prefill = await getExercisePrefill(
            catalogEx,
            eqId,
            state.activeWorkout.isDeload,
            state.settings.deloadPercent || 18,
            exBlock.angleVariant || ''
          );
          exBlock.prevSummaryText = prefill.prevSummaryText;

          // Обновляем ещё не выполненные подходы под выбранный снаряд
          for (const s of exBlock.sets) {
            if (!s.isCompleted) {
              s.baseWeight = prefill.baseWeight;
              s.addonWeight = prefill.addonWeight;
              s.weight = prefill.weight;
            }
          }
          await saveActiveWorkout(state.activeWorkout);
          state.modal = null;
          showToast(`Снаряд изменён: ${EQUIPMENT_TYPES[eqId]?.label || eqId}`);
          renderApp();
        }
        break;
      }

      case 'select-angle-for-active':
      case 'save-custom-angle-active': {
        if (!state.activeWorkout) break;
        const exIndex = Number(actionEl.dataset.exIndex);
        const angleVal =
          action === 'save-custom-angle-active'
            ? (document.getElementById('custom-angle-input')?.value?.trim() || '')
            : (actionEl.dataset.angle || '');
        const exBlock = state.activeWorkout.exercises[exIndex];
        const catalogEx = state.exercises.find((e) => e.id === exBlock?.exerciseId);

        if (exBlock && catalogEx) {
          exBlock.angleVariant = angleVal;
          const prefill = await getExercisePrefill(
            catalogEx,
            exBlock.equipmentUsed,
            state.activeWorkout.isDeload,
            state.settings.deloadPercent || 18,
            angleVal
          );
          exBlock.prevSummaryText = prefill.prevSummaryText;
          for (const s of exBlock.sets) {
            if (!s.isCompleted) {
              s.baseWeight = prefill.baseWeight;
              s.addonWeight = prefill.addonWeight;
              s.weight = prefill.weight;
            }
          }
          await saveActiveWorkout(state.activeWorkout);
          state.modal = null;
          showToast(angleVal ? `Угол/хват: ${angleVal}` : 'Установлен стандартный угол');
          renderApp();
        }
        break;
      }

      case 'open-swap-exercise': {
        const swapIndex = Number(actionEl.dataset.exIndex);
        state.modal = { type: 'add_exercise_to_active', data: { swapIndex } };
        renderApp();
        break;
      }

      case 'open-new-exercise-from-active': {
        state.modal = { type: 'edit_exercise', data: { isNew: true, addToActive: true } };
        renderApp();
        break;
      }

      case 'open-add-exercise-to-workout': {
        state.modal = { type: 'add_exercise_to_active', data: {} };
        renderApp();
        break;
      }

      case 'pick-exercise-for-active': {
        if (!state.activeWorkout) break;
        const exId = actionEl.dataset.exerciseId;
        const swapRaw = actionEl.dataset.swapIndex;
        const ex = state.exercises.find((e) => e.id === exId);
        if (ex) {
          const prefill = await getExercisePrefill(
            ex,
            ex.defaultEquipment,
            state.activeWorkout.isDeload,
            state.settings.deloadPercent || 18,
            ex.defaultAngle || ''
          );
          const count = state.activeWorkout.isDeload ? Math.max(1, (ex.defaultSets || 3) - 1) : (ex.defaultSets || 3);
          const sets = [];
          for (let i = 0; i < count; i++) {
            sets.push({
              setNumber: i + 1,
              baseWeight: prefill.baseWeight,
              addonWeight: prefill.addonWeight,
              weight: prefill.weight,
              reps: prefill.reps,
              isCompleted: false,
              completedAt: null
            });
          }
          const newBlock = {
            exerciseId: ex.id,
            name: ex.name,
            muscleGroup: ex.muscleGroup,
            equipmentUsed: ex.defaultEquipment || 'matrix',
            angleVariant: ex.defaultAngle || '',
            isTimeBased: !!ex.isTimeBased,
            repRange: ex.repRange || '8–10',
            seatSettings: ex.seatSettings || '',
            prevSummaryText: prefill.prevSummaryText,
            sets
          };
          if (swapRaw !== undefined && swapRaw !== '') {
            state.activeWorkout.exercises[Number(swapRaw)] = newBlock;
            showToast(`Заменено на: ${ex.name}`);
          } else {
            state.activeWorkout.exercises.push(newBlock);
            showToast(`Добавлено: ${ex.name}`);
          }
          await saveActiveWorkout(state.activeWorkout);
          state.modal = null;
          renderApp();
        }
        break;
      }

      case 'rest-adjust': {
        const delta = Number(actionEl.dataset.delta) || 0;
        await adjustRestTimer(delta);
        break;
      }

      case 'rest-cancel': {
        await cancelRestTimer();
        break;
      }

      case 'finish-workout': {
        if (!state.activeWorkout) break;
        const doneCount = state.activeWorkout.exercises.reduce(
          (acc, ex) => acc + ex.sets.filter((s) => s.isCompleted).length,
          0
        );
        if (doneCount === 0) {
          showToast('Отметь хотя бы один выполненный подход (✓) перед сохранением!', true);
          break;
        }
        await finishAndSaveWorkout(state.activeWorkout);
        await releaseWakeLock();
        await reloadAllData();
        showToast('Тренировка сохранена в историю! 💪');

        // Автосинхронизация с Supabase, если настроено
        if (state.settings.supabaseAutoSync && state.settings.supabaseUrl && state.settings.supabaseAnonKey) {
          pushToSupabase()
            .then(() => showToast('Облачный бэкап Supabase обновлён ☁️'))
            .catch(() => {});
        }

        state.activeTab = 'calendar';
        renderApp();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
      }

      case 'cancel-workout': {
        if (window.confirm('Точно сбросить текущую тренировку без сохранения?')) {
          await saveActiveWorkout(null);
          await releaseWakeLock();
          state.activeWorkout = null;
          renderApp();
        }
        break;
      }

      case 'cal-prev-month': {
        state.calendarMonth--;
        if (state.calendarMonth < 0) {
          state.calendarMonth = 11;
          state.calendarYear--;
        }
        renderApp();
        break;
      }

      case 'cal-next-month': {
        state.calendarMonth++;
        if (state.calendarMonth > 11) {
          state.calendarMonth = 0;
          state.calendarYear++;
        }
        renderApp();
        break;
      }

      case 'select-cal-date': {
        const d = actionEl.dataset.date;
        state.selectedCalendarDate = state.selectedCalendarDate === d ? null : d;
        renderApp();
        break;
      }

      case 'clear-cal-filter': {
        state.selectedCalendarDate = null;
        renderApp();
        break;
      }

      case 'open-edit-history-workout': {
        const wId = actionEl.dataset.workoutId;
        const orig = state.workoutsHistory.find((w) => w.id === wId);
        if (orig) {
          const clone = JSON.parse(JSON.stringify(orig));
          state.modal = { type: 'edit_history_workout', data: { workout: clone } };
          renderApp();
        }
        break;
      }

      case 'hist-add-set': {
        const w = state.modal?.data?.workout;
        const exIdx = Number(actionEl.dataset.exIdx);
        const ex = w?.exercises?.[exIdx];
        if (ex) {
          const last = ex.sets[ex.sets.length - 1] || { baseWeight: 20, addonWeight: 0, weight: 20, reps: 10 };
          ex.sets.push({
            setNumber: ex.sets.length + 1,
            baseWeight: last.baseWeight ?? last.weight ?? 20,
            addonWeight: last.addonWeight ?? 0,
            weight: last.weight ?? 20,
            reps: last.reps ?? 10,
            isCompleted: true
          });
          renderApp();
        }
        break;
      }

      case 'hist-remove-set': {
        const w = state.modal?.data?.workout;
        const exIdx = Number(actionEl.dataset.exIdx);
        const sIdx = Number(actionEl.dataset.setIdx);
        const ex = w?.exercises?.[exIdx];
        if (ex && ex.sets) {
          ex.sets.splice(sIdx, 1);
          renderApp();
        }
        break;
      }

      case 'save-edited-history-workout': {
        const w = state.modal?.data?.workout;
        if (w) {
          await updateWorkoutInHistory(w);
          await reloadAllData();
          state.modal = null;
          showToast('Статистика тренировки успешно обновлена!');
          renderApp();
        }
        break;
      }

      case 'delete-history-workout': {
        const wId = actionEl.dataset.workoutId;
        if (window.confirm('Удалить эту тренировку из истории?')) {
          await deleteWorkoutFromHistory(wId);
          await reloadAllData();
          showToast('Запись удалена');
          renderApp();
        }
        break;
      }

      case 'open-exercise-history': {
        const exId = actionEl.dataset.exerciseId;
        const sessions = await getExerciseProgressionHistory(exId);
        state.modal = { type: 'exercise_history', data: { exerciseId: exId, sessions } };
        renderApp();
        break;
      }

      case 'set-muscle-filter': {
        state.muscleFilter = actionEl.dataset.muscle || 'Все';
        renderApp();
        break;
      }

      case 'open-new-exercise': {
        state.modal = { type: 'edit_exercise', data: { isNew: true } };
        renderApp();
        break;
      }

      case 'open-edit-exercise': {
        const exId = actionEl.dataset.exerciseId;
        const exercise = state.exercises.find((e) => e.id === exId);
        if (exercise) {
          state.modal = { type: 'edit_exercise', data: { isNew: false, exercise } };
          renderApp();
        }
        break;
      }

      case 'clone-exercise-variant': {
        const exId = actionEl.dataset.exerciseId;
        const orig = state.exercises.find((e) => e.id === exId);
        if (orig) {
          const cloned = {
            ...orig,
            id: `ex_custom_${Date.now()}`,
            name: `${orig.name} (Наклон 30°)`,
            defaultAngle: '30° (Верх груди)'
          };
          state.modal = { type: 'edit_exercise', data: { isNew: true, exercise: cloned } };
          showToast('Укажи нужный угол/название и нажми Сохранить');
          renderApp();
        }
        break;
      }

      case 'save-exercise-form': {
        const id = document.getElementById('edit-ex-id')?.value;
        const addToActive = document.getElementById('edit-ex-add-to-active')?.value === '1';
        const name = document.getElementById('edit-ex-name')?.value?.trim();
        const muscleGroup = document.getElementById('edit-ex-muscle')?.value || 'Грудь';
        const defaultEquipment = document.getElementById('edit-ex-eq')?.value || 'matrix';
        const defaultAngle = document.getElementById('edit-ex-angle')?.value?.trim() || '';
        const repRange = document.getElementById('edit-ex-reprange')?.value?.trim() || '8–10';
        const initialBaseWeight = parseFloat(document.getElementById('edit-ex-weight')?.value) || 0;
        const seatSettings = document.getElementById('edit-ex-seat')?.value?.trim() || '';

        if (!name) {
          showToast('Введи название упражнения', true);
          break;
        }

        const existing = state.exercises.find((e) => e.id === id) || {};
        const updated = {
          ...existing,
          id,
          name,
          muscleGroup,
          defaultEquipment,
          defaultAngle,
          repRange,
          initialBaseWeight,
          initialAddonWeight: existing.initialAddonWeight || 0,
          initialReps: existing.initialReps || 10,
          defaultSets: existing.defaultSets || 3,
          isTimeBased: existing.isTimeBased || false,
          seatSettings
        };

        await saveExercise(updated);
        await reloadAllData();

        if (addToActive && state.activeWorkout) {
          const count = state.activeWorkout.isDeload ? Math.max(1, (updated.defaultSets || 3) - 1) : (updated.defaultSets || 3);
          const sets = [];
          for (let i = 0; i < count; i++) {
            sets.push({
              setNumber: i + 1,
              baseWeight: updated.initialBaseWeight,
              addonWeight: 0,
              weight: updated.initialBaseWeight,
              reps: updated.initialReps || 10,
              isCompleted: false,
              completedAt: null
            });
          }
          state.activeWorkout.exercises.push({
            exerciseId: updated.id,
            name: updated.name,
            muscleGroup: updated.muscleGroup,
            equipmentUsed: updated.defaultEquipment,
            angleVariant: updated.defaultAngle || '',
            isTimeBased: !!updated.isTimeBased,
            repRange: updated.repRange,
            seatSettings: updated.seatSettings || '',
            prevSummaryText: `Базовый вес: ${updated.initialBaseWeight} кг`,
            sets
          });
          await saveActiveWorkout(state.activeWorkout);
        }

        state.modal = null;
        showToast(addToActive ? 'Упражнение создано и добавлено в тренировку!' : 'Упражнение сохранено');
        renderApp();
        break;
      }

      case 'delete-exercise-confirm': {
        const exId = actionEl.dataset.exerciseId;
        if (window.confirm('Удалить упражнение из справочника?')) {
          await deleteExercise(exId);
          await reloadAllData();
          state.modal = null;
          renderApp();
        }
        break;
      }

      case 'edit-routine': {
        const routineId = actionEl.dataset.routineId;
        state.modal = { type: 'edit_routine', data: { routineId } };
        renderApp();
        break;
      }

      case 'routine-remove-item': {
        const routineId = actionEl.dataset.routineId;
        const idx = Number(actionEl.dataset.idx);
        const routine = state.routines.find((r) => r.id === routineId);
        if (routine) {
          routine.items.splice(idx, 1);
          await saveRoutine(routine);
          await reloadAllData();
          renderApp();
        }
        break;
      }

      case 'routine-move-up': {
        const routineId = actionEl.dataset.routineId;
        const idx = Number(actionEl.dataset.idx);
        const routine = state.routines.find((r) => r.id === routineId);
        if (routine && idx > 0) {
          const tmp = routine.items[idx - 1];
          routine.items[idx - 1] = routine.items[idx];
          routine.items[idx] = tmp;
          await saveRoutine(routine);
          await reloadAllData();
          renderApp();
        }
        break;
      }

      case 'routine-add-item': {
        const routineId = actionEl.dataset.routineId;
        const routine = state.routines.find((r) => r.id === routineId);
        const exId = document.getElementById('routine-add-ex-select')?.value;
        const sets = parseInt(document.getElementById('routine-add-sets')?.value, 10) || 3;
        const repRange = document.getElementById('routine-add-reps')?.value?.trim() || '8–10';

        if (routine && exId) {
          routine.items.push({ exerciseId: exId, sets, repRange });
          await saveRoutine(routine);
          await reloadAllData();
          showToast('Упражнение добавлено в день');
          renderApp();
        }
        break;
      }

      case 'set-default-rest': {
        const sec = Number(actionEl.dataset.sec) || 60;
        state.settings.restTimerSeconds = sec;
        await setAppState('settings', state.settings);
        showToast(`Таймер по умолчанию: ${sec} сек`);
        renderApp();
        break;
      }

      case 'toggle-setting': {
        const key = actionEl.dataset.key;
        if (key) {
          state.settings[key] = !state.settings[key];
          await setAppState('settings', state.settings);
          renderApp();
        }
        break;
      }

      case 'export-json-file': {
        const payload = await exportFullDatabase();
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = toLocalDateKey(new Date().toISOString());
        a.href = url;
        a.download = `skibidi_gym_backup_${dateStr}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Файл бэкапа сохранён!');
        break;
      }

      case 'share-json-file': {
        const payload = await exportFullDatabase();
        const jsonStr = JSON.stringify(payload, null, 2);
        const dateStr = toLocalDateKey(new Date().toISOString());
        const fileName = `skibidi_gym_backup_${dateStr}.json`;

        if (navigator.share) {
          try {
            const file = new File([jsonStr], fileName, { type: 'application/json' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
              await navigator.share({
                title: 'SKIBIDI Gym Backup',
                text: `Бэкап тренировок SKIBIDI от ${dateStr}`,
                files: [file]
              });
              break;
            }
          } catch {
            // fallback
          }
        }
        // Fallback: скачивание файла
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Файл бэкапа скачан');
        break;
      }

      case 'supabase-push': {
        try {
          const url = document.getElementById('input-supabase-url')?.value?.trim();
          const key = document.getElementById('input-supabase-key')?.value?.trim();
          state.settings.supabaseUrl = url;
          state.settings.supabaseAnonKey = key;
          await setAppState('settings', state.settings);

          showToast('Выгружаем базу в Supabase...');
          await pushToSupabase(url, key);
          await reloadAllData();
          showToast('База успешно сохранена в облаке Supabase! ☁️');
          renderApp();
        } catch (err) {
          showToast(err.message, true);
        }
        break;
      }

      case 'supabase-pull': {
        try {
          const url = document.getElementById('input-supabase-url')?.value?.trim();
          const key = document.getElementById('input-supabase-key')?.value?.trim();
          if (!window.confirm('Заменить локальные данные копией из облака Supabase?')) break;

          showToast('Загружаем базу из Supabase...');
          await pullFromSupabase(url, key);
          await reloadAllData();
          showToast('База успешно восстановлена из Supabase! ✅');
          renderApp();
        } catch (err) {
          showToast(err.message, true);
        }
        break;
      }

      case 'open-supabase-sql-modal': {
        state.modal = { type: 'supabase_sql' };
        renderApp();
        break;
      }

      case 'copy-supabase-sql': {
        if (navigator.clipboard) {
          await navigator.clipboard.writeText(SUPABASE_SQL_SNIPPET);
          showToast('SQL-код скопирован в буфер обмена!');
        }
        break;
      }

      case 'install-pwa': {
        if (state.deferredInstallPrompt) {
          state.deferredInstallPrompt.prompt();
          const choice = await state.deferredInstallPrompt.userChoice.catch(() => null);
          if (choice && choice.outcome === 'accepted') {
            state.deferredInstallPrompt = null;
          }
          renderApp();
        }
        break;
      }
    }
  });
}

// === ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ===

// Перехват события установки PWA (Chrome / Edge на Android)
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  state.deferredInstallPrompt = e;
  renderApp();
});

window.addEventListener('appinstalled', () => {
  state.deferredInstallPrompt = null;
  showToast('Приложение установлено на главный экран! 🎉');
  renderApp();
});

async function bootstrap() {
  // Сразу регистрируем Service Worker (до любых async-ожиданий!), чтобы браузер разрешил установку PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  await initDatabase();
  await reloadAllData();

  attachEventListeners();

  // Если при открытии приложения обнаружена незавершённая тренировка — сразу восстанавливаем Wake Lock
  if (state.activeWorkout && state.settings.wakeLockEnabled) {
    acquireWakeLock();
  }

  // Перезахват Wake Lock и пересчёт таймера при возврате в браузер (visibilitychange)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (state.activeWorkout && state.settings.wakeLockEnabled) {
        acquireWakeLock();
      }
      renderRestTimerBarOnly();
    }
  });

  // Запускаем фоновый цикл проверки таймера отдыха (по разнице системного времени endTime - Date.now())
  startRestTimerLoop(
    () => state.activeWorkout,
    (remainingSec, totalSec) => {
      const valEl = document.getElementById('rest-countdown-val');
      const fillEl = document.getElementById('rest-progress-fill');
      if (valEl && fillEl) {
        valEl.textContent = formatDurationMMSS(remainingSec);
        const pct = Math.min(100, Math.max(0, (remainingSec / Math.max(1, totalSec)) * 100));
        fillEl.style.width = `${pct}%`;
      } else {
        renderRestTimerBarOnly();
      }
    },
    async () => {
      // Таймер отдыха дошёл до 00:00! Подаём вибросигнал и мягкий сигнал завершения
      if (state.activeWorkout && state.activeWorkout.restTimer) {
        state.activeWorkout.restTimer = null;
        await saveActiveWorkout(state.activeWorkout);
        triggerRestFinishedAlert({
          soundEnabled: state.settings.endSoundEnabled,
          vibrationEnabled: state.settings.vibrationEnabled
        });
        showToast('Отдых завершён! Пора делать подход 💪');
        renderRestTimerBarOnly();
      }
    }
  );

  renderApp();
}

bootstrap();
