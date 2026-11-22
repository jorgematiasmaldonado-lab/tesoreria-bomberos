/* =====================================================================
   util.js · Funciones comunes: formatos, seguridad, mensajes, modales,
   consultas, exportación e impresión.
   Desarrollado por Maldonado Jorge Matias · JMM Gestiones & Tecnología
   ===================================================================== */
'use strict';

// ---------------------------------------------------------------------
// Formatos (español de Argentina)
// ---------------------------------------------------------------------
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const _fmtNum = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 88360.2 → "$ 88.360,20" */
function pesos(n) {
  n = Number(n) || 0;
  return (n < 0 ? '-' : '') + '$ ' + _fmtNum.format(Math.abs(n));
}
/** Formato sin espacio, para WhatsApp: "$88.360,20" */
function pesosCorto(n) { return '$' + _fmtNum.format(Number(n) || 0); }
/** Número con coma decimal y sin separador de miles (para Excel) */
function numExcel(n) { return (Number(n) || 0).toFixed(2).replace('.', ','); }

/** "2026-10-12" → "12/10/2026" */
function fecha(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a}` : '';
}
/** "2026-10-12" → "12/10" */
function fechaCorta(iso) { return fecha(iso).slice(0, 5); }
/** Timestamp → "12/10/2026 14:35" */
function fechaHora(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** Fecha local de hoy en formato ISO (yyyy-mm-dd), sin problemas de zona horaria */
function hoy() { return isoLocal(new Date()); }
function isoLocal(d) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function sumarDias(iso, dias) {
  const [a, m, d] = iso.split('-').map(Number);
  return isoLocal(new Date(a, m - 1, d + dias));
}
function mesActual() { return hoy().slice(0, 7); }
/** "2026-11" → { desde: "2026-11-01", hasta: "2026-11-30" } */
function rangoMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return { desde: `${mes}-01`, hasta: isoLocal(new Date(a, m, 0)) };
}
function rangoAnio(anio) { return { desde: `${anio}-01-01`, hasta: `${anio}-12-31` }; }
/** "2026-11" → "Noviembre 2026" */
function nombreMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} ${a}`;
}
function sumarMeses(mes, n) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return isoLocal(d).slice(0, 7);
}
function esFechaValida(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return false;
  const [a, m, d] = iso.split('-').map(Number);
  const f = new Date(a, m - 1, d);
  return f.getFullYear() === a && f.getMonth() === m - 1 && f.getDate() === d && a > 1900 && a < 2200;
}

/** Interpreta montos escritos a mano: "88.360,20", "88360,2", "88360.20", "$ 1.000" */
function parseMonto(txt) {
  if (typeof txt === 'number') return txt;
  let s = String(txt || '').replace(/[$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
/** Para mostrar un monto dentro de un input editable: 88360.2 → "88360,20" */
function montoInput(n) { return n === null || n === undefined || n === '' ? '' : numExcel(n); }

// ---------------------------------------------------------------------
// Seguridad: escapar todo texto ingresado por usuarios antes de insertarlo en HTML
// ---------------------------------------------------------------------
function esc(s) {
  return String(s ?? '').replace(/[&<>"'`]/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;'
  }[c]));
}
/** Escapa y convierte saltos de línea en <br> */
function escMultilinea(s) { return esc(s).replace(/\n/g, '<br>'); }

// ---------------------------------------------------------------------
// Mensajes (toasts) y errores
// ---------------------------------------------------------------------
function toast(mensaje, tipo = 'ok', ms = 3500) {
  const cont = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
  el.textContent = mensaje;
  cont.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, ms);
  setTimeout(() => el.remove(), ms + 350);
}

/** Traduce los errores técnicos a mensajes claros */
function mensajeError(e) {
  const m = String(e?.message || e?.error_description || e || '');
  if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed|network/i.test(m)) {
    return 'Sin conexión. Revisá internet e intentá de nuevo.';
  }
  if (/row-level security|permission denied|not authorized|Unauthorized/i.test(m)) return 'No tenés permiso para realizar esta acción.';
  if (/Invalid login credentials/i.test(m)) return 'Email o contraseña incorrectos.';
  if (/Email not confirmed/i.test(m)) return 'El email no está confirmado. Revisá la configuración de Auth (ver GUIA).';
  if (/User already registered|already been registered/i.test(m)) return 'Ya existe un usuario con ese email.';
  if (/Password should be at least/i.test(m)) return 'La contraseña debe tener al menos 6 caracteres.';
  if (/duplicate key/i.test(m)) return 'Ya existe un registro con esos datos.';
  if (/foreign key/i.test(m)) return 'No se puede borrar porque hay registros que lo usan. Podés desactivarlo.';
  if (/JWT expired/i.test(m)) return 'La sesión expiró. Volvé a ingresar.';
  if (/Payload too large|exceeded the maximum/i.test(m)) return 'El archivo es demasiado grande (máximo 5 MB).';
  if (/mime type|invalid_mime/i.test(m)) return 'Tipo de archivo no permitido (solo JPG, PNG o PDF).';
  return m || 'Ocurrió un error inesperado.';
}
function toastError(e) {
  console.error(e);
  toast(mensajeError(e), 'error', 5500);
}

