// Lectura y parseo de PDF/Excel compartido por el Cotizador y Presupuestos.
// Todo el "entender el documento" vive aquí, una sola vez: cada vista solo
// decide qué hacer con las filas que salen (addProductRow o addPresuRow).
// Antes cada vista tenía su propia copia y los arreglos se hacían en una sola.
// Una fila interpretada es { name, qty, price, unit, section }.

// Abreviaturas de unidad reales que puede traer un PDF antes de la cantidad
// (ej. "... PZA 3 $150.50"). Antes se adivinaba por longitud de palabra (<=4
// letras), lo que se comía nombres cortos de producto ("Test", "LED") como si
// fueran unidad. Con lista fija solo se separa cuando de verdad es una unidad.
const KNOWN_UNITS = ['pza', 'pzas', 'pz', 'ml', 'm2', 'm²', 'kg', 'hr', 'hrs', 'lote', 'lte', 'jgo', 'par', 'serv', 'un', 'und', 'glb', 'caja', 'cajas', 'rollo', 'mt', 'mts', 'sal'];

// Encabezado de sección dentro de un PDF/Word: antes solo se reconocía si la línea
// estaba TODO EN MAYÚSCULAS, pero la mayoría de los presupuestos reales usan
// Título Con Mayúsculas Iniciales (ej. "Herrería", "Plomería", "Cocina Integral") y
// esas nunca se detectaban. Ahora acepta ambos estilos.
function looksLikeSectionHeader(lineText) {
  const t = lineText.trim();
  if (t.length < 3 || t.length > 40) return false;
  if (/\d/.test(t)) return false;
  if (/[.,;:$]/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 5) return false;
  const isAllCaps = t === t.toUpperCase() && t !== t.toLowerCase();
  const isTitleCase = words.every(w => /^[A-ZÁÉÍÓÚÑ]/.test(w));
  return isAllCaps || isTitleCase;
}

