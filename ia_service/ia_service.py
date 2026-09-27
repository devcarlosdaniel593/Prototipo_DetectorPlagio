from flask import Flask, request, jsonify
from sentence_transformers import SentenceTransformer, util
import hashlib
import nltk
import sys
from collections import OrderedDict

import torch

# Descargamos el divisor de frases (solo la primera vez)
try:
    nltk.download('punkt')
    nltk.download('punkt_tab') # Recurso adicional para versiones nuevas de nltk
except Exception as e:
    print(f"Aviso descarga nltk: {e}")

app = Flask(__name__)

print("--- Iniciando Servicio de IA ---")
try:
    # Mantenemos tu modelo multilingüe para soporte en español
    model = SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')
    print("¡Modelo IA cargado correctamente!")
except Exception as e:
    print(f"Error cargando el modelo: {e}")
    sys.exit(1)

# Reutilizar embeddings del texto base: el backend compara muchos párrafos contra los mismos PDFs.
_base_emb_cache = OrderedDict()
_BASE_CACHE_MAX_ITEMS = 48
MAX_FRASES_BASE = 240


def _cache_key_textos_base(textos_base):
    raw = "\0".join(d for d in textos_base if d and isinstance(d, str))
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()


def _frases_base_desde_docs(textos_base):
    todas_frases_base = []
    for doc in textos_base:
        if doc and isinstance(doc, str):
            todas_frases_base.extend(nltk.sent_tokenize(doc))

    if len(todas_frases_base) > MAX_FRASES_BASE:
        step = (len(todas_frases_base) - 1) / (MAX_FRASES_BASE - 1)
        idxs = [int(round(i * step)) for i in range(MAX_FRASES_BASE)]
        todas_frases_base = [todas_frases_base[i] for i in idxs]

    return todas_frases_base


def _get_frases_y_embedding_base(textos_base):
    key = _cache_key_textos_base(textos_base)
    if key in _base_emb_cache:
        _base_emb_cache.move_to_end(key)
        return _base_emb_cache[key]

    todas_frases_base = _frases_base_desde_docs(textos_base)
    if not todas_frases_base:
        return None, None

    emb_base = model.encode(todas_frases_base, convert_to_tensor=True)
    _base_emb_cache[key] = (todas_frases_base, emb_base)
    while len(_base_emb_cache) > _BASE_CACHE_MAX_ITEMS:
        _base_emb_cache.popitem(last=False)

    return todas_frases_base, emb_base


@app.route('/compare', methods=['POST'])
def compare():
    try:
        data = request.json
        texto_nuevo = data.get('texto_nuevo', '')
        textos_base = data.get('textos_base', [])

        # 1. Validación de entrada
        if not texto_nuevo:
            return jsonify({"similitud_ia": 0.0, "analisis_detallado": []})

        # 2. Segmentación en frases
        frases_nuevas = nltk.sent_tokenize(texto_nuevo)
        
        # 3–4. Frases base (con caché de embeddings) + vectores del texto nuevo
        todas_frases_base, emb_base = _get_frases_y_embedding_base(textos_base)

        # Si no hay nada previo en la BD, la similitud es 0 pero no debe dar error
        if not todas_frases_base:
            print("ℹ️ No hay documentos previos para comparar.")
            analisis_inicial = [{"texto": f, "similitud": 0.0, "referencia": ""} for f in frases_nuevas]
            return jsonify({
                "similitud_ia": 0.0,
                "analisis_detallado": analisis_inicial
            })

        emb_nuevas = model.encode(frases_nuevas, convert_to_tensor=True)

        # 5. Cálculo de similitud
        cos_sim_matrix = util.cos_sim(emb_nuevas, emb_base)
        
        analisis_detallado = []
        for i, frase in enumerate(frases_nuevas):
            # torch.max falla si la dimensión es 0, por eso validamos arriba
            max_val, max_idx = torch.max(cos_sim_matrix[i], dim=0)
            porcentaje = float(max_val.item()) * 100
            
            analisis_detallado.append({
                "texto": frase,
                "similitud": round(porcentaje, 2),
                "referencia": todas_frases_base[max_idx.item()] if porcentaje > 30 else ""
            })

        # 6. Cálculo Global
        # Usamos el promedio de todas las frases analizadas
        similitud_global = sum(f['similitud'] for f in analisis_detallado) / len(analisis_detallado)

        print(f"✅ Análisis completado. Similitud: {similitud_global:.2f}%")
        
        return jsonify({
            "similitud_ia": round(similitud_global, 2),
            "analisis_detallado": analisis_detallado
        })

    except Exception as e:
        # Esto imprimirá el error real en tu terminal de Python
        print(f"🔥 ERROR DETECTADO: {str(e)}")
        return jsonify({"error": "Error interno en el procesamiento", "detalle": str(e)}), 500

if __name__ == '__main__':
    # Ejecutamos en el puerto 5000 como lo tienes configurado en el Backend
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)