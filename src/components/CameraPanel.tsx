import type { RefObject } from 'react';

interface CameraPanelProps {
  videoRef: RefObject<HTMLVideoElement>;
  cameraActive: boolean;
  canStartCheck: boolean;
  loadingModels: boolean;
  faceDetected: boolean;
  multipleFaces: boolean;
  currentPrompt: string;
  liveHint: string;
  alignment: number;
  checkingActive: boolean;
  positionHint?: string;
  faceStateLabel: string;
  headDirectionLabel: string;
  steps: Array<{
    key: string;
    title: string;
    done: boolean;
  }>;
  activeStepKey: string | null;
  onStartCamera: () => void;
  onStopCamera: () => void;
  onStartCheck: () => void;
}

export function CameraPanel({
  videoRef,
  cameraActive,
  canStartCheck,
  loadingModels,
  faceDetected,
  multipleFaces,
  currentPrompt,
  liveHint,
  alignment,
  checkingActive,
  positionHint,
  faceStateLabel,
  headDirectionLabel,
  steps,
  activeStepKey,
  onStartCamera,
  onStopCamera,
  onStartCheck,
}: CameraPanelProps) {
  const frameClass = multipleFaces
    ? 'border-rose-400 shadow-[0_0_0_1px_rgba(248,113,113,0.3),0_0_40px_rgba(248,113,113,0.35)]'
    : faceDetected
      ? 'border-teal-300 shadow-[0_0_0_1px_rgba(45,212,191,0.3),0_0_40px_rgba(45,212,191,0.35)]'
      : 'border-white/40 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]';

  return (
    <section className="rounded-[24px] border border-slate-200/70 bg-white/90 p-4 shadow-panel backdrop-blur sm:rounded-[28px] sm:p-5 xl:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            Камера
          </p>
          <h2 className="mt-1 text-lg font-semibold text-ink sm:text-xl">
            Биометрическое сканирование
          </h2>
        </div>
        <div className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600 sm:text-xs">
          {cameraActive ? 'Активна' : 'Не запущена'}
        </div>
      </div>

      <div className="relative aspect-[3/4] overflow-hidden rounded-[24px] bg-slate-950 sm:aspect-[4/3]">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover [transform:scaleX(-1)]"
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_transparent_35%,_rgba(2,6,23,0.34)_70%,_rgba(2,6,23,0.82)_100%)]" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-slate-950/65 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-slate-950/80 to-transparent" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className={`relative h-[78%] w-[78%] rounded-[28px] border transition-all duration-300 sm:h-[72%] sm:w-[72%] sm:rounded-[32px] ${frameClass}`}
          >
            <div className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent sm:inset-x-8" />
            <div className="absolute inset-x-6 bottom-0 h-px bg-gradient-to-r from-transparent via-white/70 to-transparent sm:inset-x-8" />
            <div className="absolute inset-y-6 left-0 w-px bg-gradient-to-b from-transparent via-white/70 to-transparent sm:inset-y-8" />
            <div className="absolute inset-y-6 right-0 w-px bg-gradient-to-b from-transparent via-white/70 to-transparent sm:inset-y-8" />
            <div className="absolute inset-x-8 bottom-4 h-1.5 overflow-hidden rounded-full bg-white/12 sm:inset-x-10 sm:bottom-5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-teal-300 to-emerald-300 transition-all duration-200"
                style={{ width: `${Math.max(8, alignment * 100)}%` }}
              />
            </div>
          </div>
        </div>

        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2 sm:inset-x-5 sm:top-5 sm:gap-3">
          <div className="max-w-[72%] rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-2.5 backdrop-blur-md sm:max-w-[70%] sm:px-4 sm:py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-teal-200/90">
              Инструкция
            </div>
            <div className="mt-1 text-sm font-semibold leading-5 text-white">{currentPrompt}</div>
            <div className="mt-1 text-[11px] leading-4 text-slate-300 sm:text-xs sm:leading-5">
              {liveHint}
            </div>
          </div>
          {checkingActive ? (
            <div className="rounded-2xl border border-white/10 bg-slate-950/45 px-2.5 py-2 text-right backdrop-blur-md sm:px-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                Положение
              </div>
              <div className="mt-1 text-base font-semibold text-white sm:text-lg">
                {Math.round(alignment * 100)}%
              </div>
            </div>
          ) : null}
        </div>

        {checkingActive && positionHint ? (
          <div className="absolute inset-x-3 bottom-3 sm:inset-x-5 sm:bottom-5">
            <div className="rounded-2xl border border-white/10 bg-slate-950/45 px-4 py-3 text-sm font-medium text-white backdrop-blur-md">
              {positionHint}
            </div>
          </div>
        ) : null}

        {!cameraActive ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 px-6 text-center text-sm text-slate-300">
            Запустите камеру, чтобы начать проверку активности и отправить кадр на сервер.
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Состояние лица</div>
          <div className="mt-1 text-sm font-semibold text-ink">{faceStateLabel}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Поворот головы</div>
          <div className="mt-1 text-sm font-semibold text-ink">{headDirectionLabel}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Режим</div>
          <div className="mt-1 text-sm font-semibold text-ink">
            {checkingActive ? 'Проверка идет' : cameraActive ? 'Камера активна' : 'Ожидание запуска'}
          </div>
        </div>
      </div>

      <div className="-mx-1 mt-4 flex gap-2 overflow-x-auto px-1 pb-1 xl:hidden">
        {steps.map((step, index) => {
          const isActive = activeStepKey === step.key;

          return (
            <div
              key={step.key}
              className={`min-w-[132px] rounded-2xl border px-3 py-3 transition ${
                step.done
                  ? 'border-emerald-200 bg-emerald-50'
                  : isActive
                    ? 'border-teal-200 bg-teal-50'
                    : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Шаг {index + 1}
              </div>
              <div className="mt-1 text-sm font-semibold text-ink">{step.title}</div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 grid gap-3 sm:flex sm:flex-wrap">
        <button
          type="button"
          onClick={onStartCamera}
          disabled={cameraActive}
          className="min-h-12 rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Запустить камеру
        </button>
        <button
          type="button"
          onClick={onStopCamera}
          disabled={!cameraActive}
          className="min-h-12 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
        >
          Остановить камеру
        </button>
        <button
          type="button"
          onClick={onStartCheck}
          disabled={!canStartCheck || loadingModels}
          className="min-h-12 rounded-2xl bg-accent px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-teal-200"
        >
          {loadingModels ? 'Загрузка модели...' : 'Начать сканирование'}
        </button>
      </div>
    </section>
  );
}
