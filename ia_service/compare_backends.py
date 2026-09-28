"""
Compara el backend PyTorch (usado en la tesis) con el backend ONNX cuantizado
(pensado para el despliegue en 512 MB) y mide la memoria del backend ONNX.

Uso (desde la carpeta ia_service, con el .venv activado):
    python compare_backends.py            → compara similitudes torch vs onnx
    python compare_backends.py --memoria  → mide la RAM de ONNX con varias configuraciones
"""
import os
import sys

import numpy as np

from encoders import OnnxEncoder, TorchEncoder, cosine_matrix

ONNX_FILE = os.getenv("ONNX_MODEL_FILE", "onnx/model_quint8_avx2.onnx")

# Pares de prueba: paráfrasis, relacionados y no relacionados
PARES = [
    ("El sistema permite registrar a los estudiantes en la plataforma.",
     "La plataforma deja que los alumnos se inscriban en el sistema."),
    ("La base de datos almacena la información de los usuarios.",
     "Los datos de los usuarios se guardan en la base de datos."),
    ("El módulo de reportes genera estadísticas mensuales.",
     "Cada mes se producen estadísticas mediante el módulo de informes."),
    ("Se utilizó la metodología Scrum para organizar el trabajo.",
     "El equipo organizó sus tareas siguiendo el marco ágil Scrum."),
    ("El usuario debe iniciar sesión con su correo institucional.",
     "Para ingresar se requiere el correo de la universidad."),
    ("La aplicación muestra las rutas de buses del cantón Quito.",
     "Se pueden consultar los recorridos del transporte público en Quito."),
    ("El requerimiento funcional RF01 permite cargar documentos PDF.",
     "El sistema debe aceptar la carga de archivos en formato PDF."),
    ("La interfaz fue diseñada con React y componentes reutilizables.",
     "El frontend se construyó en React con componentes que se reutilizan."),
    ("El servidor responde en menos de dos segundos.",
     "La biblioteca abre de lunes a viernes por la mañana."),
    ("Los estudiantes presentaron su proyecto integrador.",
     "La receta lleva harina, huevos y azúcar."),
    ("La seguridad de las contraseñas se garantiza con cifrado.",
     "El partido terminó empatado en el último minuto."),
    ("El diagrama de casos de uso describe a los actores del sistema.",
     "Los actores y sus interacciones se representan en el diagrama de casos de uso."),
]


def memoria_mb():
    try:
        import psutil

        return psutil.Process().memory_info().rss / (1024 * 1024)
    except ImportError:
        return None


def solo_memoria():
    """Mide la RAM con una configuración (la de las variables de entorno)."""
    inicio = memoria_mb()
    enc = OnnxEncoder(ONNX_FILE)
    cargado = memoria_mb()
    enc.encode([p[0] for p in PARES] * 10)  # ejercita el modelo
    usado = memoria_mb()
    if usado is None:
        print("Instala psutil para medir la memoria:  pip install psutil")
        return
    nivel = os.getenv("ONNX_OPT_LEVEL", "basic")
    arena = os.getenv("ONNX_MEM_ARENA", "0")
    print(
        f"optimización={nivel:<9} arena={arena} | inicio {inicio:.0f} MB | "
        f"modelo cargado {cargado:.0f} MB | tras codificar {usado:.0f} MB"
    )


def memoria_todas():
    """Prueba cada configuración en un proceso nuevo para medirla limpia."""
    import subprocess

    print("Render gratis ofrece 512 MB; conviene quedar por debajo de ~400 MB.\n")
    for nivel in ("disable", "basic", "all"):
        for arena in ("0", "1"):
            env = dict(os.environ, ONNX_OPT_LEVEL=nivel, ONNX_MEM_ARENA=arena)
            subprocess.run([sys.executable, __file__, "--memoria-una"], env=env)


def comparar():
    torch_enc = TorchEncoder("paraphrase-multilingual-MiniLM-L12-v2")
    onnx_enc = OnnxEncoder(ONNX_FILE)

    a = [p[0] for p in PARES]
    b = [p[1] for p in PARES]
    sims_torch = np.diag(cosine_matrix(torch_enc.encode(a), torch_enc.encode(b))) * 100
    sims_onnx = np.diag(cosine_matrix(onnx_enc.encode(a), onnx_enc.encode(b))) * 100

    print(f"{'#':>2}  {'torch':>7}  {'onnx':>7}  {'dif.':>6}")
    for i, (t, o) in enumerate(zip(sims_torch, sims_onnx), start=1):
        print(f"{i:>2}  {t:7.2f}  {o:7.2f}  {o - t:+6.2f}")
    diffs = np.abs(sims_onnx - sims_torch)
    print(f"\nDiferencia media: {diffs.mean():.2f} puntos | máxima: {diffs.max():.2f} puntos")
    print("Criterio sugerido: diferencia media < 2 puntos → el despliegue es equivalente.")


if __name__ == "__main__":
    if "--memoria-una" in sys.argv:
        solo_memoria()
    elif "--memoria" in sys.argv:
        memoria_todas()
    else:
        comparar()
