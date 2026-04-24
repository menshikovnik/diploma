from __future__ import annotations

from dataclasses import dataclass
import logging
from pathlib import Path

import cv2
import numpy as np
from uniface import RetinaFace, set_cache_dir
from uniface.constants import MiniFASNetWeights, RetinaFaceWeights
from uniface.spoofing import MiniFASNet


logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger("AntiSpoof")
cv2.setNumThreads(1)


class AntiSpoofError(Exception):
    pass


class SpoofDetectedError(AntiSpoofError):
    pass


@dataclass
class AntiSpoofResult:
    is_real: bool
    score: float
    frame_scores: list[float]
    real_frames: int


class SilentFaceAntiSpoofing:
    def __init__(
        self,
        model_dir: Path,
        threshold: float = 0.95,
        min_real_frames: int = 3,
        model_count: int = 1,
        debug: bool = False,
    ) -> None:
        self.model_dir = model_dir
        self.threshold = threshold
        self.min_real_frames = min_real_frames
        self.model_count = max(1, min(model_count, 2))
        self.debug = debug
        self.debug_dir = self.model_dir / "debug_crops"
        self.detector: RetinaFace | None = None
        self.spoofers: list[tuple[str, MiniFASNet]] = []

        if self.debug:
            self.debug_dir.mkdir(parents=True, exist_ok=True)
            logger.info(
                "Режим отладки anti-spoof включен. Кропы будут сохраняться в %s",
                self.debug_dir.resolve(),
            )

    def ensure_ready(self) -> None:
        if self.detector is not None and self.spoofers:
            return

        self.model_dir.mkdir(parents=True, exist_ok=True)
        set_cache_dir(str(self.model_dir))

        try:
            self.detector = RetinaFace(
                model_name=RetinaFaceWeights.MNET_V2,
                confidence_threshold=0.6,
                providers=["CPUExecutionProvider"],
            )
            available_spoofers = [
                (
                    "MiniFASNet V2",
                    MiniFASNet(
                        model_name=MiniFASNetWeights.V2,
                        providers=["CPUExecutionProvider"],
                    ),
                ),
                (
                    "MiniFASNet V1SE",
                    MiniFASNet(
                        model_name=MiniFASNetWeights.V1SE,
                        providers=["CPUExecutionProvider"],
                    ),
                ),
            ]
            self.spoofers = available_spoofers[: self.model_count]
        except Exception as exc:
            raise AntiSpoofError(f"Не удалось инициализировать anti-spoof пайплайн: {exc}") from exc

    def predict(self, images_bytes: list[bytes]) -> AntiSpoofResult:
        self.ensure_ready()
        if not images_bytes:
            raise AntiSpoofError("Не переданы кадры для anti-spoof проверки.")
        if self.detector is None or not self.spoofers:
            raise AntiSpoofError("Anti-spoof пайплайн не инициализирован.")

        frame_scores: list[float] = []
        real_frames = 0

        logger.info("--- НАЧАЛО ПРОВЕРКИ (%s кадров) ---", len(images_bytes))

        for index, image_bytes in enumerate(images_bytes):
            image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
            if image is None:
                raise AntiSpoofError("Не удалось декодировать один из кадров anti-spoof проверки.")

            score = self._predict_single(image, frame_idx=index)
            frame_scores.append(score)
            if score >= self.threshold:
                real_frames += 1

        score = float(sum(frame_scores) / len(frame_scores))
        required_real_frames = min(self.min_real_frames, len(images_bytes))
        is_real = real_frames >= required_real_frames

        logger.info(
            "ИТОГ: Успешных кадров: %s/%s. Средний real-score: %.4f. Порог: %.4f",
            real_frames,
            len(images_bytes),
            score,
            self.threshold,
        )
        logger.info("РЕЗУЛЬТАТ: %s", "Живой (True)" if is_real else "Фейк (False)")
        logger.info("----------------------------------")

        if not is_real:
            raise SpoofDetectedError("Обнаружена попытка спуфинга.")

        return AntiSpoofResult(
            is_real=True,
            score=score,
            frame_scores=frame_scores,
            real_frames=real_frames,
        )

    def _predict_single(self, image: np.ndarray, frame_idx: int = 0) -> float:
        if self.detector is None or not self.spoofers:
            raise AntiSpoofError("Anti-spoof пайплайн не инициализирован.")

        faces = self.detector.detect(image, max_num=1, metric="max")
        if not faces:
            normalized_image = self._normalize_lighting(image)
            faces = self.detector.detect(normalized_image, max_num=1, metric="max")
            if not faces:
                logger.warning("-> RetinaFace не нашел лицо. Возвращаем скор 0.0")
                return 0.0

        face = faces[0]
        bbox = face.bbox.astype(int).tolist()
        logger.info("-> RetinaFace BBox: %s", bbox)

        real_scores: list[float] = []

        for name, spoofer in self.spoofers:
            try:
                input_tensor = spoofer.preprocess(image, face.bbox)
                outputs = spoofer.session.run([spoofer.output_name], {spoofer.input_name: input_tensor})[0]
                probs = spoofer._softmax(outputs)[0]
                real_score = float(probs[1])
                real_scores.append(real_score)

                if self.debug:
                    bbox_xywh = spoofer._xyxy_to_xywh(face.bbox)
                    crop = spoofer._crop_face(image, bbox_xywh)
                    debug_name = name.lower().replace(" ", "_")
                    cv2.imwrite(str(self.debug_dir / f"frame{frame_idx}_{debug_name}.jpg"), crop)

                logger.info(
                    "   [%s] fake_screen=%.4f real=%.4f fake_print=%.4f",
                    name,
                    float(probs[0]),
                    real_score,
                    float(probs[2]),
                )
            except Exception as exc:
                raise AntiSpoofError(
                    f"Ошибка инференса anti-spoof на кадре {frame_idx + 1} ({name}): {exc}"
                ) from exc

        combined_score = float(sum(real_scores) / len(real_scores))
        logger.info("   [Ensemble] combined_real_score=%.4f", combined_score)
        return combined_score

    def _normalize_lighting(self, image: np.ndarray) -> np.ndarray:
        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        lightness, channel_a, channel_b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=1.7, tileGridSize=(8, 8))
        normalized_lightness = clahe.apply(lightness)
        normalized = cv2.merge((normalized_lightness, channel_a, channel_b))
        return cv2.cvtColor(normalized, cv2.COLOR_LAB2BGR)
