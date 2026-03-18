import { useEffect, useMemo, useRef, useState } from 'react';
import { CameraPanel } from './components/CameraPanel';
import { LivenessStatus, type LivenessStep } from './components/LivenessStatus';
import { RegistrationForm } from './components/RegistrationForm';
import { UserCard } from './components/UserCard';
import { deleteUser, identifyUser, registerUser } from './lib/api';
import type { RegisterPayload, UserDto } from './types/api';

type AppState =
  | 'idle'
  | 'camera_ready'
  | 'detecting_face'
  | 'liveness_in_progress'
  | 'liveness_success'
  | 'identify_loading'
  | 'user_found'
  | 'user_not_found'
  | 'register_loading'
  | 'register_success'
  | 'delete_loading'
  | 'error';

type StepState = Record<'face' | 'blink' | 'turnLeft' | 'turnRight', boolean>;
type ActiveStage = 'center' | 'blink' | 'turnLeft' | 'turnRight' | 'complete';
type Keypoint = { x: number; y: number; z?: number; name?: string };
type FaceEstimate = { keypoints: Keypoint[] };
type Detector = {
  estimateFaces: (input: HTMLVideoElement, config?: { flipHorizontal?: boolean }) => Promise<FaceEstimate[]>;
  dispose: () => void;
};

declare global {
  interface Window {
    FaceMesh?: new (config?: { locateFile?: (path: string, prefix?: string) => string }) => {
      setOptions: (options: Record<string, unknown>) => void;
      onResults: (callback: (results: { multiFaceLandmarks?: Array<Array<{ x: number; y: number; z: number }>> }) => void) => void;
      send: (input: { image: HTMLVideoElement }) => Promise<void>;
      close: () => void;
      initialize?: () => Promise<void>;
    };
  }
}

interface LiveMetrics {
  yaw: number;
  eyeRatio: number;
  alignment: number;
  faceDetected: boolean;
  multipleFaces: boolean;
  faceStateLabel: string;
  headDirectionLabel: string;
  positionHint: string;
}

const initialSteps: StepState = {
  face: false,
  blink: false,
  turnLeft: false,
  turnRight: false,
};

const STATUS_DEFAULT =
  'Подготовьте лицо в центре кадра, обеспечьте хорошее освещение и запустите проверку.';

const LEFT_EYE_INDICES = [362, 385, 387, 263, 373, 380] as const;
const RIGHT_EYE_INDICES = [33, 160, 158, 133, 153, 144] as const;
const NOSE_TIP_INDEX = 1;
const LEFT_CHEEK_INDEX = 234;
const RIGHT_CHEEK_INDEX = 454;
const CENTER_YAW_LIMIT = 0.035;
const TURN_LEFT_THRESHOLD = -0.11;
const TURN_RIGHT_THRESHOLD = 0.11;
const CENTER_HOLD_FRAMES = 8;
const TURN_HOLD_FRAMES = 5;
const BLINK_BASELINE_SMOOTHING = 0.18;
const BLINK_MIN_BASELINE = 0.22;
const BLINK_CALIBRATION_FRAMES = 12;
const BLINK_CLOSE_RATIO = 0.86;
const BLINK_REOPEN_RATIO = 0.94;
const BLINK_MIN_DROP = 0.045;

class BrowserFaceMeshDetector implements Detector {
  private constructor(
    private readonly faceMesh: NonNullable<Window['FaceMesh']> extends new (...args: never[]) => infer T ? T : never,
  ) {}

  private faces: FaceEstimate[] = [];

  static async create(): Promise<BrowserFaceMeshDetector> {
    if (!window.FaceMesh) {
      await new Promise<void>((resolve, reject) => {
        const existingScript = document.querySelector<HTMLScriptElement>(
          'script[data-mediapipe-face-mesh="true"]',
        );

        if (existingScript) {
          existingScript.addEventListener('load', () => resolve(), { once: true });
          existingScript.addEventListener(
            'error',
            () => reject(new Error('Не удалось загрузить runtime MediaPipe FaceMesh.')),
            { once: true },
          );
          if (window.FaceMesh) {
            resolve();
          }
          return;
        }

        const script = document.createElement('script');
        script.src = '/mediapipe/face_mesh/face_mesh.js';
        script.async = true;
        script.dataset.mediapipeFaceMesh = 'true';
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error('Не удалось загрузить runtime MediaPipe FaceMesh.'));
        document.head.appendChild(script);
      });
    }

