# Sistema de Gestión de Spazio Luce (cotizador) — guía para trabajar en el código

App interna de Spazio Luce (iluminación, remodelación, cortinas y persianas): cotizaciones y presupuestos, clientes, directorio de
contactos, contabilidad, reportes y CRM. **JavaScript puro (sin build) + Supabase**, publicada en GitHub Pages.

- **App en vivo:** https://salvarezdelfin-glitch.github.io/spazio-luce-cotizador/
- **Repositorio:** https://github.com/salvarezdelfin-glitch/spazio-luce-cotizador (público: **nunca subir llaves ni secretos**)
- **Base de datos:** proyecto Supabase `SPAZIO` (id `smjktuithhvfmexysvkf`). **Es compartido con otras apps** (clases, potenciador…):
  solo se tocan las tablas y funciones del cotizador (ver `docs/base-de-datos.md`). No tocar `pc_*`, `clases_vault_*`, `rate_limits`.

## Cómo se publica (importante)
- Rama `dev` = trabajo; rama `main` = producción. Todo lo que entra a `main` se publica solo en GitHub Pages (1–3 min).
- Flujo usado: commit en `dev` → `git push origin dev` → `git checkout main && git merge --ff-only dev && git push origin main` → volver a `dev`.
- Antes de publicar: `node --check js/*.js` (no hay build ni pruebas automáticas) y cambiar `APP_VERSION` en `js/app.js`
  (es el texto que aparece abajo a la izquierda en la app; sirve para comprobar que ya se actualizó). Si agregas un archivo en `js/`,
  ponlo en `index.html` y en la lista `APP_SHELL` de `sw.js` y sube el número de `CACHE_NAME`.
- Probar en local sin instalar nada: `npx serve -l 8126` dentro de esta carpeta (o cualquier servidor estático) y abrir `http://localhost:8126`.
  Para probar pantallas sin iniciar sesión se pueden simular las llamadas a la base en la consola del navegador (`window.sbSelectRaw = ...`).

## Estructura
- `index.html` — la app (login, menú, todas las pantallas y ventanas emergentes). Los scripts se cargan al final, en este orden:
  `catalog.js`, `importers.js`, `app.js`, `directorio.js`, `prospectos.js`, `margen.js`, `condiciones.js`, `facil.js`, `guardar-en-carpeta.js`.
- `js/app.js` — núcleo: acceso a Supabase (`sbSelectRaw/sbInsert/sbUpdate/sbDelete`, con listas permitidas: `SB_TABLES`, `sbId`, `sbOrder`),
  Dashboard/Inicio, Cotizador (catálogo, filas por pieza / por caja-m² / por m² de persiana), Presupuestos, recibo (hoja de la cotización),
  Contabilidad, Reportes, seguimiento, login.
- `js/catalog.js` — catálogo de productos y precios (iluminación, candiles, pisos y muros, persianas EHG, cortinas…), grupos de navegación y ayudas.
- `js/importers.js` — leer Excel, PDF, Word e **imágenes (OCR con Tesseract.js en el navegador)** y convertirlos en renglones. Incluye el lector de
  cotizaciones de proveedor (tabla sin "$") y el lector genérico de tablas; también lee el formato de Excel de Spazio Luce.
- `js/guardar-en-carpeta.js` — genera el **PDF** (paginación propia: cortes solo entre bloques, pie fijo, hoja blanca o negra) y lo guarda en una
  carpeta de la computadora (File System Access API, solo Chrome/Edge). También expone `window.spazioPdf` para WhatsApp/“Ver / Imprimir PDF”.
- `js/directorio.js`, `js/prospectos.js` — Directorio (clientes, trabajadores, proveedores, aliados, servicios), comparador de precios y prospectos.
- `js/condiciones.js` — condiciones editables al final de cada cotización (las “de siempre” se guardan en la tabla `ajustes`).
- `js/margen.js` — “Ajuste de precios” de Presupuestos (÷ 0.70 o × 1.30 sobre precios originales de proveedor). **Es solo interno**: no se
  imprime ni se guarda ningún rastro en la cotización.
- `js/facil.js` — letra grande, barra fija con total, ayuda, avisos, hoja blanca/negra, aviso de versión nueva.
- `css/styles.css` — todos los estilos (tema oscuro con dorado). `sw.js` — PWA (red primero, caché como respaldo).
- `crm/index.html` — CRM de leads (archivo único, sincronizado con las cotizaciones). `assets/Formato-Spazio-Luce.xlsx` — formato de Excel
  descargable (se regenera con `tools/make-plantilla.js`).

## Reglas del negocio que el código respeta
- Los precios del catálogo ya incluyen IVA (16 %); la cotización impresa nunca desglosa IVA aparte.
- Fórmula de precios de Tekno-Step: costo (LAB) ÷ 0.70 × 1.16. Persianas EHG: lista × 1.40 (sin × 1.16). Instalación de persiana EHG: botón de $350.
- La **ganancia** se calcula como el 30 % de lo cobrado sin IVA (`MARGEN_GANANCIA` en `js/app.js`); en Contabilidad el flujo (ingresos − egresos)
  no se presenta como ganancia.
- La app debe seguir funcionando “como siempre”: las mejoras se agregan sin cambiar lo que ya hacían los botones de IVA / precio LAB ni el catálogo.
- Los renglones por caja (pisos/muros) guardan `coverage`; por m² guardan `pricePerM2`, `ancho`, `alto`, `m2`, `installFee`. Al editar una
  cotización se reconstruye cada tipo de renglón (`addSavedItemRow`).
- Acceso: solo correos en la tabla `app_users` (RLS en todas las tablas + candado en `auth.users`). Para dar acceso a alguien nuevo hay que agregarlo ahí.

## Cosas que conviene saber antes de tocar
- html2canvas **pinta el fondo de un `inline-block` encima de su contenido** (por eso `.logo-block` es `display:block; width:fit-content`).
- El PDF se genera siempre desde una copia fuera de pantalla de la hoja y con `scrollX/scrollY: 0`; no usar `window.print()` para el PDF.
- Los archivos viejos usan saltos de línea de Windows (CRLF); al editar con scripts conservar el estilo del archivo.
- Hay un sitio viejo en Netlify (`inspiring-pika-58697d.netlify.app`) que quedó como respaldo y **no recibe cambios**.
- El correo semanal (Edge Function `weekly-report`, Supabase) usa la misma regla del 30 %.

## Base de datos y funciones en Supabase
Ver `docs/base-de-datos.md`. Los cambios de esquema se hicieron como migraciones desde Claude Code (herramienta de Supabase); si trabajas desde
otro equipo, conecta el servidor MCP de Supabase de tu cuenta o usa el panel de Supabase.

## Cómo seguir desde otro ordenador
1. Instalar Git y Node.js. 2. `git clone https://github.com/salvarezdelfin-glitch/spazio-luce-cotizador.git` y `git checkout dev`.
3. Abrir la carpeta con Claude Code (este archivo le da el contexto). 4. Para ver la app: `npx serve -l 8126`.
5. Publicar con el flujo de arriba. No hace falta instalar nada más: no hay dependencias del proyecto.
