// Стартовые данные справочника упражнений SKIBIDI, шаблонов тренировок и 4-недельного цикла

export const EQUIPMENT_TYPES = {
  matrix: {
    id: 'matrix',
    label: 'Matrix тренажёр',
    shortLabel: 'Matrix',
    hasMatrixDial: true,
    hint: 'Плитка стека + круговой регулятор (+2.3 / +4.6 кг)'
  },
  cable: {
    id: 'cable',
    label: 'Блок / Кроссовер',
    shortLabel: 'Блок',
    hasMatrixDial: true,
    hint: 'Плитка блока + довесок (+2.3 / +4.6 кг)'
  },
  barbell: {
    id: 'barbell',
    label: 'Штанга (гриф 20 кг)',
    shortLabel: 'Штанга 20кг',
    hasMatrixDial: false,
    barWeight: 20,
    hint: 'Общий вес со стандартным грифом 20 кг (или блины)'
  },
  dumbbell: {
    id: 'dumbbell',
    label: '2 Гантели (сумма)',
    shortLabel: '2 Гантели Σ',
    hasMatrixDial: false,
    isPairSum: true,
    hint: 'Указывается СУММА двух гантелей (напр. 2×12 кг = 24 кг)'
  },
  free: {
    id: 'free',
    label: '1 Гантель / Своб. вес / Блины',
    shortLabel: 'Своб. вес',
    hasMatrixDial: false,
    hint: 'Вес одной гантели, блина или EZ-штанги'
  },
  bodyweight: {
    id: 'bodyweight',
    label: 'Свой вес',
    shortLabel: 'Свой вес',
    hasMatrixDial: false,
    isBodyweight: true,
    hint: 'Собственный вес тела (на кол-во повторений или время)'
  }
};

export const MUSCLE_GROUPS = [
  'Грудь',
  'Спина',
  'Ноги',
  'Плечи',
  'Руки',
  'Кор'
];

export const ANGLE_PRESETS = [
  { id: '', label: 'Стандарт (без угла)' },
  { id: '0° (Горизонт.)', label: '0° — Горизонтальная скамья' },
  { id: '15° (Малый наклон)', label: '15° — Малый наклон вверх' },
  { id: '30° (Верх груди)', label: '30° — Средний наклон (верх груди)' },
  { id: '45° (Крутой наклон)', label: '45° — Крутой наклон (верх груди/дельты)' },
  { id: '75–90° (Сидя вертик.)', label: '75–90° — Вертикально сидя (плечи)' },
  { id: '-15° (Отриц. наклон)', label: '-15° — Отрицательный наклон (низ груди)' },
  { id: 'Широкий хват', label: 'Широкий хват (акцент на ширину)' },
  { id: 'Узкий хват', label: 'Узкий хват (акцент на трицепс / центр)' },
  { id: 'Параллельный хват', label: 'Параллельный / Нейтральный хват' },
  { id: 'Обратный хват', label: 'Обратный хват (супинация)' },
  { id: 'Канатная рукоять', label: 'Канатная рукоять (блок)' },
  { id: 'Прямая рукоять', label: 'Прямая / V-рукоять (блок)' },
  { id: 'Стоя', label: 'Положение: Стоя' },
  { id: 'Сидя', label: 'Положение: Сидя' }
];

