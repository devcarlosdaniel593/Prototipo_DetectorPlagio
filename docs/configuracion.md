# Archivos de configuración

Explicación de los archivos que no admiten comentarios (JSON) o que conviene describir aparte. Ninguno se modificó.

## Backend (`backend/`)

| Archivo | Propósito |
|---|---|
| `package.json` | Dependencias y scripts de NestJS. Producción: `@nestjs/*`, `@prisma/client`, `axios`, `class-validator`/`class-transformer` (validación de DTO), `multer` (subida de archivos), `natural` (TF-IDF), `pdf2json` (texto de PDF). Scripts: `build`, `start`, `start:dev`, `start:prod`, `lint` (ejecuta `eslint --fix`, que reescribe archivos), `test` y `test:e2e`. La licencia figura como `UNLICENSED`. |
| `package-lock.json` | Versiones exactas instaladas; `npm ci` (usado en el Dockerfile) instala exactamente estas. |
| `tsconfig.json` | Compilación TypeScript: módulos `nodenext`, destino ES2023, decoradores (necesarios para NestJS), salida en `dist/`. `removeComments: true` hace que los comentarios no lleguen al JavaScript compilado. |
| `tsconfig.build.json` | Igual que el anterior, pero excluye pruebas y `dist` al construir. |
| `nest-cli.json` | Configuración de la CLI de Nest: código en `src/`, borra `dist/` antes de compilar. |
| `test/jest-e2e.json` | Configuración de Jest para las pruebas end-to-end (`*.e2e-spec.ts`). |
| `eslint.config.mjs`, `.prettierrc` | Reglas de estilo y formato. |
| `prisma/schema.prisma` | Modelos de datos (comentados en el propio archivo). |
| `prisma/migrations/` | Historial de cambios de la base; no se edita a mano. |
| `Dockerfile`, `.dockerignore` | Imagen de producción en dos etapas (comentada en el propio archivo). |

## Servicio de IA (`ia_service/`)

| Archivo | Propósito |
|---|---|
| `requirements.txt` | Dependencias con versiones fijas del backend PyTorch (Flask, sentence-transformers, torch, nltk, numpy, etc.). gunicorn solo se instala fuera de Windows. |
| `requirements-render.txt` | Variante ligera sin PyTorch para el backend ONNX (`SEMANTIC_BACKEND=onnx`), con versiones mínimas. |
| `Dockerfile`, `.dockerignore` | Imagen con PyTorch solo CPU. Descarga el modelo y los datos de NLTK al construir y ejecuta gunicorn con 1 proceso y 4 hilos (comentado en el propio archivo). |

## Frontend (`frontend/`)

| Archivo | Propósito |
|---|---|
| `package.json` | React 19 con `react-scripts` 5 (Create React App) y axios. Scripts `start`, `build` y `test`. |
| `public/manifest.json` | Metadatos de la aplicación web; conserva los valores de la plantilla de CRA. |
| `public/index.html` | Página base donde React monta la aplicación (`#root`). |

## Raíz del repositorio

| Archivo | Propósito |
|---|---|
| `.gitignore` | Excluye dependencias, compilados, `.env`, PDF, cachés de modelos, `backups/` y `Claude outputs/`. Los archivos de `Claude outputs/` que ya estaban versionados antes de esa regla siguen en el repositorio. |
| `README.md` | Contiene la plantilla por defecto de NestJS; no describe el prototipo. |