    if (!window.FaceMesh) {
      throw new Error('FaceMesh runtime не инициализировался в браузере.');
    }

    const faceMesh = new window.FaceMesh({
      locateFile: (path: string) => `/mediapipe/face_mesh/${path}`,
    });

    const detector = new BrowserFaceMeshDetector(faceMesh);
    faceMesh.setOptions({
      refineLandmarks: true,
      selfieMode: false,
      maxNumFaces: 2,
    });
    faceMesh.onResults((results) => {
      detector.faces =
        results.multiFaceLandmarks?.map((landmarks) => ({
          keypoints: landmarks.map((landmark) => ({
            x: landmark.x * detector.width,
            y: landmark.y * detector.height,
            z: landmark.z * detector.width,
          })),
        })) ?? [];
    });

    if (typeof faceMesh.initialize === 'function') {
      await faceMesh.initialize();
    }

    return detector;
  }

  private width = 0;
  private height = 0;
  private selfieMode = false;

  async estimateFaces(
    input: HTMLVideoElement,
    config?: { flipHorizontal?: boolean },
  ): Promise<FaceEstimate[]> {
    this.width = input.videoWidth;
    this.height = input.videoHeight;

    const shouldMirror = Boolean(config?.flipHorizontal);
    if (shouldMirror !== this.selfieMode) {
      this.selfieMode = shouldMirror;
      this.faceMesh.setOptions({ selfieMode: this.selfieMode });
    }

    await this.faceMesh.send({ image: input });
    return this.faces;
  }

  dispose() {
    this.faceMesh.close();
  }
}

const getDistance = (
  pointA: Keypoint,
  pointB: Keypoint,
) => Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);

const getEyeAspectRatio = (
  keypoints: Keypoint[],
  indices: readonly [number, number, number, number, number, number],
) => {
  const [leftCorner, topInner, topOuter, rightCorner, bottomInner, bottomOuter] = indices;
  const horizontal = getDistance(keypoints[leftCorner], keypoints[rightCorner]);
  const vertical =
    (getDistance(keypoints[topInner], keypoints[bottomInner]) +
      getDistance(keypoints[topOuter], keypoints[bottomOuter])) /
    2;

  return vertical / horizontal;
};

const captureFrame = async (video: HTMLVideoElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      reject(new Error('Не удалось получить canvas context'));
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Не удалось сохранить кадр'));
        return;
      }

      resolve(blob);
    }, 'image/jpeg', 0.92);
  });

