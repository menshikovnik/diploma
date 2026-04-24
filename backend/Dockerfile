FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    NUMEXPR_NUM_THREADS=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /tmp/requirements.txt
RUN grep -Ev '^(torch|torchvision)==.*$' /tmp/requirements.txt > /tmp/requirements-docker.txt \
    && pip install --extra-index-url https://download.pytorch.org/whl/cpu \
        torch==2.2.2+cpu \
        torchvision==0.17.2+cpu \
    && pip install -r /tmp/requirements-docker.txt

COPY backend /app/backend

WORKDIR /app/backend

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
