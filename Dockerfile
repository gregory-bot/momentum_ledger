# One container for Azure Container Apps: the React build is served by the FastAPI backend.

# ---- build the frontend ----
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- runtime ----
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 STATIC_DIR=/app/static
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/momentum ./momentum
COPY --from=web /web/dist ./static
EXPOSE 8000
CMD ["uvicorn", "momentum.server:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
