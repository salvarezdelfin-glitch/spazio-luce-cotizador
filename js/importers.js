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
  if (esPdfDeProveedor(pages)) return parsePdfProveedor(pages);
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

// ---------------------------------------------------------------------------
// Cotización de PROVEEDOR (sin signo "$"): tabla  ARTICULO | UNIDADES | P. U. | % DST. | IMPORTE
// (p. ej. las de cortinas y persianas: secciones "CORTINA OPC. 2", "ARTICULOS EXTRAS",
// "PERSIANAS OPC. 2"). Cada renglón trae al final  P.U.  %Dst  Importe; antes o después
// vienen detalles sueltos (Ancho/Alto, Hojas, Color…) que se pegan al concepto.
// Los códigos internos del proveedor (ZZTR, ZZCA, ZZPM) se quitan del nombre.
// ---------------------------------------------------------------------------
const RE_ENCABEZADO_PROVEEDOR = /\bARTICULO\b.*\b(IMPORTE|P\.?\s?U\.?)\b/i;
function esPdfDeProveedor(pages) {
  return pages.some(lines => lines.some(t => RE_ENCABEZADO_PROVEEDOR.test(t)));
}

const num2 = s => parseFloat(String(s).replace(/,/g, ''));

// Saca del principio de la línea los detalles que el PDF imprime a la izquierda del artículo.
function extraerDetallesIzquierda(texto) {
  const detalles = [];
  let t = texto;
  let m;
  for (let guard = 0; guard < 6; guard++) {
    if ((m = t.match(/^Ancho:\s*([\d.]+)\s+Alto:\s*([\d.]+)\s+/i))) { detalles.push('ancho ' + m[1] + ' × alto ' + m[2] + ' m'); }
    else if ((m = t.match(/^Hojas:\s*(\d+)\s+Apertura:\s*(\S+)\s+/i))) { detalles.push(m[1] + ' hojas, apertura ' + m[2].toLowerCase()); }
    else if ((m = t.match(/^Confecci[oó]n:\s*(\S+)\s+/i))) { detalles.push('confección ' + m[1].toLowerCase()); }
    else if ((m = t.match(/^Instalaci[oó]n:\s*(.+?)\s+(?=ZZ[A-Z]{2}\b)/i)) || (m = t.match(/^Instalaci[oó]n:\s*(\S+(?:\s+\S+)?)\s+/i))) { detalles.push('instalación ' + m[1].toLowerCase()); }
    else break;
    t = t.slice(m[0].length);
  }
  return { detalles, resto: t.trim() };
}

function limpiarNombreProveedor(nombre) {
  return nombre.replace(/^ZZ[A-Z]{2}\s+/, '').replace(/\s{2,}/g, ' ').trim();
}

