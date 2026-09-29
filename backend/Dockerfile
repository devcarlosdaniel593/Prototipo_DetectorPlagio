# Backend NestJS + Prisma
# Construir:  docker build -t tesis-backend .
# Probar:     docker run --rm -p 3000:3000 --env-file .env.docker tesis-backend

# ---------- Etapa 1: compilar ----------
FROM node:22-slim AS build
# Prisma necesita OpenSSL para conectarse a PostgreSQL
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Dependencias exactas del package-lock (se cachean si no cambian)
COPY package.json package-lock.json ./
RUN npm ci

# Cliente de Prisma generado para Linux (el de Windows no sirve aquí)
COPY prisma ./prisma
RUN npx prisma generate

# Código y compilación TypeScript → dist/
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build \
 && npm prune --omit=dev

# ---------- Etapa 2: imagen final, solo lo necesario para ejecutar ----------
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=build --chown=node /app/node_modules ./node_modules
COPY --from=build --chown=node /app/dist ./dist
COPY --from=build --chown=node /app/prisma ./prisma
COPY --from=build --chown=node /app/package.json ./

# Carpeta temporal para los PDF subidos (se borran tras extraer el texto)
RUN mkdir -p /app/uploads && chown node /app/uploads

# Usuario sin privilegios (viene incluido en la imagen oficial de Node)
USER node

EXPOSE 3000
CMD ["node", "dist/main.js"]
