# Guía: poner el sistema de gestión en internet (Render)

Con esto el sistema de gestión queda en un servidor de internet. Lo abres desde **cualquier computadora o celular, en cualquier red**, y todos ven la **misma información**. Ya no depende de que tu PC esté prendida.

Tiempo aproximado: 30 minutos. Costo: plan **Starter** de Render, unos **7 USD al mes** más unos centavos por el disco (te piden tarjeta).

> Tú creas la cuenta y pagas. Nadie más necesita tu contraseña de Render ni de GitHub.

---

## Paso 1. Crear la cuenta de Render

1. Entra a **https://render.com** y da clic en **Get Started** (o **Sign In**).
2. Elige **GitHub** y entra con tu cuenta de GitHub (`hernannozot-cloud`). Autoriza a Render.
3. Confirma tu correo si te lo pide.

## Paso 2. Crear el sistema con un solo botón (Blueprint)

El repositorio ya trae un archivo (`render.yaml`) con toda la configuración: el servidor, el disco donde se guarda la información y la variable del PIN.

1. En Render da clic en **New** → **Blueprint**.
2. Si te pide conectar GitHub, acepta. Puedes darle acceso solo al repositorio **andamiosrosas**.
3. Elige el repositorio **andamiosrosas**.
4. Ponle un nombre al Blueprint (por ejemplo `andamios-rosas`).
5. Render te pide el valor de **GESTION_PIN**: escribe el PIN que quieras usar para entrar al sistema.
   - Puede ser el mismo de ahora, pero como el sistema estará en internet **te recomendamos uno de 8 dígitos o más** que no sea tu fecha de nacimiento ni algo fácil.
6. Da clic en **Apply** / **Deploy Blueprint**. Si te pide la tarjeta, regístrala (el plan Starter es de pago porque es el que permite guardar la información en disco).
7. Render construye el sistema. La primera vez tarda de 5 a 10 minutos.

## Paso 3. Abrir la dirección web

1. Cuando termine, entra al servicio **gestion-andamios-rosas**. Arriba aparece una dirección parecida a `https://gestion-andamios-rosas.onrender.com`.
2. Ábrela: debe aparecer la pantalla del PIN. Entra con el PIN del paso 2. Verás el sistema **vacío**: es normal, falta pasar tu información.

## Paso 4. Pasar tu información de la PC a Render

Haz esto cuando ya no vayas a capturar nada más en la PC (por ejemplo, al final del día).

1. **Cierra** la ventana negra del sistema en tu PC.
2. En la carpeta `ANDAMIOS ROSAS\gestion`, da doble clic en **`preparar-base-para-la-nube.bat`**.
   Se crea un archivo llamado `base-para-la-nube-(fecha).db` en esa misma carpeta y te dice cuántos activos, rentas y cotizaciones contiene.
3. Abre la dirección de Render (paso 3) y entra con tu PIN.
4. Arriba a la derecha da clic en **Respaldo**.
5. En **Restaurar desde un archivo**: elige el archivo `base-para-la-nube-(fecha).db`, escribe tu PIN y da clic en **Restaurar**. Confirma.
6. Espera unos segundos: el sistema se reinicia solo y vuelve a pedir el PIN. Revisa que estén tus rentas, clientes y cotizaciones.

## Paso 5. A partir de ahora

- Usa **solo la dirección de Render** (guárdala en favoritos en cada computadora y celular).
- **Ya no abras el sistema en la PC** (`iniciar-gestion.bat`): si capturas algo ahí, no aparecerá en Render.
- Las cotizaciones en PDF se generan igual que antes.
- **Respaldos:** el servidor guarda una copia automática cada día (se conservan 30 días). Además, te recomendamos **una vez por semana** entrar a **Respaldo → Descargar copia** y guardar el archivo en tu computadora.
- Si necesitas regresar a un respaldo, se usa la misma opción **Restaurar** del paso 4.

---

## Opcional: usar `gestion.andamiosrosas.com`

1. En Render → servicio **gestion-andamios-rosas** → **Settings** → **Custom Domains** → **Add Custom Domain** → escribe `gestion.andamiosrosas.com`.
2. Render te muestra un registro **CNAME** (un nombre y un valor).
3. Entra al panel donde administras el dominio `andamiosrosas.com` → **DNS** → agrega un registro **CNAME** con:
   - Nombre / Host: `gestion`
   - Valor / Apunta a: lo que te mostró Render (termina en `.onrender.com`)
4. Regresa a Render y da clic en **Verify**. Puede tardar de 10 minutos a unas horas. Cuando aparezca como verificado, ya puedes entrar en `https://gestion.andamiosrosas.com`.

---

## Si algo sale mal

- **La página no abre:** en Render, pestaña **Events** del servicio, revisa que el último despliegue diga *Deploy live*. Si dice *failed*, toma captura de **Logs** y mándasela a Claude.
- **"Demasiados intentos":** el sistema bloquea el PIN un rato después de varios errores (protección contra intrusos). Espera 1 minuto (o 15 si hubo muchos intentos).
- **Olvidaste el PIN:** cámbialo en Render → servicio → **Environment** → `GESTION_PIN` → **Save Changes**.

---

### Notas técnicas (para Claude o un programador)

- `render.yaml` (Blueprint) en la raíz: servicio web Docker, plan starter, 1 instancia (SQLite), disco de 1 GB en `/data`, health check `/api/me`, `buildFilter` para no redesplegar con cambios del sitio web.
- Imagen: `Dockerfile` en la raíz; solo copia `gestion/`, `sitio-web/logic.js` y `sitio-web/assets/`.
- Variables fijadas en la imagen: `GESTION_DATA_DIR=/data`, `GESTION_CHROME=/usr/bin/chromium`, `GESTION_TRUST_PROXY=1`, `TZ=America/Mexico_City`. Render pone `PORT`. Opcional: `GESTION_SECRET` (si no, se genera y se guarda en `/data/config.json`).
- Render despliega desde el repo **andamiosrosas** (rama `master`), no desde el repo privado `andamios-rosas-gestion` que crea `subir-gestion.bat`: ese repo solo tiene `gestion/` y no arranca solo (le falta `sitio-web/`).
- Rutas: `GET /api/respaldo` (descarga `VACUUM INTO`) y `POST /api/restaurar` (cuerpo binario, sesión + encabezado `X-Pin`; valida `integrity_check`, guarda `respaldos/antes-de-restaurar-*.db` y termina el proceso con código 1 para que Render lo reinicie).
- Límite de PIN: 5 fallos por IP → 1 min; 30 fallos globales en 15 min → 15 min de bloqueo global.
