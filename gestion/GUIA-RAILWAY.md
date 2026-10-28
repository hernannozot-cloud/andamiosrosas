# Guía: poner el sistema de gestión en internet (Railway)

Con esto el sistema de gestión queda en un servidor de internet. Lo abres desde **cualquier computadora o celular, en cualquier red**, y todos ven la **misma información**. Ya no depende de que tu PC esté prendida.

Tiempo aproximado: 30 minutos. Costo: plan **Hobby** de Railway, unos **5 USD al mes** (te piden tarjeta).

> Tú creas la cuenta y pagas. Nadie más necesita tu contraseña de Railway ni de GitHub.

---

## Paso 1. Crear la cuenta de Railway

1. Entra a **https://railway.com** y da clic en **Login**.
2. Elige **Continue with GitHub** y entra con tu cuenta de GitHub (la de `hernannozot-cloud`).
3. Elige el plan **Hobby** y registra tu tarjeta.

## Paso 2. Conectar el proyecto de GitHub

1. En Railway da clic en **New Project** → **Deploy from GitHub repo**.
2. Si te pide permiso para ver tus repositorios, acepta (puedes darle acceso solo al repositorio **andamiosrosas**).
3. Elige el repositorio **andamiosrosas**.
4. Railway empieza a construir el sistema solo (tarda unos 3–5 minutos la primera vez). No tienes que configurar nada más aquí: el repositorio ya trae las instrucciones (`Dockerfile` y `railway.json`).

## Paso 3. Crear el disco donde se guarda la información (Volume)

Sin esto, la información se borraría cada vez que el servidor se reinicie.

1. En el tablero del proyecto, da clic derecho sobre el cuadro del servicio (dice *andamiosrosas*) → **Attach Volume** (o el botón **+ Create** → **Volume**).
2. En **Mount path** escribe exactamente: `/data`
3. Guarda.

## Paso 4. Poner tu PIN

1. Da clic en el cuadro del servicio → pestaña **Variables** → **New Variable**.
2. Nombre: `GESTION_PIN` · Valor: el PIN que quieras usar para entrar.
   - Puede ser el mismo de ahora, pero como el sistema estará en internet **te recomendamos uno de 8 dígitos o más** que no sea tu fecha de nacimiento ni algo fácil.
3. Guarda. Railway vuelve a arrancar el sistema (1–2 minutos).

## Paso 5. Obtener la dirección web

1. En el servicio → pestaña **Settings** → sección **Networking** → **Generate Domain**.
2. Te da una dirección parecida a `andamiosrosas-production.up.railway.app`.
3. Ábrela: debe aparecer la pantalla del PIN. Entra con el PIN del paso 4. Verás el sistema **vacío**: es normal, falta pasar tu información.

## Paso 6. Pasar tu información de la PC a Railway

Haz esto cuando ya no vayas a capturar nada más en la PC (por ejemplo, al final del día).

1. **Cierra** la ventana negra del sistema en tu PC.
2. En la carpeta `ANDAMIOS ROSAS\gestion`, da doble clic en **`preparar-base-para-railway.bat`**.
   Se crea un archivo llamado `base-para-railway-(fecha).db` en esa misma carpeta y te dice cuántos activos, rentas y cotizaciones contiene.
3. Abre la dirección de Railway (paso 5) y entra con tu PIN.
4. Arriba a la derecha da clic en **Respaldo**.
5. En **Restaurar desde un archivo**: elige el archivo `base-para-railway-(fecha).db`, escribe tu PIN y da clic en **Restaurar**. Confirma.
6. Espera unos segundos: el sistema se reinicia solo y vuelve a pedir el PIN. Revisa que estén tus rentas, clientes y cotizaciones.

## Paso 7. A partir de ahora

- Usa **solo la dirección de Railway** (guárdala en favoritos en cada computadora y celular).
- **Ya no abras el sistema en la PC** (`iniciar-gestion.bat`): si capturas algo ahí, no aparecerá en Railway.
- Las cotizaciones en PDF se generan igual que antes.
- **Respaldos:** el servidor guarda una copia automática cada día (se conservan 30 días). Además, te recomendamos **una vez por semana** entrar a **Respaldo → Descargar copia** y guardar el archivo en tu computadora.
- Si necesitas regresar a un respaldo, se usa la misma opción **Restaurar** del paso 6.

---

## Opcional: usar `gestion.andamiosrosas.com`

1. En Railway → servicio → **Settings** → **Networking** → **Custom Domain** → escribe `gestion.andamiosrosas.com`.
2. Railway te muestra un registro **CNAME** (un nombre y un valor).
3. Entra al panel donde administras el dominio `andamiosrosas.com` (donde lo compraste o donde configuraste el correo) → **DNS** → agrega un registro **CNAME** con:
   - Nombre / Host: `gestion`
   - Valor / Apunta a: lo que te mostró Railway
4. Espera de 10 minutos a unas horas. Cuando Railway marque el dominio con palomita verde, ya puedes entrar en `https://gestion.andamiosrosas.com`.

---

## Si algo sale mal

- **La página no abre:** en Railway, pestaña **Deployments**, revisa que el último diga *Active / Success*. Si dice *Failed*, toma captura de **View Logs** y mándasela a Claude.
- **"Demasiados intentos":** el sistema bloquea el PIN un rato después de varios errores (protección contra intrusos). Espera 1 minuto (o 15 si hubo muchos intentos).
- **Olvidaste el PIN:** cámbialo en Railway → **Variables** → `GESTION_PIN`.

---

### Notas técnicas (para Claude o un programador)

- Imagen: `Dockerfile` en la raíz del repo; solo copia `gestion/`, `sitio-web/logic.js` y `sitio-web/assets/`. `railway.json` limita los redespliegues a cambios en esas rutas, 1 réplica (SQLite) y reinicio siempre.
- Variables ya fijadas en la imagen: `GESTION_DATA_DIR=/data`, `GESTION_CHROME=/usr/bin/chromium`, `GESTION_TRUST_PROXY=1`, `TZ=America/Mexico_City`. Railway pone `PORT`. Opcional: `GESTION_SECRET` (si no, se genera y se guarda en `/data/config.json`).
- Railway despliega desde el repo **andamiosrosas** (rama `master`), no desde el repo privado `andamios-rosas-gestion` que crea `subir-gestion.bat`: ese repo solo tiene `gestion/` y no arranca solo (le falta `sitio-web/`).
- Rutas nuevas: `GET /api/respaldo` (descarga `VACUUM INTO`) y `POST /api/restaurar` (cuerpo binario, sesión + encabezado `X-Pin`; valida `integrity_check`, guarda `respaldos/antes-de-restaurar-*.db` y termina el proceso para que Railway lo reinicie).
