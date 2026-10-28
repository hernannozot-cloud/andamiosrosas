# Sistema de gestión de Andamios Rosas para Railway.
# Solo incluye gestion/ y lo que usa de sitio-web/ (logic.js, logo y fotos de productos).
FROM node:24-bookworm-slim

# Chromium para los PDF de cotización; Carlito (= Calibri) y Liberation (= Arial) para que el PDF se vea igual;
# tzdata para que "hoy" sea la fecha de México y no la de Londres.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-crosextra-carlito fonts-liberation tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    TZ=America/Mexico_City \
    GESTION_DATA_DIR=/data \
    GESTION_CHROME=/usr/bin/chromium \
    GESTION_TRUST_PROXY=1

WORKDIR /app
COPY sitio-web/logic.js sitio-web/logic.js
COPY sitio-web/assets sitio-web/assets
COPY gestion gestion

WORKDIR /app/gestion
CMD ["node", "server.js"]
