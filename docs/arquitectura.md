# Arquitectura del prototipo

Descripción del código tal como está en el repositorio. Los detalles de cada función están en los comentarios del código fuente.

## Servicios

```
Frontend React (CRA)  ──HTTP──▶  API NestJS (:3000)  ──Prisma──▶  PostgreSQL
frontend/src                     backend/src             │
                                     │                   └─ User, Document, DocumentAnalysis
                                     ├──HTTP POST /compare──▶ Microservicio Flask (:5000)
                                     │                        ia_service/ (embeddings)
                                     └──HTTPS──▶ OpenAlex, Crossref, Semantic Scholar,
                                                 Zenodo, HAL, SerpAPI (solo con SERPAPI_KEY)
```

| Servicio | Carpeta | Punto de entrada | Ejecución |
|---|---|---|---|
| Frontend | `frontend/` | `src/index.js` → `src/App.js` | `react-scripts` (CRA) |
| API | `backend/` | `src/main.ts` | NestJS; imagen Docker en `backend/Dockerfile` |
| Similitud semántica | `ia_service/` | `ia_service.py` | Flask en desarrollo; gunicorn en `ia_service/Dockerfile` |
| Base de datos | `backend/prisma/` | `schema.prisma` y `migrations/` | PostgreSQL (`DATABASE_URL`) |

No hay docker-compose ni autenticación de usuarios. El frontend envía siempre `userId = 1`.

## Endpoints

| Método y ruta | Servicio | Función |
|---|---|---|
| `GET /` | API | Mensaje de estado |
| `GET /users`, `POST /users` | API | Listar usuarios (sin contraseña) y crear usuarios |
| `POST /documents/upload` | API | Subir y analizar un PDF |
| `POST /documents/upload-batch` | API | Subir y analizar hasta 10 PDF |
| `POST /analysis/document/:id` | API | Analizar un documento ya guardado (no guarda métricas) |
| `GET /analysis/web-sources?text=` | API | Diagnóstico de los proveedores externos |
| `GET /evaluation/report` | API | Reporte de evaluación |
| `PATCH /evaluation/documents/:id/label` | API | Etiqueta de referencia (`similar`, `original` o `null`) |
| `GET /health` | Flask | Estado del servicio y backend (torch u onnx) |
| `POST /compare` | Flask | Similitud semántica entre un texto y textos base |

## Flujo de análisis de un PDF

1. **Carga** (`documents.controller.ts`): multer guarda el PDF en `./uploads`.
2. **Extracción** (`pdf.service.ts`): pdf2json devuelve el texto unido por espacios, sin saltos de línea y sin OCR.
3. **Registro** (`documents.service.ts`): se calcula el SHA-256 del texto (`contentHash`). En modo repositorio, si ya existe un documento con el mismo hash, se reutiliza. El PDF temporal se borra siempre.
4. **Fuentes**: todos los demás documentos de la base, más las fuentes web (`web-source.service.ts`). Se planifican hasta 6 consultas con palabras del documento y se consulta a 7 proveedores, obteniendo hasta 36 resúmenes.
5. **Segmentación** (`text.utils.ts → splitIntoParagraphs`): el texto se divide en segmentos (con texto de PDF, normalmente grupos de 3 oraciones).
6. **Similitud por segmento** (`analysis.service.ts`):
   - léxica: TF-IDF + coseno × factor de longitud (`similarity.service.ts`);
   - filtro léxico y selección de los 4 mejores candidatos;
   - semántica: `POST /compare` al microservicio;
   - combinada = 0,55 · léxica + 0,45 · semántica, con filtro combinado;
   - se conserva la mejor fuente por segmento.
7. **Puntajes**: el ranking por fuente y la similitud global (fórmulas abajo).
8. **Estilometría** (`stylometry.service.ts`): perfil de 7 rasgos, anomalías internas y comparación con los documentos internos.
9. **Persistencia** (solo modo repositorio): `DocumentAnalysisService` guarda las métricas en `DocumentAnalysis`. En modo sesión el documento se elimina al terminar.

