const ExcelJS = require('exceljs');
const OUT = require('path').join(__dirname, '..', 'assets', 'Formato-Spazio-Luce.xlsx');

const AMARILLO = 'FFF0D94D', CLARO = 'FFFFF8D6', NEGRO = 'FF0B0B09', GRIS = 'FFEEEEEE';
const ALCANCE = 'Todos los trabajos no incluidos en este presupuesto serán motivo de cotización por separado.';
const CONDICIONES = [
  ALCANCE,
  'Los precios están sujetos a cambio sin previo aviso. Esta cotización tiene una vigencia de 15 días naturales a partir de su fecha de emisión.',
  'Se solicita el 50% de anticipo para apartar mercancía o iniciar el pedido; el resto se liquida contra entrega o al terminar la instalación.',
  'No incluye instalación ni envío, salvo que se indique lo contrario en esta cotización.',
  'En pedidos especiales o fabricados a medida (cortinas, persianas, muebles), una vez cortado el material no se aceptan cambios, devoluciones ni cancelaciones.',
  'Antes de fabricar se rectifican las medidas en obra y el cliente debe dar su visto bueno; si ya no coinciden, el ajuste se cotiza por separado.',
  'El tiempo de entrega está sujeto a la disponibilidad y existencia de los materiales, y se confirma al recibir el anticipo.',
  'Para instalar, la obra debe estar en condiciones adecuadas (pisos, muros y techos terminados y acceso libre). Alturas de instalación mayores a 3 metros tienen un cargo adicional.',
  'La garantía cubre defectos de fabricación o instalación realizada por Spazio Luce. No cubre mal uso, desgaste normal, daños por terceros ni materiales instalados por personal ajeno a nuestro equipo.',
];
const FILAS = 50;       // renglones disponibles
const PRIMERA = 12;     // primera fila de la tabla
const ULTIMA = PRIMERA + FILAS - 1;

const borde = { style: 'thin', color: { argb: 'FFBBBBBB' } };
const bordes = { top: borde, left: borde, bottom: borde, right: borde };

function hojaPresupuesto(wb, nombre, conEjemplo) {
  const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: PRIMERA - 1, showGridLines: false }] });
  ws.columns = [{ width: 24 }, { width: 52 }, { width: 11 }, { width: 10 }, { width: 16 }, { width: 16 }];

  ws.mergeCells('A1:F1');
  const t = ws.getCell('A1');
  t.value = conEjemplo ? 'EJEMPLO (ya llenado) · mira cómo se llena' : 'SPAZIO LUCE · FORMATO DE COTIZACIÓN / PRESUPUESTO';
  t.font = { bold: true, size: 15, color: { argb: NEGRO } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMARILLO } };
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 30;

  ws.mergeCells('A2:F2');
  const i = ws.getCell('A2');
  i.value = 'Llena solo las celdas de color amarillo claro. Guárdalo y súbelo en la app: Presupuesto a mano → "Subir presupuesto", o Cotizar con catálogo → "Importar desde Excel". Todo se arma solo.';
  i.font = { size: 10, italic: true, color: { argb: 'FF555555' } };
  i.alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(2).height = 30;

  const datos = [
    ['CLIENTE', conEjemplo ? 'Gabriela Anaya' : ''],
    ['PROYECTO / DIRECCIÓN', conEjemplo ? 'Cortinas · Depto. Av. 20 de Noviembre No. 30' : ''],
    ['TELÉFONO O CORREO', conEjemplo ? '5512345678' : ''],
    ['FOLIO (opcional)', ''],
    ['FECHA (opcional)', conEjemplo ? new Date(2026, 10, 4) : ''],
    ['NOTA (opcional)', conEjemplo ? 'Cortinas a techo con apertura central. Incluir bastones.' : ''],
  ];
  datos.forEach(([etq, val], k) => {
    const r = 4 + k;
    const a = ws.getCell('A' + r); a.value = etq;
    a.font = { bold: true, size: 10 }; a.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } }; a.border = bordes;
    ws.mergeCells(`B${r}:F${r}`);
    const b = ws.getCell('B' + r); b.value = val;
    b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLARO } }; b.border = bordes;
    if (val instanceof Date) b.numFmt = 'dd/mm/yyyy';
    b.alignment = { horizontal: 'left' };
  });

  // Tabla
  const enc = ['SECCIÓN', 'CONCEPTO', 'UN', 'CANT.', 'P. UNITARIO', 'IMPORTE'];
  enc.forEach((txt, c) => {
    const cell = ws.getCell(PRIMERA - 1, c + 1);
    cell.value = txt;
    cell.font = { bold: true, color: { argb: 'FFF0D94D' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NEGRO } };
    cell.alignment = { horizontal: c >= 2 ? 'center' : 'left', vertical: 'middle' };
    cell.border = bordes;
  });
  ws.getRow(PRIMERA - 1).height = 22;

  const ejemplo = [
    ['Cortinas', 'GRECO 02 ARENA — cortina con falsos (ancho 5.07 × alto 2.65 m)', 'm²', 10.6, 420],
    ['Cortinas', 'CORTINERO MANUAL A TECHO', 'm', 5.07, 451],
    ['Cortinas', 'BASTÓN DE ALUMINIO 1.20 M', 'pza', 4, 220],
    ['Persianas', 'PERSIANA ENROLLABLE NIZZA (ancho 1.479 × alto 1.69 m, color ivory)', 'pza', 2, 1582.5],
    ['Instalación', 'ENTREGA Y COLOCACIÓN DE PERSIANAS Y CORTINAS', 'serv', 1, 3552],
  ];
  for (let r = PRIMERA; r <= ULTIMA; r++) {
    const fila = ws.getRow(r);
    const ej = conEjemplo ? ejemplo[r - PRIMERA] : null;
    for (let c = 1; c <= 6; c++) {
      const cell = fila.getCell(c);
      cell.border = bordes;
      if (c <= 5) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLARO } };
      if (ej && c <= 5) cell.value = ej[c - 1];
    }
    fila.getCell(4).numFmt = '#,##0.00';
    fila.getCell(5).numFmt = '$#,##0.00';
    fila.getCell(3).alignment = { horizontal: 'center' };
    fila.getCell(4).alignment = { horizontal: 'center' };
    fila.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    fila.getCell(6).value = { formula: `IF(AND(D${r}<>"",E${r}<>""),D${r}*E${r},"")` };
    fila.getCell(6).numFmt = '$#,##0.00';
    fila.getCell(6).font = { bold: true };
    fila.getCell(3).dataValidation = {
      type: 'list', allowBlank: true,
      formulae: ['"pza,m²,m,ml,caja,kg,lote,serv,jgo,par,día,hora"'],
    };
  }
  const tot = ULTIMA + 2;
  ws.getCell('E' + tot).value = 'TOTAL';
  ws.getCell('E' + tot).font = { bold: true };
  ws.getCell('E' + tot).alignment = { horizontal: 'right' };
  ws.getCell('F' + tot).value = { formula: `SUM(F${PRIMERA}:F${ULTIMA})` };
  ws.getCell('F' + tot).numFmt = '$#,##0.00';
  ws.getCell('F' + tot).font = { bold: true, size: 12 };
  return ws;
}

