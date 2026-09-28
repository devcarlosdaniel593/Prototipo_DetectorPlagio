"""
Microservicio de similitud semántica del prototipo.

POST /compare
    Entrada:  {"texto_nuevo": "...", "textos_base": ["...", ...]}
    Salida:   {"similitud_ia": 0-100, "analisis_detallado": [...]}
    Para cada oración de texto_nuevo se busca la oración más parecida de
    textos_base (similitud coseno entre embeddings) y se promedia.

GET /health
    Comprobación de vida para el despliegue.

Variables de entorno (todas opcionales):
    PORT                    puerto (por defecto 5000)
    SEMANTIC_BACKEND        torch (por defecto) | onnx  (ver encoders.py)
    SEMANTIC_MODEL          modelo de sentence-transformers (backend torch)
    ONNX_MODEL_FILE         archivo ONNX del modelo (backend onnx)
    MAX_FRASES_BASE         máximo de oraciones por texto base (por defecto 2000)
    BASE_CACHE_MAX_ITEMS    textos base con embeddings en memoria (por defecto 48)
"""
import hashlib
import logging
import os
import sys
import threading
from collections import OrderedDict

import nltk
from flask import Flask, jsonify, request

from encoders import cosine_matrix, create_encoder

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [ia_service] %(levelname)s %(message)s"
)
log = logging.getLogger("ia_service")

MAX_FRASES_BASE = int(os.getenv("MAX_FRASES_BASE", "2000"))
BASE_CACHE_MAX_ITEMS = int(os.getenv("BASE_CACHE_MAX_ITEMS", "48"))
SENT_LANGUAGE = "spanish"


def _ensure_nltk_punkt():
    """Descarga el divisor de oraciones solo si todavía no está instalado."""
    for resource, package in (
        ("tokenizers/punkt", "punkt"),
        ("tokenizers/punkt_tab", "punkt_tab"),
    ):
        try:
            nltk.data.find(resource)
        except LookupError:
            try:
                nltk.download(package, quiet=True)
            except Exception as exc:  # sin red: se intenta seguir igual
                log.warning("No se pudo descargar %s: %s", package, exc)


def split_sentences(text):
    try:
        return nltk.sent_tokenize(text, language=SENT_LANGUAGE)
    except LookupError:
        return nltk.sent_tokenize(text)


_ensure_nltk_punkt()

app = Flask(__name__)
# Protege al servicio de cuerpos enormes (un documento de tesis ocupa < 1 MB).
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024

try:
    encoder = create_encoder()
except Exception as exc:
    log.error("Error cargando el modelo: %s", exc)
    sys.exit(1)
log.info("Modelo cargado correctamente")

# El backend compara muchos segmentos contra los mismos documentos base:
# se guardan sus embeddings para no recalcularlos en cada petición.
_base_emb_cache = OrderedDict()
_cache_lock = threading.Lock()


def _cache_key_textos_base(textos_base):
    raw = "\0".join(d for d in textos_base if d and isinstance(d, str))
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()


def _frases_base_desde_docs(textos_base):
    frases = []
    for doc in textos_base:
        if doc and isinstance(doc, str):
            frases.extend(split_sentences(doc))

    # Solo se muestrea si el texto base es extremadamente largo.
    # Antes el límite era 240 oraciones y se perdían coincidencias en
    # documentos de más de ~10 páginas.
    if len(frases) > MAX_FRASES_BASE:
        log.warning(
            "Texto base con %d oraciones; se usan %d repartidas uniformemente",
            len(frases),
            MAX_FRASES_BASE,
        )
        step = (len(frases) - 1) / (MAX_FRASES_BASE - 1)
        frases = [frases[int(round(i * step))] for i in range(MAX_FRASES_BASE)]

    return frases


def _get_frases_y_embedding_base(textos_base):
    key = _cache_key_textos_base(textos_base)
    with _cache_lock:
        if key in _base_emb_cache:
            _base_emb_cache.move_to_end(key)
            return _base_emb_cache[key]

    frases = _frases_base_desde_docs(textos_base)
    if not frases:
        return None, None

    emb_base = encoder.encode(frases)
    with _cache_lock:
        _base_emb_cache[key] = (frases, emb_base)
        while len(_base_emb_cache) > BASE_CACHE_MAX_ITEMS:
            _base_emb_cache.popitem(last=False)

    return frases, emb_base


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "backend": encoder.name})


@app.route("/compare", methods=["POST"])
def compare():
    try:
        data = request.get_json(silent=True) or {}
        texto_nuevo = data.get("texto_nuevo", "")
        textos_base = data.get("textos_base", [])

        if not texto_nuevo or not isinstance(texto_nuevo, str):
            return jsonify({"similitud_ia": 0.0, "analisis_detallado": []})
        if not isinstance(textos_base, list):
            return jsonify({"error": "textos_base debe ser una lista"}), 400

        frases_nuevas = split_sentences(texto_nuevo) or [texto_nuevo]
        todas_frases_base, emb_base = _get_frases_y_embedding_base(textos_base)

        # Sin texto base la similitud es 0, sin error
        if not todas_frases_base:
            return jsonify(
                {
                    "similitud_ia": 0.0,
                    "analisis_detallado": [
                        {"texto": f, "similitud": 0.0, "referencia": ""}
                        for f in frases_nuevas
                    ],
                }
            )

        emb_nuevas = encoder.encode(frases_nuevas)
        cos_sim_matrix = cosine_matrix(emb_nuevas, emb_base)

        analisis_detallado = []
        for i, frase in enumerate(frases_nuevas):
            max_idx = int(cos_sim_matrix[i].argmax())
            porcentaje = float(cos_sim_matrix[i][max_idx]) * 100
            analisis_detallado.append(
                {
                    "texto": frase,
                    "similitud": round(porcentaje, 2),
                    "referencia": todas_frases_base[max_idx]
                    if porcentaje > 30
                    else "",
                }
            )

        # Similitud del segmento = promedio de sus oraciones
        similitud_global = sum(f["similitud"] for f in analisis_detallado) / len(
            analisis_detallado
        )

        return jsonify(
            {
                "similitud_ia": round(similitud_global, 2),
                "analisis_detallado": analisis_detallado,
            }
        )

    except Exception as exc:
        log.exception("Error procesando /compare")
        return jsonify({"error": "Error interno en el procesamiento", "detalle": str(exc)}), 500


if __name__ == "__main__":
    # Desarrollo local (Windows incluido). En producción se usa gunicorn.
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False, threaded=True)