export const INITIAL_EXERCISES = [
  // === ДЕНЬ 1: ВЕРХ А (Толщина спины и грудь) ===
  {
    id: 'ex_bench_press',
    name: 'Жим штанги лежа на скамье',
    muscleGroup: 'Грудь',
    defaultEquipment: 'barbell',
    isTimeBased: false,
    defaultSets: 3,
    repRange: '8',
    seatSettings: 'Гриф 20 кг + по 10 кг с каждой стороны',
    initialBaseWeight: 40,
    initialAddonWeight: 0,
    initialReps: 8
  },
  {
    id: 'ex_lat_pulldown',
    name: 'Тяга верхнего блока к груди',
    muscleGroup: 'Спина',
    defaultEquipment: 'matrix',
    isTimeBased: false,
    defaultSets: 3,
    repRange: '8–10',
    seatSettings: 'Валики под колени по росту, широкая рукоять',
    initialBaseWeight: 32,
    initialAddonWeight: 4.6,
    initialReps: 10
  },
  {
    id: 'ex_supine_press',
    name: 'Supine Press (Жим в тренажёре лёжа)',
    muscleGroup: 'Грудь',
    defaultEquipment: 'matrix',
    isTimeBased: false,
    defaultSets: 3,
    repRange: '8–10',
    seatSettings: 'Тренажёр Matrix — запиши номер сиденья',
    initialBaseWeight: 32,
    initialAddonWeight: 0,
    initialReps: 10
  },
  {
    id: 'ex_seated_row',
    name: 'Seated Row (Горизонтальная тяга с упором в грудь)',
    muscleGroup: 'Спина',
    defaultEquipment: 'matrix',
    isTimeBased: false,
    defaultSets: 3,
    repRange: '8–10',
    seatSettings: 'Сиденье и грудной упор Matrix',
    initialBaseWeight: 32,
    initialAddonWeight: 0,
    initialReps: 10
  },
  {
    id: 'ex_bicep_machine',
    name: 'Бицепс тренажер',
    muscleGroup: 'Руки',
    defaultEquipment: 'matrix',
    isTimeBased: false,
    defaultSets: 3,
    repRange: '10–12',
    seatSettings: 'Локти плотно на пюпитре (можно заменить на гантели/штангу)',
    initialBaseWeight: 23,
    initialAddonWeight: 2.3,
    initialReps: 10
  },
  {
    id: 'ex_tricep_dip_machine',
    name: 'Трицепс (скамья тренажёр)',
    muscleGroup: 'Руки',
    defaultEquipment: 'matrix',
    isTimeBased: false,
    defaultSets: 3,
    repRange: '10–12',
    seatSettings: 'Жим вниз сидя на трицепс в тренажёре Matrix',
    initialBaseWeight: 41,
    initialAddonWeight: 0,
    initialReps: 10
  },

  // === ДЕНЬ 2: НИЗ + КОР ===
  {
    id: 'ex_leg_press',
    name: 'Leg Press (Жим платформы ногами)',
    muscleGroup: 'Ноги',
    defaultEquipment: 'matrix',
    isTimeBased: false,
    defaultSets: 3,
    repRange: '10–12',
    seatSettings: 'Поясница прижата, колени полностью не выключать',
    initialBaseWeight: 20,
    initialAddonWeight: 0,
    initialReps: 12
  },
  {
    id: 'ex_calves',
    name: 'Икры',
    muscleGroup: 'Ноги',
    defaultEquipment: 'matrix',
    isTimeBased: false,
    defaultSets: 3,
    repRange: '15–20',
    seatSettings: 'Пауза 1 сек в нижней и верхней точке',
    initialBaseWeight: 15,
    initialAddonWeight: 0,
    initialReps: 18
  },
  {
    id: 'ex_leg_extension',
    name: 'Leg Extension (Разгибание ног сидя)',
    muscleGroup: 'Ноги',
    defaultEquipment: 'matrix',
    isTimeBased: false,
    defaultSets: 3,
    repRange: '10–12',
    seatSettings: 'Ось вращения напротив колена, настроить спинку и валик',
    initialBaseWeight: 23,
    initialAddonWeight: 0,
    initialReps: 12
  },
  {
    id: 'ex_seated_leg_curl',
    name: 'Seated Leg Curl (Сгибание ног сидя)',
    muscleGroup: 'Ноги',
    defaultEquipment: 'matrix',
    isTimeBased: false,
    defaultSets: 3,
    repRange: '10–12',
    seatSettings: 'Валик над пяткой, плотно зажать колени сверху',
    initialBaseWeight: 23,
    initialAddonWeight: 2.3,
    initialReps: 12
  },
  {
    id: 'ex_back_extension',
    name: 'Back Extension (Сидячий тренажёр для разгибателей спины)',
    muscleGroup: 'Кор',
    defaultEquipment: 'matrix',
    isTimeBased: false,
    defaultSets: 3,
    repRange: '12–15',
    seatSettings: 'Плавное движение без рывков для здоровья поясницы',
    initialBaseWeight: 41,
    initialAddonWeight: 0,
    initialReps: 14
  },
  {
    id: 'ex_plank',
    name: 'Планка',
    muscleGroup: 'Кор',
    defaultEquipment: 'bodyweight',
    isTimeBased: true,
    defaultSets: 3,
    repRange: 'макс. время',
    seatSettings: 'Пресс и ягодицы напряжены, без прогиба в пояснице',
    initialBaseWeight: 0,
    initialAddonWeight: 0,
    initialReps: 95 // 1:35 = 95 секунд
  },

  // === ДЕНЬ 3: ВЕРХ Б (Ширина спины и руки) ===
  {
    id: 'ex_pullups',
    name: 'Подтягивания на перекладине',
    muscleGroup: 'Спина',
    defaultEquipment: 'bodyweight',
    isTimeBased: false,
    defaultSets: 3,
    repRange: '6–8',
    seatSettings: 'Собственный вес на количество раз',
    initialBaseWeight: 0,
    initialAddonWeight: 0,
    initialReps: 7
  },
  {
    id: 'ex_shoulder_press',
    name: 'Shoulder Press (Жим в тренажёре сидя)',
    muscleGroup: 'Плечи',
    defaultEquipment: 'matrix',
    isTimeBased: false,
    defaultSets: 3,
    repRange: '8–10',
    seatSettings: 'Рукояти на уровне плеч (можно заменить на 2 гантели)',
    initialBaseWeight: 23,
    initialAddonWeight: 0,
    initialReps: 10
  },
  {
    id: 'ex_dumbbell_pullover',
    name: 'Пуловер с гантелью лежа на скамье',
    muscleGroup: 'Спина',
    defaultEquipment: 'free',
    isTimeBased: false,
    defaultSets: 3,
    repRange: '12–15',
    seatSettings: 'Одна гантель двумя руками за голову, растяжка широчайших',
    initialBaseWeight: 16,
    initialAddonWeight: 0,
    initialReps: 12
  },
  {
    id: 'ex_hammer_curls',
    name: 'Поочередные сгибания рук с гантелями «Молот»',
    muscleGroup: 'Руки',
    defaultEquipment: 'dumbbell',
    isTimeBased: false,
    defaultSets: 3,
    repRange: '10–12',
    seatSettings: 'Указывается сумма 2 гантелей (напр. 2×10 кг = 20 кг)',
    initialBaseWeight: 20,
    initialAddonWeight: 0,
    initialReps: 10
  },
  {
    id: 'ex_tricep_pushdown',
    name: 'Трицепс на верхнем блоке',
    muscleGroup: 'Руки',
    defaultEquipment: 'cable',
    isTimeBased: false,
    defaultSets: 3,
    repRange: '10–12',
    seatSettings: 'Канатная или прямая рукоять, локти прижаты к корпусу',
    initialBaseWeight: 23,
    initialAddonWeight: 0,
    initialReps: 12
  }
];

