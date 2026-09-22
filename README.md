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

## Publicar cambios

No hay paso de build. Cualquier cambio en `main` se publica solo vía GitHub Pages:

```bash
git add -A
git commit -m "describe el cambio"
git push
```
