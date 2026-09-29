# Microservicio semántico (Flask + sentence-transformers + PyTorch CPU)
# Construir:  docker build -t tesis-ia .
# Probar:     docker run --rm -p 5000:5000 tesis-ia
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/app/.cache/huggingface \
    NLTK_DATA=/app/nltk_data \
    PORT=5000

# Usuario sin privilegios, creado AL INICIO: así los archivos se crean ya con el
# dueño correcto y no hace falta un "chown -R" al final (que duplicaba ~1 GB).
RUN useradd --create-home appuser \
 && mkdir -p /app/.cache/huggingface /app/nltk_data \
 && chown -R appuser /app

WORKDIR /app

# 1) PyTorch en su versión SOLO CPU (la normal trae soporte GPU y pesa varios GB)
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.11.0

# 2) Resto de dependencias (torch ya está instalado, pip no lo vuelve a bajar)
COPY requirements.txt .
RUN pip install -r requirements.txt

# 3) Desde aquí se trabaja como appuser
USER appuser

# 4) Descargar el modelo y el divisor de oraciones DURANTE la construcción,
#    así el contenedor arranca sin depender de internet y más rápido
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')" \
 && python -c "import nltk; nltk.download('punkt', download_dir='/app/nltk_data'); nltk.download('punkt_tab', download_dir='/app/nltk_data')"

# 5) Código del servicio
COPY --chown=appuser ia_service.py encoders.py ./

EXPOSE 5000

# gunicorn: servidor de producción. 1 proceso (el modelo se carga una sola vez)
# con 4 hilos para atender varias peticiones; timeout amplio para textos largos.
CMD ["sh", "-c", "exec gunicorn --workers 1 --threads 4 --timeout 300 --bind 0.0.0.0:${PORT} ia_service:app"]
