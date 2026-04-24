import { useEffect, useRef, useState } from 'react';
import { CameraPanel } from './components/CameraPanel';
import { RegistrationForm } from './components/RegistrationForm';
import { UserCard } from './components/UserCard';
import { deleteUser, identifyUser, registerUser } from './lib/api';
import type { RegisterPayload, UserDto } from './types/api';

type AppState =
  | 'idle'
  | 'camera_ready'
  | 'detecting_face'
  | 'capture_in_progress'
  | 'identify_loading'
  | 'user_found'
  | 'user_not_found'
  | 'register_loading'
  | 'register_success'
  | 'delete_loading'
  | 'error';

type Detector = {
  estimateFaces: (
    input: HTMLVideoElement | HTMLCanvasElement,
    config?: { flipHorizontal?: boolean },
  ) => Promise<FaceEstimate[]>;
  dispose: () => Promise<void> | void;
};
type Keypoint = { x: number; y: number; z?: number };
type FaceEstimate = {
  boundingBox: {
    xCenter: number;
    yCenter: number;
    width: number;
    height: number;
  };
  keypoints: Keypoint[];
};

declare global {
  interface Window {
    FaceDetection?: new (config?: { locateFile?: (path: string, prefix?: string) => string }) => {
      setOptions: (options: Record<string, unknown>) => void;
      onResults: (callback: (results: { detections?: Array<{ boundingBox: { xCenter: number; yCenter: number; width: number; height: number }; landmarks?: Array<{ x: number; y: number; z: number }> }> }) => void) => void;
      send: (input: { image: HTMLVideoElement | HTMLCanvasElement }) => Promise<void>;
      close: () => Promise<void>;
      initialize?: () => Promise<void>;
    };
  }
}

interface LiveMetrics {
  faceDetected: boolean;
  multipleFaces: boolean;
  faceStateLabel: string;
  positionHint: string;
}

interface FrameAssessment {
  faceLabel: string;
  hint: string;
}

const STATUS_DEFAULT =
  'Запустите камеру. Поместите лицо в овал, и система сама отберет серию качественных кадров для проверки.';

const STABLE_FRAME_THRESHOLD = 10;
const CAPTURE_COUNT = 3;
const CAPTURE_DELAY_MS = 140;
const DETECTION_INPUT_MAX_WIDTH = 640;
const CAPTURE_MAX_WIDTH = 720;
const CAPTURE_JPEG_QUALITY = 0.82;

class BrowserFaceDetectionDetector implements Detector {
  private constructor(
    private readonly faceDetection: NonNullable<Window['FaceDetection']> extends new (
      ...args: never[]
    ) => infer T
      ? T
      : never,
  ) {}

  private faces: FaceEstimate[] = [];

  static async create(): Promise<BrowserFaceDetectionDetector> {
    if (!window.FaceDetection) {
      await new Promise<void>((resolve, reject) => {
        const existingScript = document.querySelector<HTMLScriptElement>(
          'script[data-mediapipe-face-detection="true"]',
        );

        if (existingScript) {
          existingScript.addEventListener('load', () => resolve(), { once: true });
          existingScript.addEventListener(
            'error',
            () => reject(new Error('Не удалось загрузить runtime MediaPipe Face Detection.')),
            { once: true },
          );
          if (window.FaceDetection) {
            resolve();
          }
          return;
        }

        const script = document.createElement('script');
        script.src = '/mediapipe/face_detection/face_detection.js';
        script.async = true;
        script.dataset.mediapipeFaceDetection = 'true';
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error('Не удалось загрузить runtime MediaPipe Face Detection.'));
        document.head.appendChild(script);
      });
    }

    if (!window.FaceDetection) {
      throw new Error('Face Detection runtime не инициализировался в браузере.');
    }

    const runtime = new window.FaceDetection({
      locateFile: (path: string) => `/mediapipe/face_detection/${path}`,
    });

    runtime.setOptions({
      model: 'short',
      selfieMode: false,
      minDetectionConfidence: 0.55,
    });

    const detector = new BrowserFaceDetectionDetector(runtime);
    runtime.onResults((results) => {
      detector.faces =
        results.detections?.map((detection) => ({
          boundingBox: detection.boundingBox,
          keypoints:
            detection.landmarks?.map((landmark) => ({
              x: landmark.x * detector.width,
              y: landmark.y * detector.height,
              z: landmark.z * detector.width,
            })) ?? [],
        })) ?? [];
    });

