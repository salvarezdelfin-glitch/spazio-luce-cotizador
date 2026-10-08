# Spazio Luce · Sistema de Gestión

Cotizador, presupuestos y CRM internos de Spazio Luce.

- **App:** https://salvarezdelfin-glitch.github.io/spazio-luce-cotizador/
- **CRM:** https://salvarezdelfin-glitch.github.io/spazio-luce-cotizador/crm/
- **Backend:** Supabase, proyecto `SPAZIO` (`smjktuithhvfmexysvkf`) — Auth, Postgres (`clientes`, `cotizaciones`, `crm_leads`, `gastos`, `app_users`), Edge Functions (notificaciones y reporte semanal por correo).

## Acceso

Login real con Supabase Auth. Solo entran correos dados de alta en la tabla `app_users` (ahí se agrega gente nueva).

## Estructura

- `index.html` / `css/styles.css` / `js/app.js` — la app principal (Dashboard, Clientes, Cotizador, Presupuestos, Contabilidad).
- `crm/index.html` — CRM de leads, sincronizado con las cotizaciones.
- `manifest.json` / `sw.js` / `icons/` — soporte de PWA (instalable desde el navegador).

## Seguridad

**Quién entra.** Solo los correos de `app_users`. Esa tabla no se puede modificar desde la app ni desde la API (solo lectura de la propia fila); para dar de alta a alguien se hace desde el panel de Supabase o con SQL. Cada tabla de negocio exige estar en esa lista (RLS).

**Límite de envíos (rate limiting).** Los formularios públicos del sitio (cotizar y opinar) escriben sin sesión y cada envío manda un correo. Los limita un trigger en la base (`limit_public_insert`), por IP real (`cf-connecting-ip`, no se puede falsificar) y en total:

| Formulario | Por IP / hora | Total / hora | Total / día |
|---|---|---|---|
| `crm_leads` (cotizar) | 5 | 30 | 60 |
| `reviews` (opinar) | 3 | 15 | 30 |

Al pasarse responde HTTP 429. El equipo con sesión iniciada no tiene ese tope. Para cambiar los números: recrear el trigger `a_rate_limit_<tabla>` con otros tres valores (`limit_public_insert(por_ip_hora, total_hora, total_dia)`).

**Inyección SQL.** La app nunca arma SQL: todo va por PostgREST con parámetros. Lo único que se arma con texto es la URL, y por eso `sbTable`, `sbId` y `sbOrder` (en `js/app.js` y `crm/index.html`) aceptan solo tablas conocidas, enteros positivos y órdenes con patrón estricto. Las funciones de la base no usan SQL dinámico y tienen `search_path` fijo. La base además rechaza datos fuera de límite en `crm_leads` y `reviews` (longitudes y tamaño del JSON).

**Llaves.** La llave `anon` de `js/app.js` es pública por diseño: lo que protege los datos es RLS, no ocultarla. El anónimo solo puede hacer `INSERT` en `crm_leads`, `INSERT`/`SELECT` en `reviews` y `SELECT` en `producto_fotos`. La llave `service_role`, la de Resend y el secreto de los webhooks no están en el repo: viven en las variables de las Edge Functions y en Vault (`get_app_secret`). Las Edge Functions comparan el secreto en tiempo constante y escapan el texto de los formularios antes de armar el correo.

**Pendiente en el panel de Supabase (no se puede hacer desde el código):**
1. Authentication → desactivar "Allow new users to sign up" (hoy cualquiera puede crear una cuenta, aunque sin acceso a datos).
2. Authentication → Rate Limits: revisar los topes de inicio de sesión y de correos.
3. Authentication → Password security: activar "Leaked password protection".

**Mantenerlo vivo.** `.github/workflows/keep-supabase-alive.yml` consulta `reviews` (pública) cada 3 días; no usa tablas privadas a propósito.

## Publicar cambios

No hay paso de build. Cualquier cambio en `main` se publica solo vía GitHub Pages:

```bash
git add -A
git commit -m "describe el cambio"
git push
```
