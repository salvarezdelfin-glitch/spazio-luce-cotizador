# Herramientas

## `make-plantilla.js` — regenerar el formato de Excel
Crea `assets/Formato-Spazio-Luce.xlsx` (hojas: Presupuesto, Condiciones, Ejemplo, Cómo se llena). Si cambian las condiciones de siempre,
edita la lista `CONDICIONES` del archivo y vuelve a generarlo:

```bash
cd tools
npm install exceljs      # solo para esta herramienta; no es una dependencia de la app
node make-plantilla.js
```