/** Ejecuta una consulta de Supabase y lanza excepción si hubo error */
async function q(consulta) {
  const { data, error } = await consulta;
  if (error) throw error;
  return data;
}
/** Igual que q(), pero trae todas las filas paginando de a 1000 (límite de Supabase) */
async function qTodo(crearConsulta) {
  const filas = [];
  const paso = 1000;
  for (let desde = 0; ; desde += paso) {
    const lote = await q(crearConsulta().range(desde, desde + paso - 1));
    filas.push(...lote);
    if (lote.length < paso) break;
  }
  return filas;
}

// ---------------------------------------------------------------------
// Pequeños ayudantes de DOM
// ---------------------------------------------------------------------
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

/** Delegación de eventos: on(cont, 'click', '[data-accion]', (ev, el) => ...) */
function on(raiz, evento, selector, fn) {
  raiz.addEventListener(evento, (ev) => {
    const el = ev.target.closest(selector);
    if (el && raiz.contains(el)) fn(ev, el);
  });
}
function cargandoHtml(texto = 'Cargando…') {
  return `<div class="flex flex-col items-center justify-center gap-3 py-12 text-gray-500"><div class="spinner"></div><span>${esc(texto)}</span></div>`;
}
function vacioHtml(texto) {
  return `<div class="text-center text-gray-500 py-10 px-4">${esc(texto)}</div>`;
}
/** Deshabilita el botón mientras corre la tarea y muestra "Guardando…" */
async function conBoton(btn, tarea, texto = 'Guardando…') {
  if (!btn) return tarea();
  if (btn.disabled) return;
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner spinner-chico"></span> ${esc(texto)}`;
  try { return await tarea(); } finally { btn.disabled = false; btn.innerHTML = original; }
}
function opcionesHtml(lista, valorSel, { vacio = null, valor = 'id', texto = 'nombre' } = {}) {
  let h = vacio !== null ? `<option value="">${esc(vacio)}</option>` : '';
  for (const it of lista) {
    const v = typeof it === 'string' ? it : it[valor];
    const t = typeof it === 'string' ? it : (typeof texto === 'function' ? texto(it) : it[texto]);
    h += `<option value="${esc(v)}" ${String(v) === String(valorSel ?? '') ? 'selected' : ''}>${esc(t)}</option>`;
  }
  return h;
}
/** Lee los campos con atributo name de un formulario */
function leerForm(form) {
  const datos = {};
  for (const el of form.querySelectorAll('[name]')) {
    if (el.type === 'checkbox') datos[el.name] = el.checked;
    else if (el.type === 'file') continue;
    else datos[el.name] = el.value.trim();
  }
  return datos;
}
/** Marca un campo con error, muestra el mensaje y devuelve false */
function errorCampo(form, nombre, mensaje) {
  const el = form.querySelector(`[name="${nombre}"]`);
  if (el) {
    el.classList.add('error');
    el.focus();
    el.addEventListener('input', () => el.classList.remove('error'), { once: true });
  }
  toast(mensaje, 'error');
  return false;
}
function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ---------------------------------------------------------------------
// Modales
// ---------------------------------------------------------------------
/**
 * Abre un modal. Devuelve { el, cuerpo, cerrar }.
 * cuerpo: HTML ya escapado. pie: HTML de botones (opcional).
 */
