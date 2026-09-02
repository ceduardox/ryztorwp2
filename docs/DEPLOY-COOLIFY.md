# Despliegue en Coolify — Deploy rápido y liviano (ryzapp.org)

> Documento vivo. Explica cómo se despliega este proyecto, por qué un deploy puede tardar
> mucho y qué se hizo para que sea rápido y no consuma recursos del servidor.

Fecha: 2026-08-26

---

## 1. Cómo se despliega (flujo normal)

1. Se hacen cambios en el código y se hace `git push` a `main`.
2. **Coolify detecta el push** y reconstruye la imagen Docker automáticamente.
3. El contenedor arranca, corre `drizzle-kit push` (sincroniza la DB) y levanta el servidor en `dist/index.cjs`.

También se puede forzar desde Coolify con el botón **Deploy / Redeploy** sin cambiar código.

## 2. Lo normal vs lo lento

- **Deploy normal (~1–2 min):** Docker reutiliza las capas cacheadas → `npm ci` y `npm run build` no se repiten por completo.
- **Deploy lento (~10+ min):** la caché de Docker está **fría** (cold cache) → se vuelve a bajar la imagen base, `npm ci` y el build desde cero. Además consume CPU/RAM/disco del VPS durante todo ese tiempo.

## 3. Qué INVALIDA la caché (esto provoca los deploys lentos)

1. **`package.json` o `package-lock.json`** cambian → `npm ci` completo.
2. **`Dockerfile`** cambia (cualquier línea antes del `RUN npm run build`).
3. **Coolify purga/rota su caché** (mantenimiento, falta de disco).
4. **La imagen base se re-descarga** (cambio de tag o se perdió localmente).

El siguiente deploy **sin** cambios de dependencias/`Dockerfile` vuelve a ser rápido (caché caliente).

## 4. Lo que ya se optimizó (importante)

**Imagen base — ANTES vs AHORA:**
- **ANTES**: `mcr.microsoft.com/playwright:v1.60.0-noble` (~2 GB, trae todos los navegadores). **Nadie usa Playwright** en el proyecto.
- **AHORA** (`Dockerfile` actual): `FROM node:20-slim` (~80 MB) + `ffmpeg` y `ca-certificates` instalados por apt (ffmpeg se necesita para audio/video; `ffmpeg-static` como respaldo).

**`.dockerignore` (nuevo):** excluye `node_modules` (402 MB), `dist`, `.git`, `.env`, logs, PDFs, `attached_assets`, etc.
- Antes el contexto de build era ~415 MB; ahora es ~1–2 MB. Se transfiere a Docker en cada deploy.

> Nota: el primer deploy después de cambiar la imagen base o el Dockerfile será lento (invalida la caché una vez). Los siguientes, sin tocar `package-lock` ni `Dockerfile`, vuelven a ser rápidos.

## 5. Diagnóstico (si vuelve a tardar)

En Coolify abre los **logs del deploy** y mira qué paso tarda:
- `Pulling image...` lento → imagen base (revisar que no se haya vuelto a Playwright).
- `npm ci` lento → caché fría / cambió `package-lock`.
- `npm run build` lento → build de Vite (CPU del VPS; normal en deploys que tocan código).
- `apt-get install ffmpeg` lento → primera vez tras cambiar la imagen base (se cachea después).

## 6. Config de Coolify (verificada / recomendada)

- **"Disable Build Cache" debe estar APAGADA** (usar la caché de Docker). ✔
- **"Include Source Commit in Build" APAGADA** (si se activa, inyecta el SHA y rompe la caché de capas).
- Variables de entorno: `DATABASE_URL`, `WA_*`, `META_*`, `OPENAI_API_KEY`, `ADMIN_USER`, `ADMIN_PASS`, `ONESIGNAL_REST_API_KEY`, etc. (según `.env`).

## 7. Nota sobre "cada deploy es lento aunque cambie poco"

- `npm run build` (Vite + esbuild) **se re-ejecuta en cada deploy que toca código fuente** (la capa `COPY . .` cambia). Es normal e inevitable mientras cambie el código.
- `npm ci` **debe quedar cacheado**. Si se re-instala en cada deploy pese a tener "Disable Build Cache" apagada, revisar que `package-lock.json` y `Dockerfile` no cambien y que Coolify no purgue la caché.

## 8. Checklist para no repetir el susto

- [ ] No tocar `package.json`/`package-lock.json` salvo necesidad real.
- [ ] No cambiar `Dockerfile` salvo necesidad real (invalida la caché una vez).
- [ ] Mantener "Disable Build Cache" apagada y "Include Source Commit" apagada en Coolify.
- [ ] Mantener el `.dockerignore` (no borrarlo).
- [ ] Si un deploy tarda mucho: mirar los logs (¿imagen base? ¿`npm ci`? ¿Vite?) y confirmar que el siguiente sin cambios es rápido.

## 9. Particularidades de este proyecto

- **Audio/TTS**: el servidor usa `ffmpeg` (routes.ts). Está instalado en la imagen (`apt-get install ffmpeg`); `ffmpeg-static` es el respaldo si hiciera falta.
- **DB al arrancar**: el `CMD` corre `npx drizzle-kit push || echo WARNING...` antes de `node dist/index.cjs`. Si la DB tarda, el arranque se demora un poco (normal).
- **Imágenes de producto**: se guardan en Postgres (`product_uploaded_images`), no en el filesystem → **no** se necesita volumen para que persistan.