function parsePdfProveedor(pages) {
  const rows = [];
  const allLines = [];
  const notas = [];
  let section = '';
  let ultima = null; // última fila: a ella se pegan los renglones de detalle que siguen

  pages.forEach(lines => {
    ultima = null; // una página nueva (términos y condiciones, etc.) no continúa la tabla
    lines.forEach((linea, idx) => {
      allLines.push(linea);
      const t = linea.trim();

      // Encabezado de tabla: "CORTINA OPC. 2 * ARTICULO UNIDADES P. U. % DST. IMPORTE" → la sección es lo que va antes.
      if (RE_ENCABEZADO_PROVEEDOR.test(t)) {
        const titulo = t.split(/\bARTICULO\b/i)[0].replace(/[*\s]+$/, '').trim();
        if (titulo) section = titulo;
        ultima = null;
        return;
      }
      // Totales del propio documento (la app recalcula): no son renglones.
      if (/^(TOTAL|SUBTOTAL|SUB\s*-?\s*TOTAL|I\.?V\.?A\.?)\b/i.test(t)) { ultima = null; return; }
      // Notas del proveedor ("* 2 CORT. A TECHO…") → se juntan para el campo Nota.
      if (/^\*\s*\S/.test(t)) {
        notas.push(t.replace(/^\*\s*/, ''));
        const sig = (lines[idx + 1] || '').trim();
        if (/^[A-ZÁÉÍÓÚÑ ,.]{4,60}$/.test(sig) && !/^TOTAL/i.test(sig)) notas.push(sig);
        ultima = null;
        return;
      }

      // Renglón con montos: termina en  P.U.  %Dst  Importe.
      const fin = t.match(/^(.*?)\s+([\d,]+\.\d{2})\s+(\d{1,3}(?:\.\d{1,2})?)\s+([\d,]+\.\d{2})$/);
      if (fin) {
        const pu = num2(fin[2]);
        const importe = num2(fin[4]);
        const { detalles, resto } = extraerDetallesIzquierda(fin[1]);
        let nombre, qty, area = null, extra = '';

        // Persianas: "NOMBRE  UDS  ÁREA  TECHO IZQUIERDO SI"
        const pers = resto.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+([A-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ]+)*)$/);
        if (pers) {
          nombre = pers[1]; qty = parseFloat(pers[2]); area = pers[3]; extra = pers[4];
        } else {
          const sp = splitQtyUnit(resto);
          nombre = sp.name; qty = sp.qty;
        }
        nombre = limpiarNombreProveedor(nombre);
        if (!nombre || nombre.length < 3) return;
        if (!(qty > 0)) qty = 1;
        if (area) detalles.push('área ' + area + ' m²');
        if (extra) {
          // "TECHO IZQUIERDO SI" = instalación, lado del mando y si lleva soporte
          const e = extra.toLowerCase().match(/^(\S+)\s+(\S+)\s+(si|sí|no)$/);
          if (e) detalles.push('instalación ' + e[1], 'mando ' + e[2], (e[3] === 'no' ? 'sin' : 'con') + ' soporte');
          else detalles.push(extra.toLowerCase());
        }

        // Si cantidad × P.U. coincide con el importe, ese es el precio; si no (persianas, donde el
        // importe sale de área × precio), se saca el unitario del importe para que el total quede igual.
        const coincide = Math.abs(qty * pu - importe) <= Math.max(0.05, importe * 0.002);
        const price = coincide ? pu : round2(importe / qty);

        ultima = { name: nombre, qty, price, unit: '', section, detalles };
        rows.push(ultima);
        return;
      }

      // Renglón de detalle sin montos: pertenece al renglón de arriba.
      if (ultima && t.length <= 80) {
        let m;
        if ((m = t.match(/^Color:\s*(.+)$/i))) { ultima.detalles.push('color ' + m[1].toLowerCase()); return; }
        if (/^[A-Za-zÁÉÍÓÚÑáéíóúñ]+:\s*\S/.test(t)) { ultima.detalles.push(t.replace(/:\s*/, ' ').toLowerCase()); return; }
        const texto = t.replace(/\.$/, '');
        ultima.name += (/^DE\s/i.test(texto) ? ' ' : ' — ') + texto;
        return;
      }

      // Título de sección suelto ("CORTINAS", "ARTICULOS EXTRAS", "PERSIANAS").
      if (looksLikeSectionHeader(t)) { section = t; ultima = null; }
    });
  });

  // Los detalles se escriben entre paréntesis al final del concepto.
  rows.forEach(r => {
    if (r.detalles.length) r.name += ' (' + r.detalles.join(', ') + ')';
    delete r.detalles;
  });
  return { rows, fullText: allLines.join('\n'), esProveedor: true, nota: notas.join(' ').slice(0, 300) };
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
    r.some(c => /concepto|producto|nombre|descripcion|articulo/.test(norm(c))) &&
    r.some(c => /cant|unidades|uds|precio|importe|p\.?\s?u\b/.test(norm(c)))
  );
  if (headerIdx === -1) headerIdx = 0;

  const header = raw[headerIdx].map(norm);
  const find = test => header.findIndex(test);
  const col = {
    name: find(k => /concepto|producto|nombre|descripcion|articulo/.test(k)),
    qty: find(k => k.includes('cant') || k === 'unidades' || k === 'uds'),
    price: find(k => k.includes('precio') || k.includes('unitario') || /^p\.?\s?u\.?$/.test(k)),
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
    // "TOTAL DE CORTINA OPC. 2", "SUBTOTAL: …", "I.V.A." en la primera celda: totales del proveedor, no conceptos.
    if (/^(TOTAL|SUB\s*-?\s*TOTAL|I\.?V\.?A\.?)\b/i.test(String(filled[0]).trim())) continue;

    // Una sola celda de texto (sin precio ni cantidad) = encabezado de sección, o un detalle del
    // renglón de arriba ("Color: IVORY", "CORTINA CON FALSOS.") que se pega a ese concepto.
    if (filled.length === 1 && typeof filled[0] === 'string' && !/^[\d.,$\s-]+$/.test(filled[0])) {
      const texto = String(filled[0]).trim();
      if (rows.length && /:/.test(texto) && texto.length <= 80) {
        rows[rows.length - 1].name += ' (' + texto.replace(/:\s*/, ' ').toLowerCase() + ')';
      } else if (rows.length && /\.$/.test(texto) && texto.length <= 80) {
        rows[rows.length - 1].name += ' — ' + texto.replace(/\.$/, '');
      } else {
        currentSection = texto;
      }
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
    } else if (col.price >= 0 && col.importe >= 0) {
      const importe = num(r[col.importe]);
      if (importe > 0 && qty > 0 && Math.abs(qty * price - importe) > Math.max(0.05, importe * 0.002)) price = round2(importe / qty);
    }
    if (col.folio >= 0 && !folio && r[col.folio]) folio = String(r[col.folio]).trim();
    rows.push({
      name: name.replace(/^ZZ[A-Z]{2}\s+/, ''), qty, price,
      unit: col.unit >= 0 ? String(r[col.unit] || '').trim() : '',
      section: col.section >= 0 ? String(r[col.section] || '').trim() : currentSection,
    });
  }
  return { rows, folio };
}