function abrirModal({ titulo, cuerpo = '', pie = '', ancho = 'sm:max-w-lg', alCerrar = null }) {
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `
    <div class="modal-caja ${ancho}" role="dialog" aria-modal="true">
      <div class="flex items-center gap-2 px-4 py-3 border-b">
        <h2 class="font-bold text-lg flex-1 min-w-0 truncate">${esc(titulo)}</h2>
        <button type="button" class="btn btn-icono btn-secundario" data-cerrar aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-cuerpo overflow-y-auto px-4 py-4 flex-1">${cuerpo}</div>
      ${pie ? `<div class="modal-pie flex flex-wrap gap-2 justify-end px-4 py-3 border-t bg-gray-50 rounded-b-[1.1rem]">${pie}</div>` : ''}
    </div>`;
  document.getElementById('modales').appendChild(fondo);
  document.body.style.overflow = 'hidden';
  App.modales++;

  let cerrado = false;
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    fondo.remove();
    App.modales = Math.max(0, App.modales - 1);
    if (!App.modales) document.body.style.overflow = '';
    document.removeEventListener('keydown', teclado);
    if (alCerrar) alCerrar();
    if (!App.modales && App.refrescoPendiente) { App.refrescoPendiente = false; refrescarVista(); }
  };
  const teclado = (ev) => {
    if (ev.key === 'Escape' && fondo === document.getElementById('modales').lastElementChild) cerrar();
  };
  document.addEventListener('keydown', teclado);
  fondo.addEventListener('click', (ev) => {
    if (ev.target === fondo || ev.target.closest('[data-cerrar]')) cerrar();
  });
  return { el: fondo, cuerpo: $('.modal-cuerpo', fondo), cerrar };
}

/** Confirmación antes de borrar o de acciones importantes. Devuelve true/false. */
function confirmar(mensaje, { titulo = 'Confirmar', textoOk = 'Borrar', peligro = true } = {}) {
  return new Promise((resolver) => {
    let respuesta = false;
    const m = abrirModal({
      titulo,
      cuerpo: `<p class="text-gray-700">${escMultilinea(mensaje)}</p>`,
      pie: `<button class="btn btn-secundario" data-cerrar>Cancelar</button>
            <button class="btn ${peligro ? 'btn-primario' : 'btn-verde'}" data-ok>${esc(textoOk)}</button>`,
      alCerrar: () => resolver(respuesta)
    });
    $('[data-ok]', m.el).addEventListener('click', () => { respuesta = true; m.cerrar(); });
    $('[data-ok]', m.el).focus();
  });
}

/** Pide un texto (ej. motivo de rechazo). Devuelve el texto o null si se cancela. */
function pedirTexto(titulo, etiqueta, { textoOk = 'Aceptar', valor = '' } = {}) {
  return new Promise((resolver) => {
    let respuesta = null;
    const m = abrirModal({
      titulo,
      cuerpo: `<label class="etiqueta">${esc(etiqueta)}</label><textarea class="campo" data-txt>${esc(valor)}</textarea>`,
      pie: `<button class="btn btn-secundario" data-cerrar>Cancelar</button><button class="btn btn-primario" data-ok>${esc(textoOk)}</button>`,
      alCerrar: () => resolver(respuesta)
    });
    const txt = $('[data-txt]', m.el);
    txt.focus();
    $('[data-ok]', m.el).addEventListener('click', () => {
      if (!txt.value.trim()) { txt.classList.add('error'); toast('Este dato es obligatorio.', 'error'); return; }
      respuesta = txt.value.trim();
      m.cerrar();
    });
  });
}

// ---------------------------------------------------------------------
// Exportación a Excel (CSV con ; y BOM) y JSON
// ---------------------------------------------------------------------
function descargar(contenido, nombre, tipo) {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function celdaCsv(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** columnas: [{ titulo, valor: (fila) => ... }] */
function exportarCSV(nombre, columnas, filas) {
  const lineas = [columnas.map((c) => celdaCsv(c.titulo)).join(';')];
  for (const f of filas) lineas.push(columnas.map((c) => celdaCsv(c.valor(f))).join(';'));
  descargar('﻿' + lineas.join('\r\n'), nombre.endsWith('.csv') ? nombre : nombre + '.csv', 'text/csv;charset=utf-8');
}
/** Exporta filas "crudas" (todas sus columnas) a CSV */
function exportarCSVCrudo(nombre, filas) {
  if (!filas.length) { exportarCSV(nombre, [{ titulo: 'Sin datos', valor: () => '' }], []); return; }
  const claves = Object.keys(filas[0]);
  exportarCSV(nombre, claves.map((k) => ({
    titulo: k,
    valor: (f) => (typeof f[k] === 'number' ? String(f[k]).replace('.', ',') : f[k])
  })), filas);
}

// ---------------------------------------------------------------------
// Impresión / PDF (window.print con CSS propio para A4)
// ---------------------------------------------------------------------
function encabezadoDoc(titulo, subtitulo = '') {
  const c = App.config || {};
  const datos = [c.direccion, c.localidad].filter(Boolean).join(' · ');
  const contacto = [c.telefono && 'Tel. ' + c.telefono, c.email, c.cuit && 'CUIT ' + c.cuit].filter(Boolean).join(' · ');
  return `
    <div class="doc-encabezado">
      <img src="logo.png" alt="" onerror="this.style.display='none'">
      <div style="flex:1">
        <div style="font-weight:bold;font-size:11pt">${esc(c.nombre || 'Asociación de Bomberos Voluntarios de Villa Río Icho Cruz')}</div>
        <div class="datos">${esc(datos)}</div>
        <div class="datos">${esc(contacto)}</div>
      </div>
      <div style="text-align:right">
        <h1>${esc(titulo)}</h1>
        ${subtitulo ? `<div class="datos">${esc(subtitulo)}</div>` : ''}
      </div>
    </div>`;
}
function firmasDoc(nombres) {
  return `<div class="doc-firmas">${nombres.map((n) => `<div>${esc(n)}</div>`).join('')}</div>`;
}
function pieDoc() {
  return `<div class="pie-doc">Emitido el ${fechaHora(new Date())} · Desarrollado por Maldonado Jorge Matias · JMM Gestiones &amp; Tecnología — Licencia de uso otorgada a BV Villa Río Icho Cruz</div>`;
}
/** Imprime el HTML dado (el usuario puede elegir "Guardar como PDF") */
function imprimir(html, tituloArchivo = 'Documento') {
  const area = document.getElementById('area-impresion');
  area.innerHTML = `<div class="doc">${html}</div>`;
  const tituloOriginal = document.title;
  document.title = tituloArchivo;
  const terminar = () => { document.title = tituloOriginal; area.innerHTML = ''; window.removeEventListener('afterprint', terminar); };
  window.addEventListener('afterprint', terminar);
  // Esperar a que carguen las imágenes (logo) antes de imprimir
  const imgs = $$('img', area).filter((i) => !i.complete);
  Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 1500); })))
    .then(() => setTimeout(() => window.print(), 50));
}