## Fórmulas y umbrales

| Concepto | Valor en el código | Archivo |
|---|---|---|
| Factor de longitud léxico | 0,75 + 0,25 · (palabras del más corto / palabras del más largo) | `similarity.service.ts` |
| Umbral léxico | interna ≥ 16, web ≥ 8 | `analysis.service.ts` (THRESHOLDS) |
| Candidatos al análisis semántico | 4 por segmento (`SEMANTIC_TOP_K_PER_SEGMENT`) | `analysis.service.ts` |
| Similitud combinada | 0,55 · léxica + 0,45 · semántica | `analysis.service.ts` |
| Umbral combinado | interna ≥ 22, web ≥ 12 | `analysis.service.ts` |
| Puntaje por fuente | 0,5 · cobertura + 0,35 · similitud media + 0,15 · densidad (densidad = min(n/12·100, 100)) | `analysis.service.ts` |
| Similitud global | promedio de los puntajes por fuente | `analysis.service.ts` |
| Similitud semántica (Flask) | promedio, por oración nueva, del coseno máximo contra las oraciones base | `ia_service.py` |
| Clasificación "similar" | similitud global ≥ 40 y al menos una fuente | `document-analysis.service.ts` |
| Nivel de riesgo | alto ≥ 80, medio ≥ 50, bajo en otro caso | `document-analysis.service.ts` |
| Anomalía de estilo | desviación ≥ 30 respecto de la mediana de los segmentos (mínimo 4 segmentos de prosa) | `stylometry.service.ts` |
| Similitud de estilo | alta ≥ 70, media ≥ 45 | `stylometry.service.ts` |
| Nota sugerida (frontend) | promedio de (100 − similitud)/10 y la nota del docente | `frontend/src/utils/gradeSuggestion.js` |

Los resultados son indicadores para apoyar la revisión del docente. No determinan por sí solos plagio ni autoría.

## Modelo de datos (Prisma)

- **User** 1 — N **Document**.
- **Document** 1 — 0..1 **DocumentAnalysis** (si se borra el documento, se borran sus métricas).
- `Document.content` guarda el texto extraído; el PDF no se conserva.
- `DocumentAnalysis` guarda la similitud global, la consistencia de estilo, las anomalías, las fuentes, el tiempo de proceso, el estado del servicio semántico, la clasificación, el nivel de riesgo y la etiqueta de referencia. Las similitudes léxica y semántica no se guardan por separado.

## Variables de entorno (solo nombres; los valores no van en el repositorio)

| Servicio | Variables |
|---|---|
| API | `DATABASE_URL`, `PORT`, `CORS_ORIGINS`, `SEMANTIC_IA_URL`, `SEMANTIC_IA_TIMEOUT_MS`, `SEMANTIC_TOP_K_PER_SEGMENT`, `SEMANTIC_IA_MAX_ATTEMPTS`, `SEMANTIC_IA_RETRY_DELAY_MS`, `ANALYSIS_MAX_SEGMENTS`, `SEMANTIC_CACHE_MAX_ENTRIES`, `ANALYSIS_MAX_MATCHES_OUT`, `SEARCH_MAX_QUERIES`, `SEARCH_QUERY_IA_ENABLED`, `SEARCH_MAX_COMBINED_RESULTS`, `SEARCH_PER_PROVIDER_LIMIT`, `CONTACT_EMAIL`, `SERPAPI_KEY` |
| Flask | `PORT`, `SEMANTIC_BACKEND`, `SEMANTIC_MODEL`, `ONNX_MODEL_FILE`, `ONNX_THREADS`, `ONNX_MEM_ARENA`, `ONNX_OPT_LEVEL`, `MAX_FRASES_BASE`, `BASE_CACHE_MAX_ITEMS` |
| Frontend | `REACT_APP_API_BASE_URL` (se fija al compilar) |
| Scripts | `AZURE_DATABASE_URL` (`backend/scripts/copy-to-azure.js`) |
