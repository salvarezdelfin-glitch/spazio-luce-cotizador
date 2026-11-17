# Base de datos (Supabase, proyecto SPAZIO · `smjktuithhvfmexysvkf`)

Solo las tablas del cotizador. Todas tienen **RLS activado**; la política es: puede leer y escribir quien tenga sesión y su correo esté en
`app_users` (excepto donde se indica). `anon` no tiene acceso salvo los dos formularios públicos del sitio (`crm_leads` y `reviews`, con límite de envíos).

| Tabla | Para qué | Columnas |
|---|---|---|
| `cotizaciones` | cotizaciones y presupuestos | id, folio, client, phone, email, address, items (jsonb), subtotal, iva, total, estatus, generado_por, fecha, note, pagado, fecha_pago, metodo_pago, monto_pagado, iva_incluido, condiciones (jsonb: null = condiciones de siempre, lista = las suyas) |
| `clientes` | clientes (se llena solo al cotizar) | id, name, created_at, telefono, email, direccion, notas, colonia, ciudad, referencias, maps_link, origen |
| `directorio` | trabajadores, proveedores, aliados, servicios | id, created_at, name, tipo, empresa, telefono, telefono2, email, direccion, colonia, ciudad, referencias, maps_link, tarifa, calificacion (1–5), notas, tarifa_monto, tarifa_unidad, contratacion, emergencia, origen |
| `prospectos` | gente nueva a contratar | id, created_at, name, oficio, telefono, zona, fuente, estatus (Por contactar / Contactado / Entrevista / Prueba / Contratado / Descartado), seguimiento, tarifa_monto, tarifa_unidad, notas |
| `ajustes` | ajustes compartidos (clave `condiciones_base` = condiciones de siempre) | id, clave (única), valor (jsonb), updated_at |
| `gastos` | egresos (Contabilidad) | id, fecha, concepto, categoria, proveedor, monto, iva_incluido, metodo_pago, notas, generado_por, created_at |
| `crm_leads` | CRM de leads (formulario público + manual) | id, nombre, empresa, telefono, email, tipo, lineas, fuente, etapa, valor, proxima_accion, proxima_fecha, motivo_perdido, notas, creado, actualizado, cotizaciones, historial, responsable |
| `producto_fotos` | foto por producto del catálogo | id, producto_nombre, foto_url, updated_at, updated_por |
| `reviews` | opiniones del sitio público | id, created_at, nombre, ubicacion, proyecto, tipo, rating, comentario, aprobado, destacada, telefono |
| `app_users` | correos autorizados (solo lectura de la propia fila desde la app) | email, created_at |

## Seguridad
- Candado `solo_correos_autorizados` sobre `auth.users`: nadie fuera de `app_users` puede crear cuenta.
- Límite de envíos (`limit_public_insert`) en `crm_leads` y `reviews`; límites de tamaño/longitud en columnas de texto.
- Secretos (llave de Resend, secreto de webhooks) viven en el Vault de Supabase, nunca en el repositorio. La llave publicable `sb_publishable_…`
  que aparece en el código es pública por diseño.
- Edge Functions del cotizador: `notify-lead`, `notify-review`, `weekly-report` (correo semanal + respaldo), `verify-backup`.
  Se protegen con el encabezado `x-webhook-secret` (`verify_jwt` apagado a propósito).
- Almacenes (Storage): `producto-fotos` (público, solo imágenes ≤ 5 MB) y `respaldos` (privado, JSON).