// ---------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------
/** Normaliza un teléfono argentino para wa.me (549 + característica + número) */
function telefonoWa(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('54')) d = d.slice(2);
  if (d.startsWith('9')) d = d.slice(1);
  if (d.startsWith('0')) d = d.slice(1);
  // Quitar el "15" de celulares escritos a la antigua (ej. 3541 15 123456)
  const m = d.match(/^(\d{2,4})15(\d{6,8})$/);
  if (m && (m[1] + m[2]).length === 10) d = m[1] + m[2];
  return '549' + d;
}
function abrirWhatsApp(texto, telefono = '') {
  const url = `https://wa.me/${telefono ? telefonoWa(telefono) : ''}?text=${encodeURIComponent(texto)}`;
  window.open(url, '_blank', 'noopener');
}
async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Texto copiado. Pegalo en WhatsApp.');
}

// ---------------------------------------------------------------------
// Gráfico de barras simple (HTML/CSS)
// ---------------------------------------------------------------------
/** items: [{ etiqueta, valor, color }] */
function barrasHtml(items, { formato = pesos, vacio = 'Sin datos' } = {}) {
  if (!items.length) return vacioHtml(vacio);
  const max = Math.max(...items.map((i) => i.valor), 1);
  return `<div class="space-y-2">${items.map((i) => `
    <div>
      <div class="flex justify-between text-sm gap-2"><span class="truncate">${esc(i.etiqueta)}</span><span class="num font-semibold">${esc(formato(i.valor))}</span></div>
      <div class="barra-fondo"><div class="barra" style="width:${Math.max(2, (i.valor / max) * 100).toFixed(1)}%;background:${i.color || '#D32F2F'}"></div></div>
    </div>`).join('')}</div>`;
}

/** Selector de mes compacto con flechas */
function selectorMesHtml(mes, nombre = 'mes') {
  return `<div class="flex items-center gap-1">
    <button type="button" class="btn btn-secundario btn-icono" data-mes-mover="-1" aria-label="Mes anterior">‹</button>
    <input type="month" name="${nombre}" value="${esc(mes)}" class="campo campo-chico w-auto">
    <button type="button" class="btn btn-secundario btn-icono" data-mes-mover="1" aria-label="Mes siguiente">›</button>
  </div>`;
}
/** Conecta el selector de mes: llama a fn(nuevoMes) al cambiar */
function conectarSelectorMes(raiz, fn, nombre = 'mes') {
  const input = $(`input[name="${nombre}"]`, raiz);
  input.addEventListener('change', () => input.value && fn(input.value));
  $$('[data-mes-mover]', raiz).forEach((b) => b.addEventListener('click', () => {
    fn(sumarMeses(input.value || mesActual(), Number(b.dataset.mesMover)));
  }));
}

const NOMBRE_CUENTA = { caja: 'Caja', banco: 'Banco' };
const MEDIOS_PAGO = ['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'Mercado Pago', 'Otro'];
function cuentaPorMedio(medio) { return String(medio).toLowerCase() === 'efectivo' ? 'caja' : 'banco'; }