// ---------------------------------------------------------------------------
// Formato de Excel de Spazio Luce (assets/Formato-Spazio-Luce.xlsx): arriba los datos del
// cliente (CLIENTE, PROYECTO, TELÉFONO O CORREO, FOLIO, FECHA, NOTA), luego la tabla
// SECCIÓN | CONCEPTO | UN | CANT. | P. UNITARIO | IMPORTE y, en la hoja "Condiciones",
// una condición por renglón. También sirve cualquier Excel con encabezados parecidos.
// ---------------------------------------------------------------------------
function fechaDeCelda(v) {
  if (!v) return '';
  const dos = n => String(n).padStart(2, '0');
  if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + dos(v.getMonth() + 1) + '-' + dos(v.getDate());
  if (typeof v === 'number' && window.XLSX && XLSX.SSF) {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? d.y + '-' + dos(d.m) + '-' + dos(d.d) : '';
  }
  const m = String(v).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + dos(m[2]) + '-' + dos(m[1]);
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim()) ? String(v).trim() : '';
}

// Datos sueltos de arriba de la tabla ("CLIENTE | Fulana"), hasta la fila de encabezados.
function parseExcelMeta(raw) {
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const meta = {};
  for (const r of raw) {
    const celdas = r.map(norm);
    if (celdas.some(c => /concepto|articulo|producto/.test(c)) && celdas.some(c => /cant|unidades|uds/.test(c))) break;
    const idx = r.findIndex(c => String(c).trim() !== '');
    if (idx === -1) continue;
    const etiqueta = norm(r[idx]);
    const valor = r.slice(idx + 1).find(c => String(c).trim() !== '' || c instanceof Date);
    if (valor === undefined) continue;
    if (/^cliente/.test(etiqueta)) meta.cliente = String(valor).trim();
    else if (/^(proyecto|direccion|obra)/.test(etiqueta)) meta.proyecto = String(valor).trim();
    else if (/^(telefono|correo|contacto)/.test(etiqueta)) meta.contacto = String(valor).trim();
    else if (/^folio/.test(etiqueta)) meta.folio = String(valor).trim();
    else if (/^fecha/.test(etiqueta)) meta.fecha = fechaDeCelda(valor);
    else if (/^nota/.test(etiqueta)) meta.nota = String(valor).trim();
  }
  return meta;
}

// Hoja "Condiciones": una condición por celda de texto (se saltan el título y las instrucciones).
function parseCondicionesHoja(wb) {
  const nombre = wb.SheetNames.find(n => /condicion/i.test(n));
  if (!nombre) return null;
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, defval: '', blankrows: false });
  const lineas = [];
  raw.forEach(r => r.forEach(c => {
    const t = typeof c === 'string' ? c.trim() : '';
    if (t.length > 3 && !/^CONDICIONES QUE SALDR/i.test(t) && !/^Ya vienen? (la|las) de siempre/i.test(t)) lineas.push(t);
  }));
  return lineas;
}

// Lee el Excel completo: renglones + datos del cliente + condiciones.
async function leerExcelCompleto(file) {
  const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellDates: true });
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', blankrows: false });
  const { rows, folio } = parseSheetRows(raw);
  return { rows, folio, meta: parseExcelMeta(raw), condiciones: parseCondicionesHoja(wb) };
}
