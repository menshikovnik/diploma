from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .face_engine import FaceCountError, FaceEngine, FaceEngineError, InvalidImageError
from .schemas import (
    DeleteUserResponse,
    HealthResponse,
    IdentifyFoundResponse,
    IdentifyNotFoundResponse,
    RegisterResponse,
    UserDto,
)
from .storage import UserStorage

settings = get_settings()
storage = UserStorage(settings.data_dir)
engine = FaceEngine(
    model_dir=settings.model_dir,
    yunet_model_url=settings.yunet_model_url,
    match_threshold=settings.match_threshold,
)

app = FastAPI(title="Biometric Face Recognition Service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def to_public_user(user: dict[str, Any]) -> UserDto:
    return UserDto(
        id=int(user["id"]),
        firstName=str(user["firstName"]),
        lastName=str(user["lastName"]),
        middleName=str(user["middleName"]) if user.get("middleName") else None,
        groupNumber=str(user["groupNumber"]) if user.get("groupNumber") else None,
        email=str(user["email"]),
        phone=str(user["phone"]) if user.get("phone") else None,
    )


async def read_image(upload: UploadFile) -> bytes:
    content = await upload.read()
    if not content:
        raise HTTPException(status_code=400, detail="Файл изображения пуст.")
    return content


def raise_api_error(message: str, status_code: int = 400) -> None:
    raise HTTPException(status_code=status_code, detail=message)


@app.on_event("startup")
def on_startup() -> None:
    storage.ensure_ready()


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        usersCount=len(storage.list_users()),
        threshold=settings.match_threshold,
    )


@app.post(
    "/api/recognition/identify",
    response_model=IdentifyFoundResponse | IdentifyNotFoundResponse,
)
async def identify(file: UploadFile = File(...)) -> IdentifyFoundResponse | IdentifyNotFoundResponse:
    try:
        image_bytes = await read_image(file)
        embedding = engine.extract_embedding(image_bytes)
        users = storage.list_users()
        match = engine.find_best_match(embedding, users)

        if not match.found or match.user is None:
            return IdentifyNotFoundResponse()

        return IdentifyFoundResponse(
            user=to_public_user(match.user),
            score=round(match.score, 4),
        )
    except HTTPException:
        raise
    except FaceCountError as exc:
        raise_api_error(str(exc), 400)
    except InvalidImageError as exc:
        raise_api_error(str(exc), 400)
    except FaceEngineError as exc:
        raise_api_error(str(exc), 500)
    except Exception as exc:
        raise_api_error(f"Внутренняя ошибка распознавания: {exc}", 500)


@app.post("/api/recognition/register", response_model=RegisterResponse)
async def register(
    file: UploadFile = File(...),
    firstName: str = Form(...),
    lastName: str = Form(...),
    email: str = Form(...),
) -> RegisterResponse:
    try:
        image_bytes = await read_image(file)
        embedding = engine.extract_embedding(image_bytes)
        users = storage.list_users()
        duplicate = engine.find_best_match(embedding, users)

        if duplicate.found:
            raise_api_error(
                f"Похожее лицо уже зарегистрировано в системе. ID: {duplicate.user['id']}.",
                409,
            )

        user_id = storage.next_user_id()
        record = {
            "id": user_id,
            "firstName": firstName.strip(),
            "lastName": lastName.strip(),
            "email": email.strip(),
            "embedding": embedding.tolist(),
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }

        users.append(record)
        storage.save_users(users)

        return RegisterResponse(
            userId=user_id,
            message="User successfully registered",
        )
    except HTTPException:
        raise
    except FaceCountError as exc:
        raise_api_error(str(exc), 400)
    except InvalidImageError as exc:
        raise_api_error(str(exc), 400)
    except FaceEngineError as exc:
        raise_api_error(str(exc), 500)
    except Exception as exc:
        raise_api_error(f"Внутренняя ошибка регистрации: {exc}", 500)


@app.delete("/api/recognition/users/{user_id}", response_model=DeleteUserResponse)
def delete_user(user_id: int) -> DeleteUserResponse:
    if not storage.delete_user(user_id):
        raise_api_error("Пользователь не найден.", 404)

    return DeleteUserResponse(message="Пользователь удален из базы данных.")
