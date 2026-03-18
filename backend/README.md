# Backend сервиса распознавания лиц

Python backend для локального тестирования всех этапов дипломного проекта:

- `POST /api/recognition/identify`
- `POST /api/recognition/register`
- `GET /api/health`

Сервис использует OpenCV YuNet для детекции лица и OpenCV SFace для извлечения face embeddings и сравнения лиц.

## Что делает backend

- принимает кадр лица из frontend
- проверяет, что на изображении ровно одно лицо
- извлекает embedding лица
- ищет лучшее совпадение в локальной базе
- регистрирует нового пользователя вместе с embedding и исходным кадром

## Запуск

Сначала попробуйте системный `python3`. Если wheel OpenCV не установится, переключитесь на `Python 3.12`.

1. Создайте виртуальное окружение:

```bash
python3 -m venv backend/.venv
```

Если установка зависимостей на текущем Python не проходит, лучший запасной путь для backend — отдельное окружение на Python 3.12.

2. Активируйте окружение:

```bash
source backend/.venv/bin/activate
```

3. Установите зависимости:

```bash
pip install -r backend/requirements.txt
```

4. При необходимости создайте `.env`:

```bash
cp backend/.env.example backend/.env
```

5. Запустите сервис:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Запускать команду нужно из директории `backend/`.

## Модели

При первом старте сервис автоматически скачивает претрейнед-модели OpenCV Zoo:

- `face_detection_yunet_2023mar.onnx`
- `face_recognition_sface_2021dec.onnx`

После этого они сохраняются локально в `backend/models/`.

## Данные

Локальная база хранится в:

- `backend/data/users.json`
- `backend/data/faces/`

Каждый зарегистрированный пользователь содержит анкету, embedding и путь к сохраненному изображению лица.