export const INITIAL_ROUTINES = [
  {
    id: 'day1_upper_a',
    code: 'Верх А',
    name: 'День 1 (Верх А)',
    subtitle: 'Акцент на толщину спины и грудь',
    badgeColor: 'emerald',
    warmupType: 'upper',
    items: [
      { exerciseId: 'ex_bench_press', sets: 3, repRange: '8' },
      { exerciseId: 'ex_lat_pulldown', sets: 3, repRange: '8–10' },
      { exerciseId: 'ex_supine_press', sets: 3, repRange: '8–10' },
      { exerciseId: 'ex_seated_row', sets: 3, repRange: '8–10' },
      { exerciseId: 'ex_bicep_machine', sets: 3, repRange: '10–12' },
      { exerciseId: 'ex_tricep_dip_machine', sets: 3, repRange: '10–12' }
    ]
  },
  {
    id: 'day2_lower',
    code: 'Низ',
    name: 'День 2 (Низ + Кор)',
    subtitle: 'Минимум для ног и здоровье поясницы',
    badgeColor: 'blue',
    warmupType: 'lower',
    items: [
      { exerciseId: 'ex_leg_press', sets: 3, repRange: '10–12' },
      { exerciseId: 'ex_calves', sets: 3, repRange: '15–20' },
      { exerciseId: 'ex_leg_extension', sets: 3, repRange: '10–12' },
      { exerciseId: 'ex_seated_leg_curl', sets: 3, repRange: '10–12' },
      { exerciseId: 'ex_back_extension', sets: 3, repRange: '12–15' },
      { exerciseId: 'ex_plank', sets: 3, repRange: 'макс. время' }
    ]
  },
  {
    id: 'day3_upper_b',
    code: 'Верх Б',
    name: 'День 3 (Верх Б)',
    subtitle: 'Акцент на ширину спины и руки',
    badgeColor: 'purple',
    warmupType: 'upper',
    items: [
      { exerciseId: 'ex_pullups', sets: 3, repRange: '6–8' },
      { exerciseId: 'ex_shoulder_press', sets: 3, repRange: '8–10' },
      { exerciseId: 'ex_dumbbell_pullover', sets: 3, repRange: '12–15' },
      { exerciseId: 'ex_hammer_curls', sets: 3, repRange: '10–12' },
      { exerciseId: 'ex_tricep_pushdown', sets: 3, repRange: '10–12' }
    ]
  }
];

