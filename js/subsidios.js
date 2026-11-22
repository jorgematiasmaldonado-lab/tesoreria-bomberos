/* =====================================================================
   subsidios.js · Subsidios: recibido, gastado, saldo por rendir y rendición
   ===================================================================== */
'use strict';

const ORGANISMOS = ['Nacional', 'Provincial', 'Municipal', 'Otro'];

/** Calcula el estado de un subsidio a partir de lo recibido y lo gastado */
function estadoSubsidio(s, r) {
  const recibido = Number(r?.recibido || 0), gastado = Number(r?.gastado || 0);
  const porRendir = recibido - gastado;
  if (recibido <= 0) return { texto: 'Pendiente de cobro', chip: 'chip-gris', porRendir, recibido, gastado };
  if (porRendir > 0.009 && s.fecha_limite && s.fecha_limite < hoy()) return { texto: 'Vencido', chip: 'chip-rojo', porRendir, recibido, gastado };
  if (porRendir > 0.009) return { texto: 'Por rendir', chip: 'chip-amarillo', porRendir, recibido, gastado };
  return { texto: 'Rendido', chip: 'chip-verde', porRendir, recibido, gastado };
}

Vistas.subsidios = {
  async render(cont) {
    const tes = esTesoreria();
    cont.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h1 class="text-2xl font-bold">Subsidios</h1>
        ${tes ? '<button class="btn btn-primario" data-nuevo>＋ Nuevo subsidio</button>' : ''}
      </div>
      <div data-lista>${cargandoHtml()}</div>`;
    on(cont, 'click', '[data-nuevo]', () => this.formulario(null));

    const [subs, res] = await Promise.all([
      q(App.sb.from('subsidios').select('*').order('fecha_otorgamiento', { ascending: false, nullsFirst: false })),
      q(App.sb.rpc('subsidios_resumen'))
    ]);
    if (App.vista !== 'subsidios') return;
    const resMap = Object.fromEntries(res.map((r) => [r.subsidio_id, r]));

    $('[data-lista]', cont).innerHTML = !subs.length
      ? `<div class="tarjeta">${vacioHtml('No hay subsidios cargados.')}</div>`
      : `<div class="grid gap-3 md:grid-cols-2">${subs.map((s) => {
        const e = estadoSubsidio(s, resMap[s.id]);
        const proximo = s.fecha_limite && e.porRendir > 0.009 && s.fecha_limite <= sumarDias(hoy(), 30);
        return `
        <div class="tarjeta">
          <div class="flex justify-between gap-2 items-start">
            <div class="min-w-0"><div class="font-bold text-lg">${esc(s.nombre)}</div>
              <div class="text-sm text-gray-500">${esc(s.organismo)}${s.fecha_otorgamiento ? ' · Otorgado el ' + fecha(s.fecha_otorgamiento) : ''}</div></div>
            <span class="chip ${e.chip}">${e.texto}</span>
          </div>
          <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-sm mt-3">
            <dt class="text-gray-500">Monto otorgado</dt><dd class="num">${pesos(s.monto_otorgado)}</dd>
            <dt class="text-gray-500">Recibido</dt><dd class="num monto-ingreso">${pesos(e.recibido)}</dd>
            <dt class="text-gray-500">Gastado (imputado)</dt><dd class="num monto-egreso">${pesos(e.gastado)}</dd>
            <dt class="text-gray-500 font-semibold">Saldo por rendir</dt><dd class="num font-bold">${pesos(e.porRendir)}</dd>
            <dt class="text-gray-500">Fecha límite de rendición</dt><dd class="text-right ${proximo ? 'text-red-700 font-bold' : ''}">${s.fecha_limite ? fecha(s.fecha_limite) : '—'}</dd>
          </dl>
          ${Number(resMap[s.id]?.sin_adjunto) ? `<div class="text-xs text-amber-700 mt-2">⚠ ${resMap[s.id].sin_adjunto} gasto(s) imputado(s) sin comprobante adjunto</div>` : ''}
          ${s.observaciones ? `<p class="text-sm text-gray-600 mt-2">${escMultilinea(s.observaciones)}</p>` : ''}
          <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t">
            <button class="btn btn-secundario btn-chico" data-detalle="${s.id}">Ver movimientos</button>
            <button class="btn btn-secundario btn-chico" data-rendicion="${s.id}">🖨 Imprimir rendición</button>
            ${tes ? `<button class="btn btn-secundario btn-chico" data-editar="${s.id}">✏️ Editar</button>
                     <button class="btn btn-peligro btn-chico" data-borrar="${s.id}">🗑</button>` : ''}
          </div>
        </div>`;
      }).join('')}</div>`;

    const buscar = (id) => subs.find((s) => s.id === id);
    on(cont, 'click', '[data-editar]', (ev, b) => this.formulario(buscar(b.dataset.editar)));
    on(cont, 'click', '[data-detalle]', (ev, b) => this.detalle(buscar(b.dataset.detalle)));
    on(cont, 'click', '[data-rendicion]', (ev, b) => this.rendicion(buscar(b.dataset.rendicion), resMap[b.dataset.rendicion]));
    on(cont, 'click', '[data-borrar]', async (ev, b) => {
      const s = buscar(b.dataset.borrar);
      if (!(await confirmar(`¿Borrar el subsidio "${s.nombre}"?\nLos movimientos asociados no se borran: quedan sin subsidio.`))) return;
      try { await q(App.sb.from('subsidios').delete().eq('id', s.id)); toast('Subsidio borrado.'); refrescarVista(); } catch (e) { toastError(e); }
    });
  },

  formulario(sub) {
    const s = sub || { organismo: 'Provincial', fecha_otorgamiento: hoy() };
    const m = abrirModal({
      titulo: sub ? 'Editar subsidio' : 'Nuevo subsidio',
      cuerpo: `<form class="space-y-3" novalidate>
        <div><label class="etiqueta">Nombre *</label><input name="nombre" value="${esc(s.nombre || '')}" class="campo" maxlength="200" placeholder="Ej.: Subsidio Ley 8058 2026"></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="etiqueta">Organismo *</label><select name="organismo" class="campo">${opcionesHtml(ORGANISMOS, s.organismo)}</select></div>
          <div><label class="etiqueta">Monto otorgado *</label><input name="monto_otorgado" inputmode="decimal" value="${esc(montoInput(s.monto_otorgado))}" class="campo" placeholder="0,00"></div>
          <div><label class="etiqueta">Fecha de otorgamiento</label><input type="date" name="fecha_otorgamiento" value="${esc(s.fecha_otorgamiento || '')}" class="campo"></div>
          <div><label class="etiqueta">Fecha límite de rendición</label><input type="date" name="fecha_limite" value="${esc(s.fecha_limite || '')}" class="campo"></div>
        </div>
        <div><label class="etiqueta">Observaciones</label><textarea name="observaciones" class="campo">${esc(s.observaciones || '')}</textarea></div>
        <p class="text-xs text-gray-500">Para registrar lo recibido o lo gastado, cargá el ingreso o egreso en Movimientos y elegí este subsidio en "Subsidio asociado".</p>
      </form>`,
      pie: `<button class="btn btn-secundario" data-cerrar>Cancelar</button><button class="btn btn-primario" data-ok>Guardar</button>`
    });
    const form = $('form', m.el);
    $('[data-ok]', m.el).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      const d = leerForm(form);
      const monto = parseMonto(d.monto_otorgado);
      if (!d.nombre) return errorCampo(form, 'nombre', 'El nombre es obligatorio.');
      if (!(monto > 0)) return errorCampo(form, 'monto_otorgado', 'El monto otorgado debe ser mayor a 0.');
      if (d.fecha_otorgamiento && !esFechaValida(d.fecha_otorgamiento)) return errorCampo(form, 'fecha_otorgamiento', 'Fecha inválida.');
      if (d.fecha_limite && !esFechaValida(d.fecha_limite)) return errorCampo(form, 'fecha_limite', 'Fecha inválida.');
      if (d.fecha_limite && d.fecha_otorgamiento && d.fecha_limite < d.fecha_otorgamiento) return errorCampo(form, 'fecha_limite', 'La fecha límite no puede ser anterior al otorgamiento.');
      const fila = { ...d, monto_otorgado: monto, fecha_otorgamiento: d.fecha_otorgamiento || null, fecha_limite: d.fecha_limite || null };
      try {
        if (sub) await q(App.sb.from('subsidios').update(fila).eq('id', sub.id));
        else await q(App.sb.from('subsidios').insert(fila));
        toast('Subsidio guardado.');
        m.cerrar();
        await cargarCatalogos();
        refrescarVista();
      } catch (e) { toastError(e); }
    }));
  },

  async movimientos(subId) {
    return qTodo(() => App.sb.from('movimientos').select('*, adjuntos(count)').eq('subsidio_id', subId).order('fecha'));
  },

  async detalle(s) {
    const m = abrirModal({ titulo: `Movimientos · ${s.nombre}`, ancho: 'sm:max-w-3xl', cuerpo: cargandoHtml(),
      pie: '<button class="btn btn-primario" data-cerrar>Cerrar</button>' });
    try {
      const movs = await this.movimientos(s.id);
      m.cuerpo.innerHTML = !movs.length ? vacioHtml('No hay movimientos asociados a este subsidio.') : `
        <div class="overflow-x-auto"><table class="tabla">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Comprob.</th><th>📎</th><th class="num">Monto</th></tr></thead>
          <tbody>${movs.map((x) => `<tr><td>${fecha(x.fecha)}</td><td>${x.tipo === 'ingreso' ? 'Recibido' : 'Gasto'}</td>
            <td>${esc(Cat.nombreCategoria(x.categoria_id))} · ${esc(x.descripcion)}</td><td>${esc(x.comprobante)}</td>
            <td>${x.adjuntos?.[0]?.count ? 'Sí' : '<span class="text-red-700">No</span>'}</td>
            <td class="num ${x.tipo === 'ingreso' ? 'monto-ingreso' : 'monto-egreso'}">${pesos(x.monto)}</td></tr>`).join('')}</tbody>
        </table></div>`;
    } catch (e) { m.cuerpo.innerHTML = `<p class="text-red-700">${esc(mensajeError(e))}</p>`; }
  },

  /** Rendición imprimible: datos del subsidio, gastos imputados, totales y firmas */
  async rendicion(s, r) {
    try {
      const movs = await this.movimientos(s.id);
      const gastos = movs.filter((x) => x.tipo === 'egreso');
      const recibidos = movs.filter((x) => x.tipo === 'ingreso');
      const e = estadoSubsidio(s, r);
      const html = `
        ${encabezadoDoc('Rendición de subsidio', `Emitida el ${fecha(hoy())}`)}
        <h2>Datos del subsidio</h2>
        <table>
          <tr><th style="width:35%">Nombre</th><td>${esc(s.nombre)}</td></tr>
          <tr><th>Organismo</th><td>${esc(s.organismo)}</td></tr>
          <tr><th>Fecha de otorgamiento</th><td>${fecha(s.fecha_otorgamiento) || '—'}</td></tr>
          <tr><th>Fecha límite de rendición</th><td>${fecha(s.fecha_limite) || '—'}</td></tr>
          <tr><th>Monto otorgado</th><td>${pesos(s.monto_otorgado)}</td></tr>
          ${s.observaciones ? `<tr><th>Observaciones</th><td>${escMultilinea(s.observaciones)}</td></tr>` : ''}
        </table>
        ${recibidos.length ? `<h2>Fondos recibidos</h2><table><thead><tr><th>Fecha</th><th>Descripción</th><th>Cuenta</th><th class="num">Monto</th></tr></thead>
          <tbody>${recibidos.map((x) => `<tr><td>${fecha(x.fecha)}</td><td>${esc(x.descripcion)}</td><td>${NOMBRE_CUENTA[x.cuenta]}</td><td class="num">${pesos(x.monto)}</td></tr>`).join('')}</tbody></table>` : ''}
        <h2>Gastos imputados</h2>
        <table>
          <thead><tr><th>Fecha</th><th>Comprobante</th><th>Descripción</th><th class="num">Monto</th><th>Adjunto</th></tr></thead>
          <tbody>${gastos.map((x) => `<tr><td>${fecha(x.fecha)}</td><td>${esc(x.comprobante || '—')}</td>
            <td>${esc(Cat.nombreCategoria(x.categoria_id))}${x.descripcion ? ' · ' + esc(x.descripcion) : ''}</td>
            <td class="num">${pesos(x.monto)}</td><td>${x.adjuntos?.[0]?.count ? 'Sí' : 'No'}</td></tr>`).join('')
            || '<tr><td colspan="5">Sin gastos imputados.</td></tr>'}</tbody>
        </table>
        <h2>Totales</h2>
        <table>
          <tr><th style="width:50%">Monto otorgado</th><td class="num">${pesos(s.monto_otorgado)}</td></tr>
          <tr><th>Total recibido</th><td class="num">${pesos(e.recibido)}</td></tr>
          <tr><th>Total rendido (gastos imputados)</th><td class="num">${pesos(e.gastado)}</td></tr>
          <tr class="total"><td>Saldo por rendir</td><td class="num">${pesos(e.porRendir)}</td></tr>
        </table>
        ${firmasDoc(['Tesorero', 'Presidente', 'Revisor de cuentas'])}
        ${pieDoc()}`;
      imprimir(html, `Rendicion - ${s.nombre}`);
    } catch (e) { toastError(e); }
  }
};