(async () => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Spazio Luce';
  wb.title = 'Formato de cotización / presupuesto';

  hojaPresupuesto(wb, 'Presupuesto', false);

  // Condiciones: una por renglón, la de siempre ya puesta
  const wc = wb.addWorksheet('Condiciones', { views: [{ showGridLines: false }] });
  wc.columns = [{ width: 4 }, { width: 110 }];
  wc.mergeCells('A1:B1');
  const c1 = wc.getCell('A1');
  c1.value = 'CONDICIONES QUE SALDRÁN AL FINAL (una por renglón)';
  c1.font = { bold: true, size: 13 };
  c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMARILLO } };
  c1.alignment = { vertical: 'middle', indent: 1 };
  wc.getRow(1).height = 26;
  wc.mergeCells('A2:B2');
  wc.getCell('A2').value = 'Ya vienen las de siempre. Puedes cambiarlas, borrarlas o agregar más renglones. Si borras todo, se usan las de siempre.';
  wc.getCell('A2').font = { size: 10, italic: true, color: { argb: 'FF555555' } };
  for (let r = 4; r <= 23; r++) {
    wc.getCell('A' + r).value = r - 3;
    wc.getCell('A' + r).font = { color: { argb: 'FF999999' } };
    const b = wc.getCell('B' + r);
    b.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CLARO } };
    b.border = bordes;
    b.alignment = { wrapText: true, vertical: 'top' };
    if (r - 4 < CONDICIONES.length) b.value = CONDICIONES[r - 4];
  }

  hojaPresupuesto(wb, 'Ejemplo', true);

  // Instrucciones
  const wi = wb.addWorksheet('Cómo se llena', { views: [{ showGridLines: false }] });
  wi.columns = [{ width: 110 }];
  const lineas = [
    ['CÓMO SE LLENA ESTE FORMATO', true],
    ['', false],
    ['1. En la hoja "Presupuesto" escribe el cliente, el proyecto y su teléfono o correo (solo las celdas amarillo claro).', false],
    ['2. Cada renglón es un concepto: SECCIÓN (opcional, por ejemplo Cortinas o Herrería), CONCEPTO, UN (unidad), CANT. y P. UNITARIO.', false],
    ['3. El IMPORTE se calcula solo. No lo escribas.', false],
    ['4. Si algo lleva medidas o detalles (ancho, alto, color), escríbelos dentro del CONCEPTO, entre paréntesis.', false],
    ['5. Las condiciones del final están en la hoja "Condiciones": ya trae la de siempre y puedes cambiarla o agregar más.', false],
    ['6. Guarda el archivo y súbelo en la app (Presupuesto a mano → Subir presupuesto, o Cotizar con catálogo → Importar desde Excel).', false],
    ['7. Revisa los renglones que aparecen, elige IVA si hace falta y pulsa Generar. Todavía puedes corregir cualquier cosa antes.', false],
    ['', false],
    ['Notas:', true],
    ['• Si un concepto no tiene precio todavía, déjalo con precio vacío y complétalo en la app.', false],
    ['• No cambies los títulos de las columnas ni muevas las filas de arriba: la app los usa para entender el archivo.', false],
    ['• La hoja "Ejemplo" muestra cómo queda ya llenado; no se sube, solo se lee la primera hoja.', false],
  ];
  lineas.forEach(([txt, negrita], k) => {
    const c = wi.getCell('A' + (k + 1));
    c.value = txt; c.font = { bold: negrita, size: negrita ? 13 : 11 };
    c.alignment = { wrapText: true, vertical: 'top' };
  });

  await wb.xlsx.writeFile(OUT);
  console.log('creado', OUT);
})();
