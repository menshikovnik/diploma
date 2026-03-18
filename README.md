# Система биометрической идентификации по лицу

Проект состоит из двух частей:

- frontend на `React + TypeScript + Vite`
- backend на `FastAPI + OpenCV`

Сценарий работы:

1. Пользователь открывает страницу.
2. Включает камеру и проходит active liveness.
3. Frontend отправляет кадр на backend.
4. Backend ищет совпадение по face embedding.
5. Если пользователь найден, frontend показывает карточку.
6. Если пользователь не найден, frontend показывает форму регистрации.
7. После регистрации новый пользователь сохраняется в локальную базу backend.

## Структура проекта

```text
backend/
  app/
  data/
  requirements.txt
src/
  components/
  lib/
  types/
```

## Frontend

Frontend реализует:

- одностраничный интерфейс без роутинга
- поток webcam
- active liveness с морганием и поворотами головы
- отправку кадров на backend
- карточку найденного пользователя
- форму регистрации на том же экране

### Запуск frontend

1. Установите Node-зависимости:

```bash
npm install
```

2. Создайте `.env`:

```bash
cp .env.example .env
```

3. Убедитесь, что адрес backend корректный:

```env
VITE_API_BASE_URL=http://localhost:8000
```

4. Запустите frontend:

```bash
npm run dev
```

### Запуск через Docker

Из корня проекта:

```bash
docker compose up --build -d
```

После запуска:

- frontend: `http://localhost:5173`
- backend: `http://localhost:8000`

Остановить сервисы:

```bash
docker compose down
```

## Backend

Backend реализует:

- `POST /api/recognition/identify`
- `POST /api/recognition/register`
- `GET /api/health`

Для локального распознавания используется претрейнед стек OpenCV:

- YuNet для детекции лица
- SFace для извлечения embedding и сравнения лиц

### Запуск backend

Для backend сначала попробуйте системный `python3`. Если установка OpenCV не пройдет из-за версии интерпретатора, используйте `Python 3.12`.

1. Создайте виртуальное окружение:

```bash
python3 -m venv backend/.venv
```

2. Активируйте его:

```bash
source backend/.venv/bin/activate
```

3. Установите зависимости:

```bash
pip install -r backend/requirements.txt
```

4. Создайте `.env` для backend:

```bash
cp backend/.env.example backend/.env
```

5. Запустите backend из директории `backend/`:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

При первом запуске backend автоматически скачает модели в `backend/models/`.

## Локальный тест всех этапов

1. Запустите backend.
2. Проверьте health endpoint:

```bash
curl http://localhost:8000/api/health
```

3. Запустите frontend.
4. Откройте страницу Vite в браузере.
5. Включите камеру.
6. Пройдите liveness:
   - смотрите прямо
   - моргните
   - поверните голову влево
   - поверните голову вправо
7. Если база пуста, система предложит регистрацию.
8. Зарегистрируйте пользователя.
9. Нажмите "Попробовать снова" и повторно пройдите сценарий.
10. Backend должен вернуть найденного пользователя.

## Хранение данных

Backend хранит данные локально:

- `backend/data/users.json` — анкеты и embeddings
- `backend/data/faces/` — исходные изображения зарегистрированных лиц

Это упрощенное хранилище для дипломного локального стенда. Позже его можно заменить на нормальную БД и подключить собственные веса модели.

## Замена на собственные веса

Сейчас backend использует претрейнед OpenCV-модели. Когда будешь подключать свою модель, логичнее всего заменить реализацию в [face_engine.py](/Users/nickmenshikov/Study/Diploma/diploma_frontend/backend/app/face_engine.py), сохранив текущие API-контракты frontend/backend без изменений.
