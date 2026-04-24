from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from collections import OrderedDict
from urllib.request import urlretrieve

import cv2
import numpy as np
import torch
from facenet_pytorch import InceptionResnetV1

cv2.setNumThreads(1)
torch.set_num_threads(1)


class FaceEngineError(Exception):
    pass


class InvalidImageError(FaceEngineError):
    pass


class FaceCountError(FaceEngineError):
    pass


@dataclass
class MatchResult:
    found: bool
    score: float
    user: dict | None


class FaceEngine:
    REFERENCE_FIVE_POINTS = np.array(
        [
            [38.2946, 51.6963],
            [73.5318, 51.5014],
            [56.0252, 71.7366],
            [41.5493, 92.3655],
            [70.7299, 92.2041],
        ],
        dtype=np.float32,
    )

    def __init__(
        self,
        model_dir: Path,
        yunet_model_url: str,
        match_threshold: float,
    ) -> None:
        self.model_dir = model_dir
        self.yunet_model_path = model_dir / "face_detection_yunet_2023mar.onnx"
        self.backbone_weights_path = model_dir / "ckpt_epoch_115.pt"
        self.yunet_model_url = yunet_model_url
        self.match_threshold = match_threshold
        self.detector: cv2.FaceDetectorYN | None = None
        self.backbone: InceptionResnetV1 | None = None
        self.device = torch.device("cpu")

    @staticmethod
    def _is_invalid_model_file(path: Path) -> bool:
        if not path.exists() or path.stat().st_size < 1024:
            return True

        head = path.read_bytes()[:128]
        return head.startswith(b"version https://git-lfs.github.com/spec/v1")

    def _download_model(self, url: str, destination: Path) -> None:
        urlretrieve(url, destination)

        if self._is_invalid_model_file(destination):
            raise FaceEngineError(f"Не удалось корректно скачать модель: {destination.name}")

    def ensure_ready(self) -> None:
        self.model_dir.mkdir(parents=True, exist_ok=True)

        if self._is_invalid_model_file(self.yunet_model_path):
            self._download_model(self.yunet_model_url, self.yunet_model_path)

        if self._is_invalid_model_file(self.backbone_weights_path):
            raise FaceEngineError(
                f"Не найден или некорректно загружен файл весов модели: {self.backbone_weights_path}"
            )

        if self.detector is None:
            self.detector = cv2.FaceDetectorYN.create(
                str(self.yunet_model_path),
                "",
                (320, 320),
                0.75,
                0.3,
                5000,
            )

        if self.backbone is None:
            checkpoint = torch.load(self.backbone_weights_path, map_location=self.device)
            model = InceptionResnetV1(classify=False, pretrained=None).to(self.device)
            backbone_state = self._extract_backbone_state_dict(checkpoint, model.state_dict().keys())
            model.load_state_dict(backbone_state, strict=True)
            model.eval()
            self.backbone = model

    def _extract_backbone_state_dict(
        self,
        checkpoint: object,
        expected_keys: object,
    ) -> OrderedDict[str, torch.Tensor]:
        if not isinstance(checkpoint, dict):
            raise FaceEngineError("Файл весов не содержит словарь state_dict.")

        candidate = checkpoint
        for key in ("backbone", "model", "state_dict", "net"):
            value = checkpoint.get(key)
            if isinstance(value, (dict, OrderedDict)):
                candidate = value
                break

        tensor_keys = [key for key, value in candidate.items() if hasattr(value, "shape")]
        if not tensor_keys:
            raise FaceEngineError("В файле весов не найдены tensor-параметры модели.")

        prefixes = ("net.", "model.", "backbone.", "module.")
        expected = set(expected_keys)
        cleaned: OrderedDict[str, torch.Tensor] = OrderedDict()

        for key, value in candidate.items():
            if not hasattr(value, "shape"):
                continue

            new_key = key
            changed = True
            while changed:
                changed = False
                for prefix in prefixes:
                    if new_key.startswith(prefix):
                        new_key = new_key[len(prefix):]
                        changed = True

            if new_key in expected:
                cleaned[new_key] = value

        missing = expected.difference(cleaned.keys())
        if missing:
            preview = ", ".join(sorted(list(missing))[:5])
            raise FaceEngineError(
                f"В checkpoint не хватает обязательных весов backbone. Например: {preview}"
            )

        return cleaned

    def extract_embedding(self, image_bytes: bytes) -> np.ndarray:
        self.ensure_ready()

        image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise InvalidImageError("Не удалось декодировать изображение.")

        face = self._detect_single_face(image)
        aligned_face = self._align_face(image, face)
        tensor = self._prepare_tensor(aligned_face)

        with torch.inference_mode():
            embedding = self.backbone(tensor).cpu().numpy().flatten().astype(np.float32)

        norm = np.linalg.norm(embedding)
        if norm <= 0:
            raise FaceEngineError("Модель вернула некорректный embedding.")

        return embedding / norm

    def extract_embedding_from_frames(self, frames: list[bytes]) -> np.ndarray:
        if not frames:
            raise FaceEngineError("Не переданы кадры для распознавания.")

        embeddings = [self.extract_embedding(frame) for frame in frames]
        stacked = np.stack(embeddings, axis=0)
        averaged = np.mean(stacked, axis=0).astype(np.float32)
        norm = np.linalg.norm(averaged)
        if norm <= 0:
            raise FaceEngineError("Не удалось получить корректный усредненный embedding.")
        return averaged / norm

    def find_best_match(self, probe_embedding: np.ndarray, users: list[dict]) -> MatchResult:
        self.ensure_ready()

        best_user: dict | None = None
        best_distance = float("inf")

        for user in users:
            candidate = np.asarray(user["embedding"], dtype=np.float32)
            distance = float(np.linalg.norm(probe_embedding - candidate))

            if distance < best_distance:
                best_distance = distance
                best_user = user

        if best_user is None or best_distance > self.match_threshold:
            return MatchResult(found=False, score=max(0.0, 1.0 - best_distance), user=None)

        return MatchResult(
            found=True,
            score=max(0.0, 1.0 - best_distance),
            user=best_user,
        )

    def _detect_single_face(self, image: np.ndarray) -> np.ndarray:
        assert self.detector is not None

        height, width = image.shape[:2]
        self.detector.setInputSize((width, height))
        _, faces = self.detector.detect(image)

        if faces is None or len(faces) == 0:
            _, faces = self.detector.detect(self._normalize_lighting(image))

        if faces is None or len(faces) == 0:
            raise FaceCountError("Лицо не обнаружено.")

        if len(faces) > 1:
            raise FaceCountError("В кадре должно быть только одно лицо.")

        return faces[0].astype(np.float32)

    def _normalize_lighting(self, image: np.ndarray) -> np.ndarray:
        lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
        lightness, channel_a, channel_b = cv2.split(lab)
        clahe = cv2.createCLAHE(clipLimit=1.7, tileGridSize=(8, 8))
        normalized_lightness = clahe.apply(lightness)
        normalized = cv2.merge((normalized_lightness, channel_a, channel_b))
        return cv2.cvtColor(normalized, cv2.COLOR_LAB2BGR)

    def _align_face(self, image: np.ndarray, face: np.ndarray) -> np.ndarray:
        landmarks = np.array(
            [
                [face[4], face[5]],
                [face[6], face[7]],
                [face[8], face[9]],
                [face[10], face[11]],
                [face[12], face[13]],
            ],
            dtype=np.float32,
        )

        transform, _ = cv2.estimateAffinePartial2D(
            landmarks,
            self.REFERENCE_FIVE_POINTS,
            method=cv2.LMEDS,
        )

        if transform is None:
            raise FaceEngineError("Не удалось выровнять лицо по ключевым точкам.")

        return cv2.warpAffine(image, transform, (112, 112), borderValue=0.0)

    def _prepare_tensor(self, aligned_face: np.ndarray) -> torch.Tensor:
        resized = cv2.resize(aligned_face, (160, 160), interpolation=cv2.INTER_LINEAR)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        tensor = torch.from_numpy(rgb).permute(2, 0, 1).float().unsqueeze(0)
        tensor = (tensor - 127.5) / 128.0
        return tensor.to(self.device)