// Busca folio, fecha y nota dentro del texto completo de un documento importado
// (PDF o Word). Es "mejor esfuerzo": si no encuentra algo, se deja vacío para que
// se escriba a mano — nunca bloquea la importación.
function extractDocMeta(fullText) {
  const meta = {};
  const folioMatch = fullText.match(/Folio:?\s*(\S+)/i);
  if (folioMatch) meta.folio = folioMatch[1];

  const fechaMatch = fullText.match(/Fecha:?\s*(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/i);
  if (fechaMatch) {
    let [, d, m, y] = fechaMatch;
    if (y.length === 2) y = '20' + y;
    meta.fecha = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  const notaMatch = fullText.match(/NOTA:\s*(.+?)(?:\n|\s{2,}[A-ZÁÉÍÓÚÑ]{4,}|SUBTOTAL|$)/i);
  if (notaMatch) meta.nota = notaMatch[1].trim().slice(0, 300);

  // Para que "subir archivo -> generar" funcione con un solo clic, se detecta
  // también el cliente y el proyecto si el documento ya trae esos campos
  // etiquetados (formato típico de un presupuesto Spazio Luce: CLIENTE / OBRA /
  // DIRECCIÓN-PROYECTO / FECHA en la parte de arriba).
  const clienteMatch = fullText.match(/CLIENTE:?\s+(.+)/i);
  if (clienteMatch) meta.cliente = clienteMatch[1].trim().slice(0, 150);

  const proyectoMatch = fullText.match(/(?:DIRECCIÓN\s*\/\s*PROYECTO|PROYECTO|DIRECCION\s*\/\s*PROYECTO):?\s+(.+)/i);
  if (proyectoMatch) meta.proyecto = proyectoMatch[1].trim().slice(0, 200);

  return meta;
}


// Separa del texto que va antes del primer monto la cantidad y la unidad, en
// cualquiera de los dos órdenes reales ("PZA 3" o "15 m2"). Cada patrón exige
// que el número sea un token completo (inicio de texto o espacio antes): sin
// eso, un código de modelo como "A19" o "MS40" se leía como cantidad 19/40 y
// cortaba el nombre del producto.
function splitQtyUnit(before) {
  const isUnit = w => KNOWN_UNITS.includes(w.toLowerCase().replace(/\./g, ''));
  let m = before.match(/(?:^|\s)(\S+)\s+(\d+(?:\.\d+)?)\s*$/);
  if (m && isUnit(m[1])) return { name: before.slice(0, m.index).trim(), qty: parseFloat(m[2]), unit: m[1] };
  m = before.match(/(?:^|\s)(\d+(?:\.\d+)?)\s+(\S+)\s*$/);
  if (m && isUnit(m[2])) return { name: before.slice(0, m.index).trim(), qty: parseFloat(m[1]), unit: m[2] };
  m = before.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*$/);
  if (m) return { name: before.slice(0, m.index).trim(), qty: parseFloat(m[1]), unit: '' };
  return { name: before, qty: 1, unit: '' };
}

// Lee un PDF y lo devuelve como páginas de renglones de texto (de arriba hacia
// abajo). Los PDFs no tienen columnas reales: se reconstruye cada renglón
// agrupando los fragmentos de texto por posición Y (con tolerancia).
async function readPdfPages(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    const rowsByY = {};
    content.items
      .map(it => ({ text: it.str, x: it.transform[4], y: Math.round(it.transform[5] / 3) * 3 }))
      .filter(it => it.text.trim())
      .forEach(it => { (rowsByY[it.y] = rowsByY[it.y] || []).push(it); });
    const lines = Object.keys(rowsByY).map(Number).sort((a, b) => b - a)
      .map(y => rowsByY[y].sort((a, b) => a.x - b.x).map(r => r.text).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    pages.push(lines);
  }
  return pages;
}

// Convierte los renglones de un PDF en filas. Es "mejor esfuerzo": siempre puede
// haber errores, por eso las filas quedan editables antes de generar.
// fullText se devuelve para que quien lo quiera lea folio/cliente/fecha.
function parsePdfPages(pages) {
  const rows = [];
  const allLines = [];
  let section = '';
  let pending = '';

  pages.forEach(lines => {
    pending = '';
    lines.forEach(lineText => {
      allLines.push(lineText);

      if (looksLikeSectionHeader(lineText)) { section = lineText; pending = ''; return; }

      // Total del propio documento: la app ya recalcula el total sola, importarlo
      // como renglón duplicaría el importe real.
      if (/^\s*(SUMA|SUB\s*-?\s*TOTAL|GRAN\s*TOTAL|TOTAL)\b/i.test(lineText)) { pending = ''; return; }

      const money = [...lineText.matchAll(/\$\s*([\d,]+\.\d{2})/g)];
      if (money.length === 0) {
        // Número de fila suelto (" 2", " 3"...): no aporta nada.
        if (/^\d+$/.test(lineText)) return;
        // Encabezado de la tabla o datos del documento: no son parte de un concepto.
        if (/\b(CONCEPTO|DESCRIPCI[OÓ]N)\b.*\b(CANT|P\.?\s?U|IMPORTE|PRECIO)/i.test(lineText)) { pending = ''; return; }
        if (/^(CLIENTE|FOLIO|FECHA|OBRA|PROYECTO|DIRECCI[OÓ]N|NOTA)\b\s*[:\/]/i.test(lineText)) return;
        // Un concepto largo envuelve en 2-3 líneas y solo la última trae
        // UN/CANT/PRECIO: esta línea es el inicio real del nombre, se pega a la
        // siguiente línea que sí traiga precio.
        pending = (pending + ' ' + lineText).trim().slice(-300);
        return;
      }

      const amounts = money.map(m => parseFloat(m[1].replace(/,/g, '')));
      const before = lineText.slice(0, lineText.indexOf(money[0][0])).trim();
      const { name: rest, qty, unit } = splitQtyUnit(before);
      const name = (pending + ' ' + rest).replace(/^\d+\s+/, '').trim();
      pending = '';
      if (!name || name.length < 3) return;

      // Con dos montos es la tabla real P.U. / Importe: el primero es el precio
      // unitario exacto. Con uno solo, ese monto YA es el importe de la partida
      // (ej. "PISO BASE 15 m² $10,200.00"); tratarlo como P.U. y multiplicarlo
      // por la cantidad lo inflaba (15 x $10,200 en vez de $10,200).
      const price = amounts.length >= 2 ? amounts[0] : (qty > 0 ? round2(amounts[0] / qty) : amounts[0]);
      rows.push({ name, qty, price, unit, section });
    });
  });

  return { rows, fullText: allLines.join('\n') };
}

async function readSheetRows(file) {
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
}

// Convierte las filas de una hoja de Excel en filas de concepto. Un documento
// real casi siempre trae 2-4 filas de título arriba (negocio, cliente, fecha)
// antes de la fila real de encabezados, así que se busca la fila que de verdad
// tiene cara de encabezado en vez de asumir que es la primera.
function parseSheetRows(raw) {
  if (!raw.length) return { rows: [], folio: '' };
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  let headerIdx = raw.findIndex(r =>
    r.some(c => /concepto|producto|nombre|descripcion/.test(norm(c))) &&
    r.some(c => /cant|precio|importe|p\.u/.test(norm(c)))
  );
  if (headerIdx === -1) headerIdx = 0;

  const header = raw[headerIdx].map(norm);
  const find = test => header.findIndex(test);
  const col = {
    name: find(k => /concepto|producto|nombre|descripcion/.test(k)),
    qty: find(k => k.includes('cant')),
    price: find(k => k.includes('precio') || k.includes('p.u')),
    importe: find(k => k.includes('importe') || k === 'total'),
    unit: find(k => k.replace(/\./g, '') === 'un' || k.includes('unidad')),
    section: find(k => /seccion|categoria|partida/.test(k) || k.replace(/\./g, '') === 'part'),
    folio: find(k => k.includes('folio')),
  };
  const num = v => parseFloat(String(v).replace(/[^0-9.\-]/g, '')) || 0;

  const rows = [];
  let folio = '';
  let currentSection = '';
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const r = raw[i];
    const filled = r.filter(c => String(c).trim() !== '');
    if (filled.length === 0) continue;

    // Fila de SUMA/TOTAL del propio documento: no es un concepto.
    if (filled.some(c => /^(SUMA|SUB\s*-?\s*TOTAL|GRAN\s*TOTAL|TOTAL)$/i.test(String(c).trim()))) continue;

    // Una sola celda de texto sin números = encabezado de sección.
    if (filled.length === 1 && !filled.some(c => typeof c === 'number' || /\d/.test(String(c)))) {
      currentSection = String(filled[0]).trim();
      continue;
    }

    const name = col.name >= 0 ? String(r[col.name] || '').trim() : '';
    if (!name) continue;
    const qty = col.qty >= 0 ? (parseFloat(r[col.qty]) || 1) : 1;
    let price = col.price >= 0 ? num(r[col.price]) : 0;
    // Sin columna de P.U. pero con Importe: ese monto es el total de la fila,
    // el unitario se calcula en reversa para no inflarlo al multiplicar.
    if (col.price < 0 && col.importe >= 0) {
      const importe = num(r[col.importe]);
      price = qty > 0 ? round2(importe / qty) : importe;
    }
    if (col.folio >= 0 && !folio && r[col.folio]) folio = String(r[col.folio]).trim();
    rows.push({
      name, qty, price,
      unit: col.unit >= 0 ? String(r[col.unit] || '').trim() : '',
      section: col.section >= 0 ? String(r[col.section] || '').trim() : currentSection,
    });
  }
  return { rows, folio };
}
