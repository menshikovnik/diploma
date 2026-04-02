import type { RefObject } from 'react';

interface CameraPanelProps {
  videoRef: RefObject<HTMLVideoElement>;
  cameraActive: boolean;
  loadingModels: boolean;
  faceDetected: boolean;
  multipleFaces: boolean;
  currentPrompt: string;
  liveHint: string;
  checkingActive: boolean;
  positionHint?: string;
  faceStateLabel: string;
  onStartCheck: () => void;
  onStopCheck: () => void;
}

export function CameraPanel({
  videoRef,
  cameraActive,
  loadingModels,
  faceDetected,
  multipleFaces,
  currentPrompt,
  liveHint,
  checkingActive,
  positionHint,
  faceStateLabel,
  onStartCheck,
  onStopCheck,
}: CameraPanelProps) {
  const showHint = Boolean(checkingActive && positionHint);
  const frameClass = multipleFaces
    ? 'border-rose-400 shadow-[0_0_0_1px_rgba(248,113,113,0.3),0_0_40px_rgba(248,113,113,0.35)]'
    : faceDetected
      ? 'border-teal-300 shadow-[0_0_0_1px_rgba(45,212,191,0.3),0_0_40px_rgba(45,212,191,0.35)]'
      : 'border-white/40 shadow-[0_0_0_1px_rgba(255,255,255,0.12)]';

  return (
    <section className="mx-auto max-w-3xl rounded-[24px] border border-slate-200/70 bg-white/95 p-4 shadow-panel backdrop-blur sm:rounded-[28px] sm:p-5 xl:p-6">
      <div className="mb-4 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
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

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onStartCheck}
            disabled={loadingModels}
            className="min-h-11 rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {loadingModels
              ? 'Загрузка модели...'
              : checkingActive || cameraActive
                ? 'Начать проверку заново'
                : 'Начать проверку'}
          </button>
          <button
            type="button"
            onClick={onStopCheck}
            disabled={!cameraActive}
            className="min-h-11 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            Остановить проверку
          </button>
        </div>
      </div>

      <div className="mb-3">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Инструкция
          </div>
          <div className="mt-1 text-sm font-semibold text-ink">{currentPrompt}</div>
          <div className="mt-1 text-sm leading-5 text-slate-600">{liveHint}</div>
        </div>
      </div>

      <div className="relative aspect-[4/5] overflow-hidden rounded-[22px] bg-slate-950 sm:aspect-[16/10]">
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
        <div className="absolute inset-0 flex items-center justify-center px-4 py-6 sm:px-6 sm:py-8">
          <div
            className={`relative h-[72%] w-[42%] rounded-[999px] border transition-all duration-300 sm:h-[74%] sm:w-[30%] ${frameClass}`}
          />
        </div>

        {!cameraActive ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 px-6 text-center text-sm text-slate-300">
            Запустите камеру, чтобы подготовить серию кадров для проверки.
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Состояние лица</div>
        <div className="mt-1 text-sm font-semibold text-ink">{faceStateLabel}</div>
      </div>

      {showHint ? (
        <div className="mt-3 rounded-2xl border border-teal-100 bg-teal-50 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-700">
            Подсказка
          </div>
          <div className="mt-1 text-sm font-medium text-teal-950">{positionHint}</div>
        </div>
      ) : null}

    </section>
  );
}
