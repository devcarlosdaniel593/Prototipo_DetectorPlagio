"""
Codificadores de oraciones para el microservicio semántico.

Dos implementaciones del MISMO modelo (paraphrase-multilingual-MiniLM-L12-v2):

- TorchEncoder: sentence-transformers + PyTorch. Es la versión usada en el
  desarrollo y en los resultados de la tesis. Necesita ~1 GB de RAM.
- OnnxEncoder: el mismo modelo exportado a ONNX y cuantizado a 8 bits
  (archivo oficial del repositorio del modelo). Usa onnxruntime, sin PyTorch.
  Necesita bastante menos memoria, pensado para servidores de 512 MB.

Ambas devuelven una matriz numpy (n_oraciones x 384) con embeddings obtenidos
por mean pooling, igual que la configuración original del modelo.
"""
import logging
import os

import numpy as np

log = logging.getLogger("ia_service")

HF_REPO = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
MAX_SEQ_LENGTH = 128  # longitud máxima configurada en el modelo original


class TorchEncoder:
    name = "torch"

    def __init__(self, model_name):
        from sentence_transformers import SentenceTransformer

        self.model = SentenceTransformer(model_name)

    def encode(self, sentences):
        return self.model.encode(
            sentences, convert_to_numpy=True, show_progress_bar=False
        ).astype(np.float32)


class OnnxEncoder:
    name = "onnx"

    def __init__(self, onnx_file):
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download
        from tokenizers import Tokenizer

        model_path = hf_hub_download(HF_REPO, onnx_file)
        tokenizer_path = hf_hub_download(HF_REPO, "tokenizer.json")

        self.tokenizer = Tokenizer.from_file(tokenizer_path)
        self.tokenizer.enable_truncation(max_length=MAX_SEQ_LENGTH)
        self.tokenizer.enable_padding()

        options = ort.SessionOptions()
        options.intra_op_num_threads = int(os.getenv("ONNX_THREADS", "1"))
        # Ahorro de memoria para servidores de 512 MB:
        # - sin "arena": onnxruntime no reserva bloques grandes por adelantado
        # - nivel de optimización configurable: las optimizaciones de grafo pueden
        #   convertir los pesos cuantizados a float32 y multiplicar la RAM.
        options.enable_cpu_mem_arena = os.getenv("ONNX_MEM_ARENA", "0") == "1"
        options.enable_mem_pattern = False
        levels = {
            "disable": ort.GraphOptimizationLevel.ORT_DISABLE_ALL,
            "basic": ort.GraphOptimizationLevel.ORT_ENABLE_BASIC,
            "extended": ort.GraphOptimizationLevel.ORT_ENABLE_EXTENDED,
            "all": ort.GraphOptimizationLevel.ORT_ENABLE_ALL,
        }
        options.graph_optimization_level = levels.get(
            os.getenv("ONNX_OPT_LEVEL", "basic").lower(),
            ort.GraphOptimizationLevel.ORT_ENABLE_BASIC,
        )
        self.session = ort.InferenceSession(
            model_path, sess_options=options, providers=["CPUExecutionProvider"]
        )
        self.input_names = {i.name for i in self.session.get_inputs()}

    def encode(self, sentences, batch_size=32):
        chunks = []
        for start in range(0, len(sentences), batch_size):
            batch = sentences[start : start + batch_size]
            encoded = self.tokenizer.encode_batch(batch)
            input_ids = np.array([e.ids for e in encoded], dtype=np.int64)
            attention = np.array([e.attention_mask for e in encoded], dtype=np.int64)
            feeds = {"input_ids": input_ids, "attention_mask": attention}
            if "token_type_ids" in self.input_names:
                feeds["token_type_ids"] = np.zeros_like(input_ids)

            token_embeddings = self.session.run(None, feeds)[0]  # (b, seq, 384)

            # Mean pooling (igual que sentence-transformers para este modelo)
            mask = attention[..., None].astype(np.float32)
            summed = (token_embeddings * mask).sum(axis=1)
            counts = np.clip(mask.sum(axis=1), 1e-9, None)
            chunks.append((summed / counts).astype(np.float32))
        return np.vstack(chunks) if chunks else np.zeros((0, 384), dtype=np.float32)


def create_encoder():
    """Elige la implementación con la variable SEMANTIC_BACKEND (torch | onnx)."""
    backend = os.getenv("SEMANTIC_BACKEND", "torch").lower()
    if backend == "onnx":
        onnx_file = os.getenv("ONNX_MODEL_FILE", "onnx/model_quint8_avx2.onnx")
        log.info("Backend ONNX: %s/%s", HF_REPO, onnx_file)
        return OnnxEncoder(onnx_file)
    model_name = os.getenv("SEMANTIC_MODEL", "paraphrase-multilingual-MiniLM-L12-v2")
    log.info("Backend PyTorch: %s", model_name)
    return TorchEncoder(model_name)


def cosine_matrix(a, b):
    """Similitud coseno entre cada fila de a y cada fila de b."""
    a_norm = a / np.clip(np.linalg.norm(a, axis=1, keepdims=True), 1e-12, None)
    b_norm = b / np.clip(np.linalg.norm(b, axis=1, keepdims=True), 1e-12, None)
    return a_norm @ b_norm.T
