export type LivenessStepKey = 'face' | 'blink' | 'turnLeft' | 'turnRight';

export interface LivenessStep {
  key: LivenessStepKey;
  title: string;
  description: string;
  done: boolean;
}

interface LiveMetrics {
  yaw: number;
  eyeRatio: number;
  alignment: number;
}

interface LivenessStatusProps {
  appState: string;
  statusMessage: string;
  steps: LivenessStep[];
  currentPrompt: string;
  metrics: LiveMetrics;
}

const stateLabel: Record<string, string> = {
  idle: 'Ожидание',
  camera_ready: 'Камера готова',
  detecting_face: 'Поиск лица',
  liveness_in_progress: 'Проверка активности',
  liveness_success: 'Проверка пройдена',
  identify_loading: 'Распознавание',
  user_found: 'Пользователь найден',
  user_not_found: 'Лицо не найдено',
  register_loading: 'Регистрация',
  register_success: 'Регистрация завершена',
  delete_loading: 'Удаление',
  error: 'Ошибка',
};

export function LivenessStatus({
  appState,
  statusMessage,
  steps,
  currentPrompt,
  metrics,
}: LivenessStatusProps) {
  const showLiveMetrics =
    appState === 'detecting_face' ||
    appState === 'liveness_in_progress' ||
    appState === 'liveness_success';

  return (
    <section className="rounded-[24px] border border-slate-200/70 bg-white/90 p-4 shadow-panel backdrop-blur sm:rounded-[28px] sm:p-5 xl:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            Проверка активности
          </p>
          <h2 className="mt-1 text-lg font-semibold text-ink sm:text-xl">Статус проверки</h2>
        </div>
        <span className="rounded-full bg-accentSoft px-3 py-1 text-[11px] font-semibold text-accent sm:text-xs">
          {stateLabel[appState] ?? appState}
        </span>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-700">
        {statusMessage}
      </div>

      <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
          Текущий этап
        </div>
        <div className="mt-2 text-sm font-semibold text-ink">{currentPrompt}</div>
      </div>

      {showLiveMetrics ? (
        <div className="mt-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
              Положение головы
            </div>
            <div className="mt-1 text-sm font-semibold text-ink">
              {Math.abs(metrics.yaw) < 0.06
                ? 'По центру'
                : metrics.yaw < 0
                  ? 'Повернута вправо'
                  : 'Повернута влево'}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
              Положение в кадре
            </div>
            <div className="mt-1 text-sm font-semibold text-ink">
              {metrics.alignment >= 0.75
                ? 'Подходит для проверки'
                : metrics.alignment >= 0.5
                  ? 'Нужно немного поправить'
                  : 'Нужно скорректировать'}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-5 space-y-3">
        {steps.map((step, index) => (
          <div
            key={step.key}
            className={`flex items-start gap-3 rounded-2xl border px-4 py-3 transition ${
              step.done
                ? 'border-emerald-200 bg-emerald-50'
                : 'border-slate-200 bg-white'
            }`}
          >
            <div
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                step.done
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-200 text-slate-600'
              }`}
            >
              {step.done ? '✓' : index + 1}
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">{step.title}</div>
              <div className="text-sm text-slate-600">{step.description}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