const buildPositionHint = (
  keypoints: Keypoint[],
  video: HTMLVideoElement,
  yaw: number,
): string => {
  const xs = keypoints.map((point) => point.x);
  const ys = keypoints.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const centerXRatio = (minX + maxX) / 2 / video.videoWidth;
  const centerYRatio = (minY + maxY) / 2 / video.videoHeight;
  const widthRatio = (maxX - minX) / video.videoWidth;
  const heightRatio = (maxY - minY) / video.videoHeight;

  if (widthRatio < 0.18 || heightRatio < 0.24) {
    return 'Подойдите ближе к камере.';
  }

  if (widthRatio > 0.82 || heightRatio > 0.88) {
    return 'Отойдите немного дальше от камеры.';
  }

  if (centerXRatio < 0.36 || centerXRatio > 0.64) {
    return 'Сместите лицо ближе к центру кадра.';
  }

  if (centerYRatio < 0.34) {
    return 'Опустите голову чуть ниже.';
  }

  if (centerYRatio > 0.68) {
    return 'Поднимите голову чуть выше.';
  }

  if (yaw < -0.18) {
    return 'Поверните голову немного влево, чтобы смотреть прямо.';
  }

  if (yaw > 0.18) {
    return 'Поверните голову немного вправо, чтобы смотреть прямо.';
  }

  return '';
};

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectorRef = useRef<Detector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const captureRef = useRef<Blob | null>(null);
  const identifyLockedRef = useRef(false);
  const stepsRef = useRef<StepState>(initialSteps);
  const processingRef = useRef(false);
  const stageRef = useRef<ActiveStage>('center');
  const blinkClosedRef = useRef(false);
  const centerHoldRef = useRef(0);
  const leftHoldRef = useRef(0);
  const rightHoldRef = useRef(0);
  const blinkBaselineRef = useRef(0);
  const blinkCalibrationFramesRef = useRef(0);
  const blinkMinEarRef = useRef(Number.POSITIVE_INFINITY);

  const [appState, setAppState] = useState<AppState>('idle');
  const [statusMessage, setStatusMessage] = useState<string>(STATUS_DEFAULT);
  const [loadingModels, setLoadingModels] = useState(false);
  const [steps, setSteps] = useState<StepState>(initialSteps);
  const [foundUser, setFoundUser] = useState<UserDto | null>(null);
  const [matchScore, setMatchScore] = useState<number | null>(null);
  const [registerMessage, setRegisterMessage] = useState<string>('');
  const [currentPrompt, setCurrentPrompt] = useState<string>('Разместите лицо в зоне сканирования');
  const [liveHint, setLiveHint] = useState<string>('После запуска держите голову ровно и смотрите в камеру.');
  const [metrics, setMetrics] = useState<LiveMetrics>({
    yaw: 0,
    eyeRatio: 0,
    alignment: 0,
    faceDetected: false,
    multipleFaces: false,
    faceStateLabel: 'Ожидание лица',
    headDirectionLabel: 'По центру',
    positionHint: '',
  });

  const stepList = useMemo<LivenessStep[]>(
    () => [
      {
        key: 'face',
        title: 'Обнаружение лица',
        description: 'В кадре должно находиться ровно одно лицо.',
        done: steps.face,
      },
      {
        key: 'blink',
        title: 'Моргание',
        description: 'Коротко моргните для подтверждения активности.',
        done: steps.blink,
      },
      {
        key: 'turnLeft',
        title: 'Поворот вправо',
        description: 'Поверните голову немного вправо.',
        done: steps.turnLeft,
      },
      {
        key: 'turnRight',
        title: 'Поворот влево',
        description: 'Поверните голову немного влево.',
        done: steps.turnRight,
      },
    ],
    [steps],
  );

  const clearLiveFeedback = () => {
    setMetrics((current) => ({
      ...current,
      alignment: 1,
      positionHint: '',
      multipleFaces: false,
    }));
  };

  const resetResults = () => {
    setFoundUser(null);
    setMatchScore(null);
    setRegisterMessage('');
  };

  const resetLiveMetrics = () => {
    setMetrics({
      yaw: 0,
      eyeRatio: 0,
      alignment: 0,
      faceDetected: false,
      multipleFaces: false,
      faceStateLabel: 'Ожидание лица',
      headDirectionLabel: 'По центру',
      positionHint: '',
    });
  };

  const applySteps = (next: StepState) => {
    stepsRef.current = next;
    setSteps(next);
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
    captureRef.current = null;
    identifyLockedRef.current = false;
    processingRef.current = false;
    stageRef.current = 'center';
    blinkClosedRef.current = false;
    blinkBaselineRef.current = 0;
    blinkCalibrationFramesRef.current = 0;
    blinkMinEarRef.current = Number.POSITIVE_INFINITY;
    centerHoldRef.current = 0;
    leftHoldRef.current = 0;
    rightHoldRef.current = 0;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    applySteps({ ...initialSteps });
    setStatusMessage(STATUS_DEFAULT);
    setCurrentPrompt('Разместите лицо в зоне сканирования');
    setLiveHint('После запуска держите голову ровно и смотрите в камеру.');
    resetLiveMetrics();
    setAppState('idle');
  };

  useEffect(() => {
    return () => {
      stopCamera();
      detectorRef.current?.dispose();
    };
  }, []);

  const ensureDetector = async (): Promise<Detector> => {
    if (detectorRef.current) {
      return detectorRef.current;
    }

    setLoadingModels(true);

    try {
      const detector = await BrowserFaceMeshDetector.create();
      detectorRef.current = detector;
      return detector;
    } finally {
      setLoadingModels(false);
    }
  };

  const handleStartCamera = async () => {
    try {
      resetResults();
      identifyLockedRef.current = false;
      applySteps({ ...initialSteps });
      setStatusMessage('Запрашиваем доступ к веб-камере...');
      setCurrentPrompt('Подготовка камеры');
      setLiveHint('Разрешите браузеру доступ к webcam.');

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Браузер не предоставляет доступ к камере в текущем контексте.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        await new Promise<void>((resolve) => {
          if (!videoRef.current) {
            resolve();
            return;
          }

          if (videoRef.current.readyState >= 2) {
            resolve();
            return;
          }

          const onLoadedData = () => {
            videoRef.current?.removeEventListener('loadeddata', onLoadedData);
            resolve();
          };

          videoRef.current.addEventListener('loadeddata', onLoadedData, { once: true });
        });
      }

      setAppState('camera_ready');
      setStatusMessage('Камера готова. Смотрите прямо в камеру и запустите сканирование.');
      setCurrentPrompt('Смотрите прямо в камеру');
      setLiveHint('Лицо должно быть по центру, без посторонних людей в кадре.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Не удалось получить доступ к камере';
      setAppState('error');
      setStatusMessage(message);
    }
  };

  const runIdentify = async () => {
    if (!captureRef.current) {
      setAppState('error');
      setStatusMessage('Не удалось подготовить кадр для отправки на сервер.');
      return;
    }

    setAppState('identify_loading');
    setStatusMessage('Проверка активности завершена. Отправляем кадр на сервер для распознавания...');
    setCurrentPrompt('Идентификация пользователя');
    setLiveHint('Ожидаем ответ сервиса распознавания.');
    clearLiveFeedback();

    try {
      const response = await identifyUser(captureRef.current);

      if (response.found) {
        setFoundUser(response.user);
        setMatchScore(response.score);
        captureRef.current = null;
        setAppState('user_found');
        setStatusMessage('Пользователь найден. Совпадение успешно подтверждено сервером.');
        setCurrentPrompt('Идентификация завершена');
        setLiveHint('Карточка пользователя отображается ниже.');
        clearLiveFeedback();
        return;
      }

      setAppState('user_not_found');
      setStatusMessage(
        'Лицо не найдено в системе. Заполните форму ниже, чтобы зарегистрировать пользователя.',
      );
      setCurrentPrompt('Лицо не найдено');
      setLiveHint('Используется тот же кадр, который был захвачен после успешной проверки.');
      clearLiveFeedback();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Ошибка при отправке данных на сервер';
      setAppState('error');
      setStatusMessage(message);
    }
  };

  const handleStartCheck = async () => {
    if (!videoRef.current || !streamRef.current) {
      setAppState('error');
      setStatusMessage('Сначала запустите камеру.');
      return;
    }

    stopDetectionLoop();
    resetResults();
    identifyLockedRef.current = false;
    processingRef.current = false;
    stageRef.current = 'center';
    blinkClosedRef.current = false;
    blinkBaselineRef.current = 0;
    blinkCalibrationFramesRef.current = 0;
    blinkMinEarRef.current = Number.POSITIVE_INFINITY;
    centerHoldRef.current = 0;
    leftHoldRef.current = 0;
    rightHoldRef.current = 0;
    applySteps({ ...initialSteps });
    setAppState('detecting_face');
    setStatusMessage('Загружаем модель и ищем лицо в кадре...');
    setCurrentPrompt('Зафиксируйте лицо по центру');
    setLiveHint('Небольшая пауза нужна для стабилизации положения лица.');
    resetLiveMetrics();

    try {
      const detector = await ensureDetector();
      const video = videoRef.current;

      if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
        setAppState('error');
        setStatusMessage('Видеопоток еще не готов. Подождите секунду и запустите сканирование снова.');
        setCurrentPrompt('Подождите готовности камеры');
        setLiveHint('Камере нужно немного времени, чтобы инициализировать поток.');
        return;
      }

      const tick = async () => {
        if (!video || identifyLockedRef.current) {
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
          const faces = await detector.estimateFaces(video, { flipHorizontal: false });

          if (faces.length === 0) {
            setAppState('detecting_face');
            setStatusMessage('Лицо не обнаружено. Убедитесь, что вы находитесь в центре кадра.');
            setCurrentPrompt('Лицо не обнаружено');
            setLiveHint('Подойдите ближе и расположите лицо внутри рамки.');
            setMetrics((current) => ({
              ...current,
              faceDetected: false,
              multipleFaces: false,
              alignment: 0,
              faceStateLabel: 'Лицо не обнаружено',
              headDirectionLabel: 'По центру',
              positionHint: 'Расположите лицо внутри рамки.',
            }));
            centerHoldRef.current = 0;
            leftHoldRef.current = 0;
            rightHoldRef.current = 0;
            return;
          }

          if (faces.length > 1) {
            setAppState('detecting_face');
            setStatusMessage('В кадре должно быть только одно лицо.');
            setCurrentPrompt('Оставьте в кадре одно лицо');
            setLiveHint('Для биометрической проверки нужен один человек в кадре.');
            setMetrics((current) => ({
              ...current,
              faceDetected: false,
              multipleFaces: true,
              alignment: 0,
              faceStateLabel: 'Несколько лиц в кадре',
              headDirectionLabel: 'По центру',
              positionHint: 'В кадре должен находиться один человек.',
            }));
            centerHoldRef.current = 0;
            leftHoldRef.current = 0;
            rightHoldRef.current = 0;
            return;
          }

          const face = faces[0];
          const keypoints = face.keypoints;

          if (
            !keypoints[LEFT_EYE_INDICES[0]] ||
            !keypoints[RIGHT_EYE_INDICES[0]] ||
            !keypoints[NOSE_TIP_INDEX] ||
            !keypoints[LEFT_CHEEK_INDEX] ||
            !keypoints[RIGHT_CHEEK_INDEX]
          ) {
            setStatusMessage('Не удалось стабильно определить ключевые точки лица.');
            setCurrentPrompt('Стабилизируйте положение лица');
            setLiveHint('Смотрите прямо в камеру без резких движений.');
            return;
          }

          setAppState('liveness_in_progress');

          const leftEar = getEyeAspectRatio(keypoints, LEFT_EYE_INDICES);
          const rightEar = getEyeAspectRatio(keypoints, RIGHT_EYE_INDICES);
          const averageEar = (leftEar + rightEar) / 2;

          const nose = keypoints[NOSE_TIP_INDEX];
          const leftCheek = keypoints[LEFT_CHEEK_INDEX];
          const rightCheek = keypoints[RIGHT_CHEEK_INDEX];
          const faceCenterX = (leftCheek.x + rightCheek.x) / 2;
          const faceWidth = Math.max(1, rightCheek.x - leftCheek.x);
          const yaw = (nose.x - faceCenterX) / faceWidth;
          const positionHint = buildPositionHint(keypoints, video, yaw);
          const alignment = Math.max(
            0,
            1 - Math.min(1, Math.abs(yaw) / 0.22) - (positionHint ? 0.18 : 0),
          );

          setMetrics({
            yaw,
            eyeRatio: averageEar,
            alignment,
            faceDetected: true,
            multipleFaces: false,
            faceStateLabel: 'Лицо зафиксировано',
            headDirectionLabel:
              Math.abs(yaw) < 0.06 ? 'По центру' : yaw < 0 ? 'Повернута вправо' : 'Повернута влево',
            positionHint,
          });

          const currentSteps = stepsRef.current;
          const latestSteps: StepState = { ...currentSteps };

          if (stageRef.current !== 'blink' && averageEar > BLINK_MIN_BASELINE) {
            blinkBaselineRef.current =
              blinkBaselineRef.current === 0
                ? averageEar
                : blinkBaselineRef.current * (1 - BLINK_BASELINE_SMOOTHING) +
                  averageEar * BLINK_BASELINE_SMOOTHING;
          }

          const blinkBaseline = Math.max(blinkBaselineRef.current, BLINK_MIN_BASELINE);
          const blinkClosedThreshold = blinkBaseline * BLINK_CLOSE_RATIO;
          const blinkReopenThreshold = blinkBaseline * BLINK_REOPEN_RATIO;

          if (!currentSteps.face) {
            if (positionHint) {
              centerHoldRef.current = 0;
              setCurrentPrompt('Скорректируйте положение лица');
              setLiveHint(positionHint);
              setStatusMessage('Система ждет, пока лицо окажется в правильном положении.');
              return;
            }

            if (Math.abs(yaw) <= CENTER_YAW_LIMIT) {
              centerHoldRef.current += 1;
            } else {
              centerHoldRef.current = 0;
            }

            setCurrentPrompt('Удерживайте голову прямо');
            setLiveHint(`Стабилизация ${Math.min(centerHoldRef.current, CENTER_HOLD_FRAMES)}/${CENTER_HOLD_FRAMES}`);

            if (centerHoldRef.current >= CENTER_HOLD_FRAMES) {
              latestSteps.face = true;
              stageRef.current = 'blink';
              setStatusMessage('Лицо стабильно зафиксировано. Теперь моргните один раз.');
            } else {
              setStatusMessage('Держите голову прямо, пока система фиксирует лицо.');
            }
          } else if (!currentSteps.blink) {
            stageRef.current = 'blink';
            setCurrentPrompt('Моргните один раз');
            if (
              blinkCalibrationFramesRef.current < BLINK_CALIBRATION_FRAMES &&
              averageEar > BLINK_MIN_BASELINE
            ) {
              blinkCalibrationFramesRef.current += 1;
              blinkBaselineRef.current =
                blinkBaselineRef.current === 0
                  ? averageEar
                  : blinkBaselineRef.current * (1 - BLINK_BASELINE_SMOOTHING) +
                    averageEar * BLINK_BASELINE_SMOOTHING;
            }

            const lockedBaseline = Math.max(blinkBaselineRef.current, BLINK_MIN_BASELINE);
            const lockedCloseThreshold = Math.min(
              lockedBaseline - BLINK_MIN_DROP * 0.5,
              lockedBaseline * BLINK_CLOSE_RATIO,
            );
            const lockedReopenThreshold = lockedBaseline * BLINK_REOPEN_RATIO;

            blinkMinEarRef.current = Math.min(blinkMinEarRef.current, averageEar);

            setLiveHint(
              `EAR ${averageEar.toFixed(3)} / baseline ${lockedBaseline.toFixed(3)} / min ${blinkMinEarRef.current.toFixed(3)}.`,
            );

            if (
              averageEar < lockedCloseThreshold ||
              blinkMinEarRef.current <= lockedBaseline - BLINK_MIN_DROP
            ) {
              blinkClosedRef.current = true;
            }

            if (
              blinkClosedRef.current &&
              averageEar > lockedReopenThreshold &&
              blinkMinEarRef.current <= lockedBaseline - BLINK_MIN_DROP
            ) {
              latestSteps.blink = true;
              blinkClosedRef.current = false;
              blinkMinEarRef.current = Number.POSITIVE_INFINITY;
              stageRef.current = 'turnLeft';
              setStatusMessage('Моргание зафиксировано. Поверните голову вправо.');
            } else {
              setStatusMessage('Ожидается моргание.');
            }
          } else if (!currentSteps.turnLeft) {
            stageRef.current = 'turnLeft';
            setCurrentPrompt('Поверните голову вправо');
            setLiveHint(`Удержание ${Math.min(leftHoldRef.current, TURN_HOLD_FRAMES)}/${TURN_HOLD_FRAMES}`);

            if (yaw <= TURN_LEFT_THRESHOLD) {
              leftHoldRef.current += 1;
            } else {
              leftHoldRef.current = 0;
            }

            setStatusMessage('Плавно поверните голову вправо.');

            if (leftHoldRef.current >= TURN_HOLD_FRAMES) {
              latestSteps.turnLeft = true;
              stageRef.current = 'turnRight';
              setStatusMessage('Поворот вправо зафиксирован. Теперь поверните голову влево.');
            }
          } else if (!currentSteps.turnRight) {
            stageRef.current = 'turnRight';
            setCurrentPrompt('Поверните голову влево');
            setLiveHint(`Удержание ${Math.min(rightHoldRef.current, TURN_HOLD_FRAMES)}/${TURN_HOLD_FRAMES}`);

            if (yaw >= TURN_RIGHT_THRESHOLD) {
              rightHoldRef.current += 1;
            } else {
              rightHoldRef.current = 0;
            }

            setStatusMessage('Плавно поверните голову влево.');

            if (rightHoldRef.current >= TURN_HOLD_FRAMES) {
              latestSteps.turnRight = true;
              stageRef.current = 'complete';
            }
          }

          if (
            latestSteps.face !== currentSteps.face ||
            latestSteps.blink !== currentSteps.blink ||
            latestSteps.turnLeft !== currentSteps.turnLeft ||
            latestSteps.turnRight !== currentSteps.turnRight
          ) {
            applySteps(latestSteps);
          }

          if (!latestSteps.turnRight) {
            return;
          }

          identifyLockedRef.current = true;
          stopDetectionLoop();
          captureRef.current = await captureFrame(video);
          setAppState('liveness_success');
          setCurrentPrompt('Проверка завершена');
          setLiveHint('Кадр захвачен, выполняется идентификация.');
          setStatusMessage('Все шаги проверки активности успешно пройдены.');
          await runIdentify();
        } catch (error) {
          identifyLockedRef.current = false;
          stopDetectionLoop();
          const message =
            error instanceof Error ? error.message : 'Ошибка во время анализа видео';
          setAppState('error');
          setStatusMessage(message);
        } finally {
          processingRef.current = false;
          if (!identifyLockedRef.current) {
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
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить модель детекции лица';
      setAppState('error');
      setStatusMessage(message);
    }
  };

  const handleRegister = async (payload: RegisterPayload) => {
    if (!captureRef.current) {
      setAppState('error');
      setStatusMessage('Нет сохраненного кадра для регистрации. Пройдите проверку повторно.');
      return;
    }

    setAppState('register_loading');
    setStatusMessage('Отправляем данные нового пользователя на сервер...');
    setCurrentPrompt('Регистрация пользователя');
    setLiveHint('Сохраняем биометрические данные и анкету.');

    try {
      const response = await registerUser(captureRef.current, payload);
      setRegisterMessage(`${response.message} ID: ${response.userId}`);
      captureRef.current = null;
      setAppState('register_success');
      setStatusMessage('Пользователь успешно зарегистрирован.');
      setCurrentPrompt('Регистрация завершена');
      setLiveHint('Новый пользователь успешно добавлен в систему.');
      clearLiveFeedback();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Не удалось зарегистрировать пользователя';
      setAppState('error');
      setStatusMessage(message);
    }
  };

  const handleDeleteUser = async () => {
    if (!foundUser) {
      return;
    }

    const confirmed = window.confirm(
      'Удалить ваш профиль из локальной базы данных? Анкета и биометрический шаблон будут удалены.',
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
      applySteps({ ...initialSteps });
      captureRef.current = null;
      identifyLockedRef.current = false;
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
    <div className="min-h-screen bg-slate-100 bg-grid px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] text-ink sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-[radial-gradient(circle_at_top_left,_rgba(15,118,110,0.22),_transparent_36%),linear-gradient(135deg,_#ffffff_0%,_#f8fafc_45%,_#ecfeff_100%)] p-4 shadow-panel sm:rounded-[32px] sm:p-8">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-teal-700/80 sm:text-xs">
              Биометрическая система
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-5xl">
              Система биометрической идентификации по лицу
            </h1>
          </div>
        </header>

        <main className="mt-4 grid gap-4 sm:mt-6 sm:gap-6 xl:grid-cols-[1.35fr_0.9fr]">
          <div className="space-y-6">
            <CameraPanel
              videoRef={videoRef}
              cameraActive={Boolean(streamRef.current)}
              canStartCheck={Boolean(streamRef.current)}
              loadingModels={loadingModels}
              faceDetected={metrics.faceDetected}
              multipleFaces={metrics.multipleFaces}
              currentPrompt={currentPrompt}
              liveHint={liveHint}
              alignment={metrics.alignment}
              checkingActive={
                appState === 'detecting_face' ||
                appState === 'liveness_in_progress' ||
                appState === 'identify_loading'
              }
              positionHint={metrics.positionHint}
              faceStateLabel={metrics.faceStateLabel}
              headDirectionLabel={metrics.headDirectionLabel}
              onStartCamera={handleStartCamera}
              onStopCamera={stopCamera}
              onStartCheck={handleStartCheck}
            />

            {(appState === 'user_found' || appState === 'delete_loading') &&
            foundUser &&
            matchScore !== null ? (
              <UserCard
                user={foundUser}
                score={matchScore}
                deleting={appState === 'delete_loading'}
                onDelete={handleDeleteUser}
              />
            ) : null}

            {appState === 'user_not_found' || appState === 'register_loading' ? (
              <RegistrationForm
                loading={appState === 'register_loading'}
                onSubmit={handleRegister}
              />
            ) : null}

            {appState === 'register_success' ? (
              <section className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-5 shadow-panel xl:p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">
                  Регистрация
                </p>
                <h2 className="mt-1 text-xl font-semibold text-ink">
                  Пользователь зарегистрирован
                </h2>
                <p className="mt-3 text-sm leading-6 text-slate-700">{registerMessage}</p>
              </section>
            ) : null}
          </div>

          <div className="space-y-6">
            <LivenessStatus
              appState={appState}
              statusMessage={statusMessage}
              steps={stepList}
              currentPrompt={currentPrompt}
              metrics={metrics}
            />
          </div>
        </main>
      </div>
    </div>
  );
}