    if (typeof runtime.initialize === 'function') {
      await runtime.initialize();
    }

    return detector;
  }

  private width = 0;
  private height = 0;
  private selfieMode = false;

  async estimateFaces(
    input: HTMLVideoElement | HTMLCanvasElement,
    config?: { flipHorizontal?: boolean },
  ): Promise<FaceEstimate[]> {
    this.width = input instanceof HTMLVideoElement ? input.videoWidth : input.width;
    this.height = input instanceof HTMLVideoElement ? input.videoHeight : input.height;

    const shouldMirror = Boolean(config?.flipHorizontal);
    if (shouldMirror !== this.selfieMode) {
      this.selfieMode = shouldMirror;
      this.faceDetection.setOptions({ selfieMode: this.selfieMode });
    }

    await this.faceDetection.send({ image: input });
    return this.faces;
  }

  async dispose() {
    await this.faceDetection.close();
  }
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const getSourceSize = (source: HTMLVideoElement | HTMLCanvasElement) => {
  if (source instanceof HTMLVideoElement) {
    return {
      width: source.videoWidth,
      height: source.videoHeight,
    };
  }

  return {
    width: source.width,
    height: source.height,
  };
};

const prepareDetectionFrame = (
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): HTMLCanvasElement => {
  const scale = Math.min(1, DETECTION_INPUT_MAX_WIDTH / video.videoWidth);
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

  const context = canvas.getContext('2d', { willReadFrequently: false });
  if (!context) {
    return canvas;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.filter = 'brightness(0.9) contrast(1.12) saturate(0.96)';
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  context.filter = 'none';

  return canvas;
};

const measureExposure = (
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): { tooBright: boolean; tooDark: boolean } => {
  canvas.width = 96;
  canvas.height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * canvas.width));

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return { tooBright: false, tooDark: false };
  }

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let brightPixels = 0;
  let darkPixels = 0;

  for (let index = 0; index < data.length; index += 4) {
    const luma = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
    if (luma > 238) {
      brightPixels += 1;
    } else if (luma < 28) {
      darkPixels += 1;
    }
  }

  const pixels = data.length / 4;
  return {
    tooBright: brightPixels / pixels > 0.22,
    tooDark: darkPixels / pixels > 0.38,
  };
};

const getAbsoluteBoundingBox = (
  face: FaceEstimate,
  source: HTMLVideoElement | HTMLCanvasElement,
  margin = 0,
) => {
  const sourceSize = getSourceSize(source);
  const { xCenter, yCenter, width, height } = face.boundingBox;
  const boxWidth = width * sourceSize.width;
  const boxHeight = height * sourceSize.height;
  const expandedWidth = boxWidth * (1 + margin * 2);
  const expandedHeight = boxHeight * (1 + margin * 2);
  const centerX = xCenter * sourceSize.width;
  const centerY = yCenter * sourceSize.height;

  const left = Math.max(0, centerX - expandedWidth / 2);
  const top = Math.max(0, centerY - expandedHeight / 2);
  const right = Math.min(sourceSize.width, centerX + expandedWidth / 2);
  const bottom = Math.min(sourceSize.height, centerY + expandedHeight / 2);

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top)),
  };
};

const captureFrame = async (video: HTMLVideoElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, CAPTURE_MAX_WIDTH / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

    const context = canvas.getContext('2d');
    if (!context) {
      reject(new Error('Не удалось подготовить canvas для кадра.'));
      return;
    }

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.filter = 'brightness(0.93) contrast(1.08)';
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    context.filter = 'none';

    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Не удалось сохранить кадр с камеры.'));
        return;
      }
      resolve(blob);
    }, 'image/jpeg', CAPTURE_JPEG_QUALITY);
  });

