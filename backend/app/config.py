from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    app_host: str
    app_port: int
    cors_origins: list[str]
    match_threshold: float
    anti_spoof_threshold: float
    anti_spoof_min_real_frames: int
    anti_spoof_model_count: int
    max_frames_per_request: int
    model_warmup_on_startup: bool
    data_dir: Path
    model_dir: Path
    yunet_model_url: str


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def get_settings() -> Settings:
    backend_root = Path(__file__).resolve().parents[1]
    project_root = backend_root.parent
    load_dotenv(backend_root / ".env")

    data_dir = Path(os.getenv("DATA_DIR", project_root / "backend" / "data"))
    model_dir = Path(os.getenv("MODEL_DIR", project_root / "backend" / "models"))

    if not data_dir.is_absolute():
        data_dir = project_root / data_dir

    if not model_dir.is_absolute():
        model_dir = project_root / model_dir

    return Settings(
        app_host=os.getenv("APP_HOST", "0.0.0.0"),
        app_port=int(os.getenv("APP_PORT", "8000")),
        cors_origins=_split_csv(
            os.getenv(
                "CORS_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173",
            )
        ),
        match_threshold=float(os.getenv("MATCH_THRESHOLD", "0.363")),
        anti_spoof_threshold=float(os.getenv("ANTI_SPOOF_THRESHOLD", "0.95")),
        anti_spoof_min_real_frames=int(os.getenv("ANTI_SPOOF_MIN_REAL_FRAMES", "2")),
        anti_spoof_model_count=int(os.getenv("ANTI_SPOOF_MODEL_COUNT", "2")),
        max_frames_per_request=int(os.getenv("MAX_FRAMES_PER_REQUEST", "3")),
        model_warmup_on_startup=os.getenv("MODEL_WARMUP_ON_STARTUP", "1").lower()
        in {"1", "true", "yes", "on"},
        data_dir=data_dir,
        model_dir=model_dir,
        yunet_model_url=os.getenv(
            "YUNET_MODEL_URL",
            "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        ),
    )
