import {
  INITIAL_EXERCISES,
  INITIAL_ROUTINES,
  DEFAULT_WARMUP_CONFIG,
  FOUR_WEEK_CYCLE
} from './data.js';

const DB_NAME = 'ddx_gym_db_v1';
const DB_VERSION = 1;
const ACTIVE_MIRROR_KEY = 'ddx_active_workout_mirror_v1';

let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('exercises')) {
        db.createObjectStore('exercises', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('routines')) {
        db.createObjectStore('routines', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('workouts_history')) {
        const wStore = db.createObjectStore('workouts_history', { keyPath: 'id' });
        wStore.createIndex('startedAt', 'startedAt', { unique: false });
        wStore.createIndex('routineId', 'routineId', { unique: false });
      }
      if (!db.objectStoreNames.contains('workout_sets')) {
        const sStore = db.createObjectStore('workout_sets', { keyPath: 'id' });
        sStore.createIndex('workoutId', 'workoutId', { unique: false });
        sStore.createIndex('exerciseId', 'exerciseId', { unique: false });
        sStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('app_state')) {
        db.createObjectStore('app_state', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

async function txGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function txGet(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function txPut(storeName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function txDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function txClear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const req = store.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    try {
      const isPersisted = await navigator.storage.persisted();
      if (isPersisted) return true;
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

export async function checkStorageStatus() {
  let persisted = false;
  let usageMB = 0;
  if (navigator.storage) {
    try {
      if (navigator.storage.persisted) {
        persisted = await navigator.storage.persisted();
      }
      if (navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (est.usage) {
          usageMB = +(est.usage / (1024 * 1024)).toFixed(2);
        }
      }
    } catch {
      // ignore
    }
  }
  return { persisted, usageMB };
}

export async function initDatabase() {
  await openDB();
  await requestPersistentStorage();

  const existingExercises = await txGetAll('exercises');
  if (existingExercises.length === 0) {
    for (const ex of INITIAL_EXERCISES) {
      await txPut('exercises', ex);
    }
  }

  const existingRoutines = await txGetAll('routines');
  if (existingRoutines.length === 0) {
    for (const r of INITIAL_ROUTINES) {
      await txPut('routines', r);
    }
  }

  const warmupState = await getAppState('warmup_config');
  if (!warmupState) {
    await setAppState('warmup_config', DEFAULT_WARMUP_CONFIG);
  }

  const cycleState = await getAppState('cycle_state');
  if (!cycleState) {
    await setAppState('cycle_state', {
      currentStep: 0, // 0..11 в 4-недельном цикле
      manualDeloadOverride: null
    });
  }

  const settings = await getAppState('settings');
  if (!settings) {
    await setAppState('settings', {
      restTimerSeconds: 60,
      endSoundEnabled: true,
      vibrationEnabled: true,
      wakeLockEnabled: true,
      deloadPercent: 18, // 18% снижение веса (между 15% и 20%)
      supabaseUrl: '',
      supabaseAnonKey: '',
      supabaseAutoSync: true,
      lastCloudSyncAt: null
    });
  }
}

export async function getAppState(key) {
  const rec = await txGet('app_state', key);
  return rec ? rec.value : null;
}

export async function setAppState(key, value) {
  return txPut('app_state', { key, value, updatedAt: new Date().toISOString() });
}

// === АКТИВНАЯ ТРЕНИРОВКА (ЗАЩИТА ОТ ПОТЕРИ СЕССИИ) ===

export async function getActiveWorkout() {
  // Сначала проверяем синхронное зеркало в localStorage (на случай экстренного закрытия вкладки)
  let mirror = null;
  try {
    const raw = localStorage.getItem(ACTIVE_MIRROR_KEY);
    if (raw) mirror = JSON.parse(raw);
  } catch {
    mirror = null;
  }

  const idbActive = await getAppState('active_workout');

  if (mirror && idbActive) {
    return (mirror.updatedAt || 0) >= (idbActive.updatedAt || 0) ? mirror : idbActive;
  }
  return mirror || idbActive || null;
}

export async function saveActiveWorkout(workoutState) {
  if (!workoutState) {
    try {
      localStorage.removeItem(ACTIVE_MIRROR_KEY);
    } catch {
      // ignore
    }
    await txDelete('app_state', 'active_workout');
    return;
  }
  workoutState.updatedAt = Date.now();
  try {
    localStorage.setItem(ACTIVE_MIRROR_KEY, JSON.stringify(workoutState));
  } catch {
    // ignore quota errors
  }
  await setAppState('active_workout', workoutState);
}

// === СПРАВОЧНИК УПРАЖНЕНИЙ И ШАБЛОНОВ ===

export async function getAllExercises() {
  return txGetAll('exercises');
}

export async function saveExercise(exercise) {
  return txPut('exercises', exercise);
}

export async function deleteExercise(exerciseId) {
  return txDelete('exercises', exerciseId);
}

export async function getAllRoutines() {
  const list = await txGetAll('routines');
  const order = { day1_upper_a: 1, day2_lower: 2, day3_upper_b: 3 };
  return list.sort((a, b) => (order[a.id] || 99) - (order[b.id] || 99));
}

export async function saveRoutine(routine) {
  return txPut('routines', routine);
}

// === УМНОЕ ПРЕДЗАПОЛНЕНИЕ ВЕСОВ И ИСТОРИЯ ===

export async function getAllWorkoutsHistory() {
  const list = await txGetAll('workouts_history');
  return list.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

export async function getAllWorkoutSets() {
  return txGetAll('workout_sets');
}

export function roundWeightClean(val) {
  return Math.round(val * 10) / 10;
}

/**
 * Возвращает данные последнего выполнения упражнения для предзаполнения.
 * Предпочитает последнюю НЕ разгрузочную тренировку (чтобы после разгрузки рабочие веса не терялись),
 * а также учитывает выбранный тип оборудования (если пользователь менял Matrix на гантели/штангу).
 */
export async function getExercisePrefill(exercise, equipmentType, isDeload, deloadPercent = 18, angleVariant = '') {
  const eq = equipmentType || exercise.defaultEquipment || 'matrix';
  const angle = String(angleVariant ?? exercise.defaultAngle ?? '').trim();
  const allWorkouts = await getAllWorkoutsHistory();
  const allSets = await getAllWorkoutSets();

  const workoutMap = new Map(allWorkouts.map((w) => [w.id, w]));

  // Находим все завершённые подходы по этому упражнению
  const exSets = allSets
    .filter((s) => s.exerciseId === exercise.id && s.isCompleted)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Группируем по тренировке
  const setsByWorkout = new Map();
  for (const s of exSets) {
    if (!setsByWorkout.has(s.workoutId)) {
      setsByWorkout.set(s.workoutId, []);
    }
    setsByWorkout.get(s.workoutId).push(s);
  }

  // 1. Сначала ищем последнюю НЕ разгрузочную тренировку с точно таким же снарядом И углом/хватом
  let matchedSets = null;
  let lastWorkoutDate = null;

  if (angle) {
    for (const [wId, wSets] of setsByWorkout.entries()) {
      const w = workoutMap.get(wId);
      if (w && !w.isDeload) {
        const sameEqAndAngle = wSets.filter(
          (s) => (s.equipmentUsed || exercise.defaultEquipment) === eq && String(s.angleVariant || '') === angle
        );
        if (sameEqAndAngle.length > 0) {
          matchedSets = sameEqAndAngle.sort((a, b) => a.setNumber - b.setNumber);
          lastWorkoutDate = w.startedAt;
          break;
        }
      }
    }
  }

  // 2. Ищем последнюю обычную (не Deload) тренировку с тем же оборудованием
  if (!matchedSets) {
    for (const [wId, wSets] of setsByWorkout.entries()) {
      const w = workoutMap.get(wId);
      if (w && !w.isDeload) {
        const sameEqSets = wSets.filter((s) => (s.equipmentUsed || exercise.defaultEquipment) === eq);
        if (sameEqSets.length > 0) {
          matchedSets = sameEqSets.sort((a, b) => a.setNumber - b.setNumber);
          lastWorkoutDate = w.startedAt;
          break;
        }
      }
    }
  }

  // Если не нашли с точно таким же снарядом без разгрузки — берём последнюю без разгрузки с любым снарядом (если снаряд дефолтный)
  if (!matchedSets && eq === exercise.defaultEquipment) {
    for (const [wId, wSets] of setsByWorkout.entries()) {
      const w = workoutMap.get(wId);
      if (w && !w.isDeload && wSets.length > 0) {
        matchedSets = wSets.sort((a, b) => a.setNumber - b.setNumber);
        lastWorkoutDate = w.startedAt;
        break;
      }
    }
  }

  // Если были только разгрузочные тренировки
  if (!matchedSets) {
    for (const [wId, wSets] of setsByWorkout.entries()) {
      const sameEqSets = wSets.filter((s) => (s.equipmentUsed || exercise.defaultEquipment) === eq);
      if (sameEqSets.length > 0) {
        matchedSets = sameEqSets.sort((a, b) => a.setNumber - b.setNumber);
        const w = workoutMap.get(wId);
        lastWorkoutDate = w ? w.startedAt : null;
        break;
      }
    }
  }

  // Базовые значения из справочника упражнений (если тренировок ещё не было)
  let baseWeight = exercise.initialBaseWeight ?? 20;
  let addonWeight = exercise.initialAddonWeight ?? 0;
  let reps = exercise.initialReps ?? 10;
  let prevSummaryText = null;

  if (matchedSets && matchedSets.length > 0) {
    // Согласно правилу: перед 1-м подходом встаёт вес с предыдущей тренировки (а в статистике хранится и начальный, и последний)
    const firstSet = matchedSets[0];
    const lastSet = matchedSets[matchedSets.length - 1];
    baseWeight = lastSet.baseWeight ?? lastSet.weight ?? 0;
    addonWeight = lastSet.addonWeight ?? 0;
    reps = lastSet.reps ?? exercise.initialReps ?? 10;

    if (exercise.isTimeBased) {
      prevSummaryText = `Прошлый раз: ${formatDurationMMSS(lastSet.reps)}`;
    } else if (eq === 'bodyweight') {
      prevSummaryText = `Прошлый раз: ${ matchedSets.map((s) => s.reps).join(' / ') } повт.`;
    } else {
      const startW = firstSet.weight;
      const endW = lastSet.weight;
      const weightDesc = startW !== endW ? `${startW}→${endW} кг` : formatMatrixWeightLabel(lastSet.baseWeight, lastSet.addonWeight, lastSet.weight);
      prevSummaryText = `Прошлый раз: ${weightDesc} × ${matchedSets.map((s) => s.reps).join('/')}`;
    }
  } else {
    // Стартовые веса из программы пользователя
    if (eq !== exercise.defaultEquipment) {
      if (eq === 'barbell') baseWeight = 20;
      else if (eq === 'dumbbell') baseWeight = 16;
      else if (eq === 'bodyweight') baseWeight = 0;
      addonWeight = 0;
    }
    const totalInit = roundWeightClean(baseWeight + addonWeight);
    if (exercise.isTimeBased) {
      prevSummaryText = `Ориентир: ${formatDurationMMSS(reps)}`;
    } else if (eq === 'bodyweight') {
      prevSummaryText = `Ориентир: ${exercise.repRange} повт.`;
    } else if (totalInit > 0) {
      prevSummaryText = `Старт программы: ${formatMatrixWeightLabel(baseWeight, addonWeight, totalInit)} × ${reps}`;
    }
  }

  // Если включена Неделя 4 (Разгрузка): снижаем вес на 15–20% (по умолчанию 18%)
  if (isDeload && !exercise.isTimeBased && eq !== 'bodyweight') {
    const totalOriginal = baseWeight + addonWeight;
    const reduced = totalOriginal * (1 - deloadPercent / 100);
    if (eq === 'barbell' || eq === 'dumbbell') {
      // Округляем до шага 2 кг / 2.5 кг
      baseWeight = Math.max(eq === 'barbell' ? 20 : 4, Math.round(reduced / 2) * 2);
      addonWeight = 0;
    } else {
      // Для Matrix/блока сбрасываем довесок и округляем плитку
      baseWeight = Math.max(5, Math.round(reduced));
      addonWeight = 0;
    }
  }

  return {
    baseWeight,
    addonWeight,
    weight: roundWeightClean(baseWeight + addonWeight),
    reps,
    prevSummaryText,
    lastWorkoutDate,
    previousSets: matchedSets || []
  };
}

export function formatMatrixWeightLabel(baseWeight, addonWeight, totalWeight) {
  const b = Number(baseWeight) || 0;
  const a = Number(addonWeight) || 0;
  const tot = totalWeight !== undefined ? Number(totalWeight) : roundWeightClean(b + a);
  if (a > 0) {
    return `${b} + ${a} кг (${tot} кг)`;
  }
  return `${tot} кг`;
}

export function formatDurationMMSS(totalSeconds) {
  const sec = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function parseDurationInput(str) {
  const raw = String(str || '').trim();
  if (!raw) return 0;
  if (raw.includes(':')) {
    const [m, s] = raw.split(':').map((n) => parseInt(n, 10) || 0);
    return m * 60 + s;
  }
  return parseInt(raw, 10) || 0;
}

// === ЗАВЕРШЕНИЕ И СОХРАНЕНИЕ ТРЕНИРОВКИ В ИСТОРИЮ ===

export async function finishAndSaveWorkout(activeWorkout) {
  const nowIso = new Date().toISOString();
  const startedMs = new Date(activeWorkout.startedAt).getTime();
  const durationSeconds = Math.max(60, Math.round((Date.now() - startedMs) / 1000));

  let totalVolumeKg = 0;
  let completedSetsCount = 0;
  const savedExercisesSummary = [];
  const setsToInsert = [];

  for (const exBlock of activeWorkout.exercises) {
    const completedSets = exBlock.sets.filter((s) => s.isCompleted);
    if (completedSets.length === 0) continue;

    // Фиксируем и стартовый рабочий вес (1-й выполненный подход), и все подходы
    const startingWeight = completedSets[0].weight;
    const endingWeight = completedSets[completedSets.length - 1].weight;

    const exSetsRecords = [];
    for (let i = 0; i < completedSets.length; i++) {
      const s = completedSets[i];
      const setId = `${activeWorkout.id}_${exBlock.exerciseId}_s${i + 1}`;
      const totalW = roundWeightClean((Number(s.baseWeight) || 0) + (Number(s.addonWeight) || 0));
      const repsVal = Number(s.reps) || 0;

      if (!exBlock.isTimeBased && totalW > 0) {
        totalVolumeKg += totalW * repsVal;
      }
      completedSetsCount++;

      const setRecord = {
        id: setId,
        workoutId: activeWorkout.id,
        exerciseId: exBlock.exerciseId,
        exerciseName: exBlock.name,
        setNumber: i + 1,
        equipmentUsed: exBlock.equipmentUsed,
        angleVariant: exBlock.angleVariant || '',
        baseWeight: Number(s.baseWeight) || 0,
        addonWeight: Number(s.addonWeight) || 0,
        weight: totalW,
        startingWorkoutWeight: startingWeight,
        reps: repsVal,
        isTimeBased: !!exBlock.isTimeBased,
        isCompleted: true,
        createdAt: s.completedAt || nowIso
      };
      setsToInsert.push(setRecord);
      exSetsRecords.push(setRecord);
    }

    savedExercisesSummary.push({
      exerciseId: exBlock.exerciseId,
      name: exBlock.name,
      muscleGroup: exBlock.muscleGroup,
      equipmentUsed: exBlock.equipmentUsed,
      angleVariant: exBlock.angleVariant || '',
      isTimeBased: !!exBlock.isTimeBased,
      startingWeight,
      endingWeight,
      sets: exSetsRecords
    });
  }

  const workoutRecord = {
    id: activeWorkout.id,
    routineId: activeWorkout.routineId,
    routineName: activeWorkout.routineName,
    routineCode: activeWorkout.routineCode,
    startedAt: activeWorkout.startedAt,
    finishedAt: nowIso,
    durationSeconds,
    isDeload: !!activeWorkout.isDeload,
    cycleWeek: activeWorkout.cycleWeek || 1,
    cycleStep: activeWorkout.cycleStep ?? 0,
    totalVolumeKg: Math.round(totalVolumeKg),
    completedSetsCount,
    exercises: savedExercisesSummary
  };

  await txPut('workouts_history', workoutRecord);
  for (const sRec of setsToInsert) {
    await txPut('workout_sets', sRec);
  }

  // Продвигаем шаг 4-недельного цикла, если это была тренировка по плану
  const cycleState = (await getAppState('cycle_state')) || { currentStep: 0 };
  if (activeWorkout.routineId !== 'free_workout') {
    const nextStep = ((cycleState.currentStep || 0) + 1) % FOUR_WEEK_CYCLE.length;
    await setAppState('cycle_state', {
      currentStep: nextStep,
      manualDeloadOverride: null
    });
  }

  // Очищаем черновик активной сессии
  await saveActiveWorkout(null);

  return workoutRecord;
}

export async function deleteWorkoutFromHistory(workoutId) {
  await txDelete('workouts_history', workoutId);
  const allSets = await getAllWorkoutSets();
  for (const s of allSets) {
    if (s.workoutId === workoutId) {
      await txDelete('workout_sets', s.id);
    }
  }
}

/**
 * Обновление сохранённой тренировки в статистике/истории (после ручного редактирования весов, повторений, углов или подходов)
 */
export async function updateWorkoutInHistory(workoutRecord) {
  let totalVolumeKg = 0;
  let completedSetsCount = 0;

  // Удаляем старые подходы этой тренировки из таблицы workout_sets
  const allSets = await getAllWorkoutSets();
  for (const s of allSets) {
    if (s.workoutId === workoutRecord.id) {
      await txDelete('workout_sets', s.id);
    }
  }

  const newSetsToInsert = [];
  for (const ex of workoutRecord.exercises || []) {
    const sets = ex.sets || [];
    if (sets.length === 0) continue;

    sets.forEach((s, idx) => {
      s.setNumber = idx + 1;
      s.baseWeight = Number(s.baseWeight) || 0;
      s.addonWeight = Number(s.addonWeight) || 0;
      s.weight = roundWeightClean(s.baseWeight + s.addonWeight);
      s.reps = Number(s.reps) || 0;
      s.equipmentUsed = ex.equipmentUsed;
      s.angleVariant = ex.angleVariant || '';
    });

    ex.startingWeight = sets[0].weight;
    ex.endingWeight = sets[sets.length - 1].weight;

    for (let i = 0; i < sets.length; i++) {
      const s = sets[i];
      const setId = `${workoutRecord.id}_${ex.exerciseId}_s${i + 1}`;
      if (!ex.isTimeBased && s.weight > 0) {
        totalVolumeKg += s.weight * s.reps;
      }
      completedSetsCount++;

      const setRecord = {
        id: setId,
        workoutId: workoutRecord.id,
        exerciseId: ex.exerciseId,
        exerciseName: ex.name,
        setNumber: i + 1,
        equipmentUsed: ex.equipmentUsed,
        angleVariant: ex.angleVariant || '',
        baseWeight: s.baseWeight,
        addonWeight: s.addonWeight,
        weight: s.weight,
        startingWorkoutWeight: ex.startingWeight,
        reps: s.reps,
        isTimeBased: !!ex.isTimeBased,
        isCompleted: true,
        createdAt: s.createdAt || workoutRecord.startedAt
      };
      newSetsToInsert.push(setRecord);
      ex.sets[i] = setRecord;
    }
  }

  workoutRecord.exercises = (workoutRecord.exercises || []).filter((ex) => ex.sets && ex.sets.length > 0);
  workoutRecord.totalVolumeKg = Math.round(totalVolumeKg);
  workoutRecord.completedSetsCount = completedSetsCount;

  await txPut('workouts_history', workoutRecord);
  for (const sRec of newSetsToInsert) {
    await txPut('workout_sets', sRec);
  }
  return workoutRecord;
}

// === ИСТОРИЯ ПРОГРЕССИИ ПО УПРАЖНЕНИЮ ===

export async function getExerciseProgressionHistory(exerciseId) {
  const allWorkouts = await getAllWorkoutsHistory();
  const workoutMap = new Map(allWorkouts.map((w) => [w.id, w]));
  const allSets = await getAllWorkoutSets();

  const filtered = allSets.filter((s) => s.exerciseId === exerciseId && s.isCompleted);
  const byWorkout = new Map();

  for (const s of filtered) {
    if (!byWorkout.has(s.workoutId)) {
      byWorkout.set(s.workoutId, []);
    }
    byWorkout.get(s.workoutId).push(s);
  }

  const sessions = [];
  for (const [wId, sets] of byWorkout.entries()) {
    const w = workoutMap.get(wId);
    if (!w) continue;
    sets.sort((a, b) => a.setNumber - b.setNumber);
    const firstSet = sets[0];
    const maxWeightSet = sets.reduce((best, cur) => (cur.weight > best.weight ? cur : best), sets[0]);
    const maxRepsSet = sets.reduce((best, cur) => (cur.reps > best.reps ? cur : best), sets[0]);

    sessions.push({
      workoutId: wId,
      date: w.startedAt,
      routineName: w.routineName,
      isDeload: !!w.isDeload,
      equipmentUsed: firstSet.equipmentUsed,
      angleVariant: firstSet.angleVariant || '',
      startingWeight: firstSet.weight,
      maxWeight: maxWeightSet.weight,
      maxReps: maxRepsSet.reps,
      sets
    });
  }

  return sessions.sort((a, b) => new Date(a.date) - new Date(b.date));
}

// === ПОЛНЫЙ ЭКСПОРТ И ИМПОРТ БАЗЫ ДАННЫХ (JSON) ===

export async function exportFullDatabase() {
  const exercises = await txGetAll('exercises');
  const routines = await txGetAll('routines');
  const workouts_history = await txGetAll('workouts_history');
  const workout_sets = await txGetAll('workout_sets');
  const app_state = await txGetAll('app_state');

  return {
    app: 'DDX_Gym_Tracker_PWA',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      exercises,
      routines,
      workouts_history,
      workout_sets,
      app_state
    }
  };
}

export async function importFullDatabase(payload) {
  if (!payload || !payload.data) {
    throw new Error('Некорректный формат файла бэкапа');
  }
  const { exercises, routines, workouts_history, workout_sets, app_state } = payload.data;

  if (Array.isArray(exercises)) {
    await txClear('exercises');
    for (const item of exercises) await txPut('exercises', item);
  }
  if (Array.isArray(routines)) {
    await txClear('routines');
    for (const item of routines) await txPut('routines', item);
  }
  if (Array.isArray(workouts_history)) {
    await txClear('workouts_history');
    for (const item of workouts_history) await txPut('workouts_history', item);
  }
  if (Array.isArray(workout_sets)) {
    await txClear('workout_sets');
    for (const item of workout_sets) await txPut('workout_sets', item);
  }
  if (Array.isArray(app_state)) {
    for (const item of app_state) {
      if (item.key !== 'active_workout') {
        await txPut('app_state', item);
      }
    }
  }
  return true;
}