const buildFrameAssessment = (
  face: FaceEstimate,
  source: HTMLVideoElement | HTMLCanvasElement,
): FrameAssessment => {
  const sourceSize = getSourceSize(source);
  const bbox = getAbsoluteBoundingBox(face, source, 0);
  const centerXRatio = (bbox.x + bbox.width / 2) / sourceSize.width;
  const centerYRatio = (bbox.y + bbox.height / 2) / sourceSize.height;
  const widthRatio = bbox.width / sourceSize.width;
  const heightRatio = bbox.height / sourceSize.height;

  const leftEye = face.keypoints[0];
  const rightEye = face.keypoints[1];
  const rollDegrees =
    leftEye && rightEye
      ? (Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x) * 180) / Math.PI
      : 0;

  const offsetX = Math.abs(centerXRatio - 0.5);
  const offsetY = Math.abs(centerYRatio - 0.48);

  let hint = '';
  if (widthRatio < 0.13 || heightRatio < 0.17) {
    hint = 'Подойдите немного ближе, чтобы лицо заполнило овал.';
  } else if (widthRatio > 0.46 || heightRatio > 0.62) {
    hint = 'Отодвиньтесь совсем немного, чтобы лицо полностью поместилось в овал.';
  } else if (offsetX > 0.14) {
    hint = 'Сместитесь в центр овала.';
  } else if (centerYRatio < 0.24) {
    hint = 'Опустите лицо чуть ниже, в центр овала.';
  } else if (centerYRatio > 0.7) {
    hint = 'Поднимите лицо чуть выше, в центр овала.';
  } else if (Math.abs(rollDegrees) > 12) {
    hint = 'Держите голову ровнее, без сильного наклона.';
  }

  const centerPenalty =
    offsetX * 1.5 + offsetY * 1.15;
  const rollPenalty = Math.min(1, Math.abs(rollDegrees) / 22);
  const sizePenalty =
    widthRatio < 0.15
      ? (0.15 - widthRatio) * 3.2
      : widthRatio > 0.42
        ? (widthRatio - 0.42) * 3
        : 0;
  const isWellPositioned =
    Math.max(0, 1 - Math.min(0.8, centerPenalty) - rollPenalty * 0.25 - Math.min(0.35, sizePenalty)) >=
    0.75;

  return {
    faceLabel: isWellPositioned ? 'Лицо в нужном положении' : 'Лицо обнаружено',
    hint,
  };
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const resultSectionRef = useRef<HTMLDivElement>(null);
  const registrationSectionRef = useRef<HTMLDivElement>(null);
  const successSectionRef = useRef<HTMLDivElement>(null);
  const errorSectionRef = useRef<HTMLDivElement>(null);
  const detectorRef = useRef<Detector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const framesRef = useRef<Blob[] | null>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const exposureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const processingRef = useRef(false);
  const stableFramesRef = useRef(0);
  const captureLockedRef = useRef(false);
  const autoCaptureEnabledRef = useRef(false);

  const [appState, setAppState] = useState<AppState>('idle');
  const [statusMessage, setStatusMessage] = useState<string>(STATUS_DEFAULT);
  const [loadingModels, setLoadingModels] = useState(false);
  const [foundUser, setFoundUser] = useState<UserDto | null>(null);
  const [registerMessage, setRegisterMessage] = useState<string>('');
  const [currentPrompt, setCurrentPrompt] = useState<string>('Поместите лицо в овал');
  const [liveHint, setLiveHint] = useState<string>(
    'Система отберет лучшие кадры, когда лицо окажется внутри овала.',
  );
  const [metrics, setMetrics] = useState<LiveMetrics>({
    faceDetected: false,
    multipleFaces: false,
    faceStateLabel: 'Ожидание лица',
    positionHint: '',
  });

  const resetResults = () => {
    setFoundUser(null);
    setRegisterMessage('');
  };

  const resetLiveMetrics = () => {
    setMetrics({
      faceDetected: false,
      multipleFaces: false,
      faceStateLabel: 'Ожидание лица',
      positionHint: '',
    });
  };

  const clearLiveFeedback = () => {
    setMetrics((current) => ({
      ...current,
      positionHint: '',
      multipleFaces: false,
    }));
  };

  const stopDetectionLoop = () => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const stopCamera = () => {
    stopDetectionLoop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    framesRef.current = null;
    autoCaptureEnabledRef.current = false;
    captureLockedRef.current = false;
    processingRef.current = false;
    stableFramesRef.current = 0;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setStatusMessage(STATUS_DEFAULT);
    setCurrentPrompt('Поместите лицо в овал');
    setLiveHint('Система отберет лучшие кадры, когда лицо окажется внутри овала.');
    resetLiveMetrics();
    setAppState('idle');
  };

  useEffect(() => {
    return () => {
      stopCamera();
      void detectorRef.current?.dispose();
    };
  }, []);

  useEffect(() => {
    const scrollToSection = (element: HTMLDivElement | HTMLElement | null) => {
      if (!element || typeof window === 'undefined') {
        return;
      }

      window.setTimeout(() => {
        const top = element.getBoundingClientRect().top + window.scrollY - 20;
        window.scrollTo({ top, behavior: 'smooth' });
      }, 180);
    };

    if (appState === 'user_found' || appState === 'delete_loading') {
      scrollToSection(resultSectionRef.current);
    } else if (appState === 'user_not_found' || appState === 'register_loading') {
      scrollToSection(registrationSectionRef.current);
    } else if (appState === 'register_success') {
      scrollToSection(successSectionRef.current);
    } else if (appState === 'error') {
      scrollToSection(errorSectionRef.current);
    }
  }, [appState]);

  const ensureDetector = async (): Promise<Detector> => {
    if (detectorRef.current) {
      return detectorRef.current;
    }

    setLoadingModels(true);
    try {
      const detector = await BrowserFaceDetectionDetector.create();
      detectorRef.current = detector;
      return detector;
    } finally {
      setLoadingModels(false);
    }
  };

  const startCamera = async (): Promise<boolean> => {
    try {
      resetResults();
      framesRef.current = null;
      autoCaptureEnabledRef.current = false;
      captureLockedRef.current = false;
      setStatusMessage('Запрашиваем доступ к веб-камере...');
      setCurrentPrompt('Подготовка камеры');
      setLiveHint('Разрешите браузеру доступ к веб-камере.');

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Браузер не предоставляет доступ к камере в текущем контексте.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: window.matchMedia('(max-width: 640px)').matches ? 720 : 960 },
          height: { ideal: window.matchMedia('(max-width: 640px)').matches ? 960 : 720 },
          aspectRatio: { ideal: window.matchMedia('(max-width: 640px)').matches ? 0.75 : 1.333 },
          facingMode: 'user',
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setAppState('camera_ready');
      setStatusMessage('Камера готова. Смотрите прямо в камеру и начните подготовку кадров.');
      setCurrentPrompt('Поместите лицо в овал');
      setLiveHint('Когда лицо окажется внутри овала и нужного размера, система сама соберет серию кадров.');
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Не удалось получить доступ к камере';
      setAppState('error');
      setStatusMessage(message);
      return false;
    }
  };

  const runIdentify = async (frames: Blob[]) => {
    setAppState('identify_loading');
    setStatusMessage('Проверяем кадры и ищем совпадение.');
    setCurrentPrompt('Идет проверка');
    setLiveHint('Сначала проверяем, что перед камерой живой человек, затем ищем совпадение.');
    clearLiveFeedback();

    try {
      const response = await identifyUser(frames);

      if (response.found) {
        autoCaptureEnabledRef.current = false;
        setFoundUser(response.user);
        framesRef.current = null;
        setAppState('user_found');
        setStatusMessage('Пользователь найден. Совпадение подтверждено.');
        setCurrentPrompt('Идентификация завершена');
        setLiveHint('Карточка пользователя отображается ниже.');
        return;
      }

      autoCaptureEnabledRef.current = false;
      setAppState('user_not_found');
      setStatusMessage(
        'Пользователь не найден. Заполните форму ниже: для регистрации будет использована та же серия кадров.',
      );
      setCurrentPrompt('Пользователь не найден');
      setLiveHint('Кадры уже сохранены в памяти фронтенда и будут повторно отправлены при регистрации.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось выполнить проверку';
      if (message.includes('спуфинга')) {
        autoCaptureEnabledRef.current = false;
        setAppState('error');
        setStatusMessage(
          'Проверка не пройдена. Изображение выглядит подозрительно. Попробуйте еще раз при ровном свете и без бликов.',
        );
        setCurrentPrompt('Подготовьте новую серию кадров');
        setLiveHint(
          'Смотрите прямо в камеру, избегайте сильных пересветов, тряски и ярких отражений на лице.',
        );
        framesRef.current = null;
        return;
      }

      autoCaptureEnabledRef.current = false;
      setAppState('error');
      setStatusMessage(message);
    }
  };

  const captureSequence = async (detector: Detector, video: HTMLVideoElement): Promise<Blob[]> => {
    const frames: Blob[] = [];

    setAppState('capture_in_progress');
    setCurrentPrompt('Подготовка кадров');
    setLiveHint(`Сохраняем серию из ${CAPTURE_COUNT} оптимизированных кадров с небольшим интервалом.`);
    setStatusMessage('Подготавливаем серию кадров.');

    for (let index = 0; index < CAPTURE_COUNT; index += 1) {
      const analysisCanvas =
        analysisCanvasRef.current ?? (analysisCanvasRef.current = document.createElement('canvas'));
      const analysisFrame = prepareDetectionFrame(video, analysisCanvas);
      const faces = await detector.estimateFaces(analysisFrame, { flipHorizontal: false });
      if (faces.length !== 1) {
        throw new Error('Во время съемки серия кадров прервалась: лицо исчезло из кадра.');
      }

      const assessment = buildFrameAssessment(faces[0], analysisFrame);
      if (assessment.hint) {
        throw new Error('Во время съемки серия кадров прервалась. Положение лица стало неподходящим.');
      }

      frames.push(await captureFrame(video));
      setLiveHint(`Сохранено кадров: ${index + 1} из ${CAPTURE_COUNT}.`);

      if (index < CAPTURE_COUNT - 1) {
        await sleep(CAPTURE_DELAY_MS);
      }
    }

    return frames;
  };

  const handleStartCheck = async () => {
    if (!videoRef.current || !streamRef.current) {
      setAppState('error');
      setStatusMessage('Не удалось подготовить камеру. Попробуйте начать проверку еще раз.');
      return;
    }

    stopDetectionLoop();
    resetResults();
    framesRef.current = null;
    autoCaptureEnabledRef.current = true;
    captureLockedRef.current = false;
    processingRef.current = false;
    stableFramesRef.current = 0;
    setAppState('detecting_face');
    setStatusMessage('Ищем лицо и проверяем качество кадра...');
    setCurrentPrompt('Поместите лицо в овал');
    setLiveHint('Когда лицо окажется внутри овала и нужного размера, серия кадров будет собрана автоматически.');
    resetLiveMetrics();

    try {
      const detector = await ensureDetector();
      const video = videoRef.current;

      if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
        throw new Error('Видеопоток еще не готов. Подождите секунду и запустите проверку снова.');
      }

      const tick = async () => {
        if (!video || captureLockedRef.current || !autoCaptureEnabledRef.current) {
          return;
        }

        if (processingRef.current) {
          rafRef.current = window.requestAnimationFrame(() => {
            void tick();
          });
          return;
        }

        processingRef.current = true;
        try {
          const analysisCanvas =
            analysisCanvasRef.current ?? (analysisCanvasRef.current = document.createElement('canvas'));
          const exposureCanvas =
            exposureCanvasRef.current ?? (exposureCanvasRef.current = document.createElement('canvas'));
          const exposure = measureExposure(video, exposureCanvas);
          const analysisFrame = prepareDetectionFrame(video, analysisCanvas);
          const faces = await detector.estimateFaces(analysisFrame, { flipHorizontal: false });

          if (faces.length === 0) {
            stableFramesRef.current = 0;
            setAppState('detecting_face');
            setStatusMessage(
              exposure.tooBright
                ? 'Кадр пересвечен, из-за этого лицо может не фиксироваться.'
                : 'Лицо не обнаружено. Поместите лицо в овал.',
            );
            setCurrentPrompt(exposure.tooBright ? 'Слишком яркий свет' : 'Лицо не обнаружено');
            setLiveHint(
              exposure.tooBright
                ? 'Уберите прямой свет с лица или немного уменьшите яркость экрана.'
                : exposure.tooDark
                  ? 'Добавьте мягкий свет перед лицом, чтобы камера лучше видела контур.'
                  : 'Смотрите в камеру и удерживайте лицо внутри овала.',
            );
            setMetrics((current) => ({
              ...current,
              faceDetected: false,
              multipleFaces: false,
              faceStateLabel: 'Лицо не обнаружено',
              positionHint: exposure.tooBright
                ? 'Свет должен быть ровным, без белого пятна на лице.'
                : 'Поместите лицо внутрь овала.',
            }));
            return;
          }

          if (faces.length > 1) {
            stableFramesRef.current = 0;
            setStatusMessage('В кадре должно быть только одно лицо.');
            setCurrentPrompt('Оставьте в кадре одного человека');
            setLiveHint('Для отправки серии кадров нужен один человек в кадре.');
            setMetrics((current) => ({
              ...current,
              faceDetected: false,
              multipleFaces: true,
              faceStateLabel: 'Несколько лиц в кадре',
              positionHint: 'Оставьте в кадре только одно лицо.',
            }));
            return;
          }

          const assessment = buildFrameAssessment(faces[0], analysisFrame);
          setMetrics({
            faceDetected: true,
            multipleFaces: false,
            faceStateLabel: assessment.faceLabel,
            positionHint: assessment.hint || (exposure.tooBright ? 'Уберите прямой свет с лица.' : ''),
          });

          if (assessment.hint) {
            stableFramesRef.current = 0;
            setStatusMessage('Ждем, пока кадр станет подходящим для проверки.');
            setCurrentPrompt('Скорректируйте положение лица');
            setLiveHint(assessment.hint);
            return;
          }

          stableFramesRef.current += 1;
          setCurrentPrompt('Удерживайте лицо в овале');
          setLiveHint(
            exposure.tooBright
              ? 'Лицо найдено, но свет слишком яркий. Система попробует выбрать пригодные кадры.'
              : `Стабилизация качества: ${Math.min(stableFramesRef.current, STABLE_FRAME_THRESHOLD)}/${STABLE_FRAME_THRESHOLD}.`,
          );
          setStatusMessage('Кадр подходит. Еще немного удерживайте лицо, и начнется съемка серии.');

          if (stableFramesRef.current < STABLE_FRAME_THRESHOLD) {
            return;
          }

          autoCaptureEnabledRef.current = false;
          captureLockedRef.current = true;
          stopDetectionLoop();
          const frames = await captureSequence(detector, video);
          framesRef.current = frames;
          await runIdentify(frames);
        } catch (error) {
          autoCaptureEnabledRef.current = false;
          captureLockedRef.current = false;
          stopDetectionLoop();
          const message =
            error instanceof Error ? error.message : 'Ошибка во время подготовки кадров';
          setAppState('error');
          setStatusMessage(message);
        } finally {
          processingRef.current = false;
          if (autoCaptureEnabledRef.current && !captureLockedRef.current) {
            rafRef.current = window.requestAnimationFrame(() => {
              void tick();
            });
          }
        }
      };

      rafRef.current = window.requestAnimationFrame(() => {
        void tick();
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Не удалось загрузить модель детекции лица';
      setAppState('error');
      setStatusMessage(message);
    }
  };

  const handleStartFlow = async () => {
    const cameraReady = streamRef.current ? true : await startCamera();
    if (!cameraReady) {
      return;
    }

    window.setTimeout(() => {
      void handleStartCheck();
    }, 180);
  };

  const handleRegister = async (payload: RegisterPayload) => {
    if (!framesRef.current || framesRef.current.length === 0) {
      setAppState('error');
      setStatusMessage('Нет подготовленной серии кадров для регистрации. Пройдите проверку повторно.');
      return;
    }

    setAppState('register_loading');
    setStatusMessage('Сохраняем данные пользователя и серию кадров...');
    setCurrentPrompt('Регистрация пользователя');
    setLiveHint('Проверяем кадры еще раз и сохраняем нового пользователя.');

    try {
      const response = await registerUser(framesRef.current, payload);
      setRegisterMessage(`${response.message} ID: ${response.userId}`);
      framesRef.current = null;
      setAppState('register_success');
      setStatusMessage('Пользователь успешно зарегистрирован.');
      setCurrentPrompt('Регистрация завершена');
      setLiveHint('Новый пользователь добавлен в локальную базу.');
      clearLiveFeedback();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Не удалось зарегистрировать пользователя';
      if (message.includes('спуфинга')) {
        setAppState('error');
        setStatusMessage(
          'Проверка не пройдена. Подготовьте новую серию кадров и повторите попытку при более ровном свете.',
        );
        setCurrentPrompt('Подготовьте новую серию кадров');
        setLiveHint(
          'Лучше смотреть прямо в камеру ноутбука, без движения и без ярких бликов на лице.',
        );
        framesRef.current = null;
        return;
      }

      setAppState('error');
      setStatusMessage(message);
    }
  };

  const handleDeleteUser = async () => {
    if (!foundUser) {
      return;
    }

    const confirmed = window.confirm(
      'Удалить профиль из локальной базы данных? Анкета и биометрический шаблон будут удалены.',
    );
    if (!confirmed) {
      return;
    }

    setAppState('delete_loading');
    setStatusMessage('Удаляем пользователя из локальной базы данных...');
    setCurrentPrompt('Удаление пользователя');
    setLiveHint('Удаляем анкетные данные и биометрический шаблон.');
    clearLiveFeedback();

    try {
      const response = await deleteUser(foundUser.id);
      resetResults();
      framesRef.current = null;
      resetLiveMetrics();
      setAppState(streamRef.current ? 'camera_ready' : 'idle');
      setStatusMessage(response.message);
      setCurrentPrompt('Пользователь удален');
      setLiveHint('Можно начать новую проверку или зарегистрировать нового пользователя.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Не удалось удалить пользователя';
      setAppState('error');
      setStatusMessage(message);
    }
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f5f7fb_0%,#eef7f6_42%,#f8fafc_100%)] px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] text-ink sm:px-5 sm:py-5 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="overflow-hidden rounded-[26px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,_rgba(13,148,136,0.18),_transparent_35%),linear-gradient(135deg,_#ffffff_0%,_#f7fbfb_45%,_#eef7f6_100%)] px-4 py-5 shadow-panel sm:rounded-[30px] sm:px-7 sm:py-7">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-4xl">
              Система биометрической идентификации по лицу
            </h1>
          </div>
        </header>

        <main className="mt-4 space-y-4 sm:mt-5 sm:space-y-5">
          <CameraPanel
            videoRef={videoRef}
            cameraActive={Boolean(streamRef.current)}
            loadingModels={loadingModels}
            faceDetected={metrics.faceDetected}
            multipleFaces={metrics.multipleFaces}
            currentPrompt={currentPrompt}
            liveHint={liveHint}
            checkingActive={
              appState === 'detecting_face' ||
              appState === 'capture_in_progress' ||
              appState === 'identify_loading'
            }
            positionHint={metrics.positionHint}
            faceStateLabel={metrics.faceStateLabel}
            onStartCheck={handleStartFlow}
            onStopCheck={stopCamera}
          />

          <div className="mx-auto max-w-4xl space-y-4 sm:space-y-5">
            {(appState === 'user_found' || appState === 'delete_loading') &&
            foundUser ? (
              <div ref={resultSectionRef} className="scroll-mt-5">
                <UserCard
                  user={foundUser}
                  deleting={appState === 'delete_loading'}
                  onDelete={handleDeleteUser}
                />
              </div>
            ) : null}

            {appState === 'user_not_found' || appState === 'register_loading' ? (
              <div ref={registrationSectionRef} className="scroll-mt-5">
                <RegistrationForm
                  loading={appState === 'register_loading'}
                  onSubmit={handleRegister}
                />
              </div>
            ) : null}

            {appState === 'register_success' ? (
              <section
                ref={successSectionRef}
                className="scroll-mt-5 rounded-[24px] border border-emerald-200 bg-[linear-gradient(180deg,#ecfdf5_0%,#f8fffb_100%)] p-5 shadow-panel"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">
                  Регистрация
                </p>
                <h2 className="mt-1 text-xl font-semibold text-ink">
                  Пользователь зарегистрирован
                </h2>
                <p className="mt-3 text-sm leading-6 text-slate-700">{registerMessage}</p>
              </section>
            ) : null}

              {appState === 'error' ? (
              <section
                ref={errorSectionRef}
                className="rounded-[24px] border border-rose-200 bg-[linear-gradient(180deg,#fff1f2_0%,#ffffff_100%)] p-5 shadow-panel"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-700">
                  Ошибка
                </p>
                <h2 className="mt-1 text-xl font-semibold text-ink">
                  Серию кадров нужно подготовить заново
                </h2>
                <p className="mt-3 text-sm leading-6 text-slate-700">{statusMessage}</p>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Обычно помогает ровный свет, неподвижное положение головы и отсутствие бликов от экрана.
                </p>
              </section>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
