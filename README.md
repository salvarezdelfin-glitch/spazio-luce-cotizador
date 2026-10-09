# Spazio Luce · Sistema de Gestión

Cotizador, presupuestos y CRM internos de Spazio Luce.

- **App:** https://salvarezdelfin-glitch.github.io/spazio-luce-cotizador/
- **CRM:** https://salvarezdelfin-glitch.github.io/spazio-luce-cotizador/crm/
- **Backend:** Supabase, proyecto `SPAZIO` (`smjktuithhvfmexysvkf`) — Auth, Postgres (`clientes`, `cotizaciones`, `crm_leads`, `gastos`, `app_users`), Edge Functions (notificaciones y reporte semanal por correo).

## Acceso

Login real con Supabase Auth. Solo entran correos dados de alta en la tabla `app_users` (ahí se agrega gente nueva).

## Estructura

- `index.html` / `css/styles.css` / `js/app.js` — la app principal (Dashboard, Clientes, Cotizador, Presupuestos, Contabilidad).
- `js/directorio.js` y `js/prospectos.js` — sección Directorio, organizada en grupos (Clientes, Trabajadores, Proveedores, Aliados, Servicios, Otros; el grupo se deduce del tipo): contactos en la tabla `directorio` (los clientes siguen en `clientes`), comparador de precios por oficio y unidad, y prospectos a contratar (tabla `prospectos`). Mismas reglas de acceso que el resto.
- `crm/index.html` — CRM de leads, sincronizado con las cotizaciones.
- `manifest.json` / `sw.js` / `icons/` — soporte de PWA (instalable desde el navegador).

## Seguridad

**Quién entra.** Solo los correos de `app_users`. Esa tabla no se puede modificar desde la app ni desde la API (solo lectura de la propia fila); para dar de alta a alguien se hace desde el panel de Supabase o con SQL. Cada tabla de negocio exige estar en esa lista (RLS). Además, un candado en la base de datos (trigger `solo_correos_autorizados` sobre `auth.users`) impide **crear una cuenta** con un correo que no esté en `app_users`: un desconocido que intente registrarse recibe un rechazo y no se crea nada. Para dar acceso a alguien nuevo: primero agregar su correo a `app_users` y después crear su cuenta (o invitarlo desde el panel de Supabase).

**Límite de envíos (rate limiting).** Los formularios públicos del sitio (cotizar y opinar) escriben sin sesión y cada envío manda un correo. Los limita un trigger en la base (`limit_public_insert`), por IP real (`cf-connecting-ip`, no se puede falsificar) y en total:

| Formulario | Por IP / hora | Total / hora | Total / día |
|---|---|---|---|
| `crm_leads` (cotizar) | 5 | 30 | 60 |
| `reviews` (opinar) | 3 | 15 | 30 |

Al pasarse responde HTTP 429. El equipo con sesión iniciada no tiene ese tope. Para cambiar los números: recrear el trigger `a_rate_limit_<tabla>` con otros tres valores (`limit_public_insert(por_ip_hora, total_hora, total_dia)`).

**Inyección SQL.** La app nunca arma SQL: todo va por PostgREST con parámetros. Lo único que se arma con texto es la URL, y por eso `sbTable`, `sbId` y `sbOrder` (en `js/app.js` y `crm/index.html`) aceptan solo tablas conocidas, enteros positivos y órdenes con patrón estricto. Las funciones de la base no usan SQL dinámico y tienen `search_path` fijo. La base además rechaza datos fuera de límite en `crm_leads` y `reviews` (longitudes y tamaño del JSON).

**Llaves y secretos:** ver la sección "Llaves y secretos" más abajo. Los datos no los protege esconder la llave del navegador sino Auth + `app_users` + RLS.

**Pendiente en el panel de Supabase (no se puede hacer desde el código):**
1. (Opcional) Authentication → apagar "Allow new users to sign up". Ya no hace falta para cerrar el registro, porque el candado de la base de datos lo bloquea; apagarlo solo agrega una segunda capa.
2. Authentication → Rate Limits: revisar los topes de inicio de sesión y de correos.
3. Authentication → Password security: activar "Leaked password protection".
4. Authentication → URL Configuration: que "Site URL" y "Redirect URLs" sean solo `https://salvarezdelfin-glitch.github.io/spazio-luce-cotizador/` (quitar las que no se usen). Es a donde viaja el enlace de recuperar contraseña.

**Mantenerlo vivo.** `.github/workflows/keep-supabase-alive.yml` consulta `reviews` (pública) cada 3 días; no usa tablas privadas a propósito.

## Llaves y secretos

| Qué | Dónde vive | ¿Es secreto? | Si se filtra |
|---|---|---|---|
| Llave publicable `sb_publishable_…` | `js/app.js`, `crm/index.html`, sitio web | No. Es pública por diseño: va en el navegador de cualquiera. | Nada urgente; se puede rotar en Supabase → Settings → API Keys. |
| Llave `anon` (JWT antigua) | Ya no la usa el cotizador; la siguen usando otras apps del mismo proyecto de Supabase. | No | No desactivarla hasta migrar esas apps. |
| `service_role` de Supabase | Solo dentro de las Edge Functions (variable de entorno de Supabase). | **Sí: acceso total a todo.** | Rotarla de inmediato en Supabase → Settings → API Keys. Nunca va en el repo ni en el navegador. |
| Llave de Resend | Vault de Supabase (`resend_api_key`). | Sí | Crear otra en Resend, borrar la vieja y guardar la nueva con `vault.update_secret`. |
| Secreto de los webhooks | Vault de Supabase (`webhook_secret`). | Sí | Rotar con el SQL de abajo. |
| Contraseñas de usuarios | Supabase Auth (con hash). | Sí | Cambiarla desde "¿Olvidaste tu contraseña?". |

**Rotar el secreto de los webhooks** (no rompe nada: los triggers, el cron y las funciones lo leen de Vault cada vez):

```sql
select vault.update_secret(
  (select id from vault.decrypted_secrets where name = 'webhook_secret'),
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''));
```

Última rotación: 2026-10-08. Conviene repetirla cada 6 meses o ante cualquier sospecha.

**Reglas del repositorio (es público):**
- Nada de secretos en el código. GitHub tiene activados el escaneo de secretos y la protección al subir, y `.gitignore` bloquea `.env`, `*.key` y `*.pem`. El historial completo se revisó el 2026-10-08: solo contiene la llave pública.
- Si una llave secreta se sube por error: primero **rotarla**, después limpiar. Borrarla del historial no basta, desde que fue pública se considera comprometida.
- El almacén `producto-fotos` solo acepta PNG, JPG, WebP y GIF de hasta 5 MB (nada de SVG/HTML). `respaldos` solo acepta JSON y no es público.


## Publicar cambios

No hay paso de build. Cualquier cambio en `main` se publica solo vía GitHub Pages:

```bash
git add -A
git commit -m "describe el cambio"
git push
```