// 4-недельный цикл (Пн / Ср / Пт — 12 тренировок)
export const FOUR_WEEK_CYCLE = [
  // Неделя 1: (Верх А) — (Низ) — (Верх Б)
  { step: 0, week: 1, dayLabel: 'Пн', routineId: 'day1_upper_a', isDeload: false },
  { step: 1, week: 1, dayLabel: 'Ср', routineId: 'day2_lower', isDeload: false },
  { step: 2, week: 1, dayLabel: 'Пт', routineId: 'day3_upper_b', isDeload: false },
  // Неделя 2: (Верх Б) — (Низ) — (Верх А)
  { step: 3, week: 2, dayLabel: 'Пн', routineId: 'day3_upper_b', isDeload: false },
  { step: 4, week: 2, dayLabel: 'Ср', routineId: 'day2_lower', isDeload: false },
  { step: 5, week: 2, dayLabel: 'Пт', routineId: 'day1_upper_a', isDeload: false },
  // Неделя 3: (Верх А) — (Низ) — (Верх Б)
  { step: 6, week: 3, dayLabel: 'Пн', routineId: 'day1_upper_a', isDeload: false },
  { step: 7, week: 3, dayLabel: 'Ср', routineId: 'day2_lower', isDeload: false },
  { step: 8, week: 3, dayLabel: 'Пт', routineId: 'day3_upper_b', isDeload: false },
  // Неделя 4 (Разгрузка): -1 подход и -15..20% вес
  { step: 9, week: 4, dayLabel: 'Пн', routineId: 'day3_upper_b', isDeload: true },
  { step: 10, week: 4, dayLabel: 'Ср', routineId: 'day2_lower', isDeload: true },
  { step: 11, week: 4, dayLabel: 'Пт', routineId: 'day1_upper_a', isDeload: true }
];

export const DEFAULT_WARMUP_CONFIG = {
  upper: [
    'Кардио 5 мин (дорожка / эллипс до лёгкого пульса)',
    'Суставная разминка: вращения плеч, локтей, запястий и грудного отдела',
    'Ротаторы плеча с лёгкой резинкой / гантелью 2 кг (по 15 раз)',
    'Разминочный подход в первом упражнении: пустой гриф 20 кг × 12'
  ],
  lower: [
    'Кардио 5 мин (велотренажёр или наклонная дорожка)',
    'Суставная разминка: тазобедренные суставы, колени, голеностоп',
    'Приседания со своим весом + мягкие наклоны для поясницы (12 раз)',
    '1 лёгкий подводящий подход в жиме ногами (50% веса × 12)'
  ]
};

