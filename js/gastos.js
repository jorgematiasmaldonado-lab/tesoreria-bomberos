/* =====================================================================
   gastos.js · Gastos cargados por los encargados de semana (aprobación)
   ===================================================================== */
'use strict';

const ESTADOS_GASTO = {
  pendiente: { texto: 'Pendiente', chip: 'chip-amarillo' },
  aprobado: { texto: 'Aprobado', chip: 'chip-verde' },
  rechazado: { texto: 'Rechazado', chip: 'chip-rojo' }
};

Vistas.gastos = {
  async render(cont) {
    const st = (App.estado.gastos ||= { estado: 'pendiente' });
    const tes = esTesoreria();
    cont.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h1 class="text-2xl font-bold">Gastos a aprobar</h1>
      </div>
      <div class="flex gap-2 overflow-x-auto scroll-suave mb-3">
        ${['pendiente', 'aprobado', 'rechazado', ''].map((e) => `
          <button class="subpestana ${st.estado === e ? 'activa' : ''}" data-estado="${e}">${e ? ESTADOS_GASTO[e].texto + 's' : 'Todos'}</button>`).join('')}
      </div>
      <div data-lista>${cargandoHtml()}</div>`;
    on(cont, 'click', '[data-estado]', (ev, b) => { st.estado = b.dataset.estado; renderVista(); });

    const gastos = await qTodo(() => {
      let c = App.sb.from('gastos_encargado').select('*, adjuntos(*), informes_semanales(desde, hasta)');
      if (st.estado) c = c.eq('estado', st.estado);
      return c.order('fecha', { ascending: false }).order('creado_en', { ascending: false });
    });
    if (App.vista !== 'gastos') return;
    const adjuntos = gastos.flatMap((g) => g.adjuntos || []);
    const urls = await Adjuntos.urlsFirmadas(adjuntos).catch(() => ({}));
    const total = gastos.reduce((s, g) => s + Number(g.monto), 0);

    $('[data-lista]', cont).innerHTML = !gastos.length
      ? `<div class="tarjeta">${vacioHtml(st.estado === 'pendiente' ? '✅ No hay gastos pendientes de aprobar.' : 'No hay gastos para mostrar.')}</div>`
      : `<p class="text-sm text-gray-600 mb-2">${gastos.length} gasto(s) · Total ${pesos(total)}</p>
        <div class="grid gap-3 md:grid-cols-2">${gastos.map((g) => `
        <div class="tarjeta">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-bold text-lg">${esc(g.concepto)}</div>
              <div class="text-sm text-gray-500">${fecha(g.fecha)} · Cargado por ${esc(g.autor_nombre || '—')}</div>
              ${g.informes_semanales ? `<div class="text-xs text-gray-500">Semana del ${fechaCorta(g.informes_semanales.desde)} al ${fechaCorta(g.informes_semanales.hasta)}</div>` : ''}
            </div>
            <div class="text-right">
              <div class="monto-egreso text-lg num">${pesos(g.monto)}</div>
              <span class="chip ${ESTADOS_GASTO[g.estado].chip}">${ESTADOS_GASTO[g.estado].texto}</span>
            </div>
          </div>
          ${g.estado === 'rechazado' && g.motivo_rechazo ? `<div class="mt-2 text-sm p-2 rounded bg-red-50 text-red-800">Motivo: ${esc(g.motivo_rechazo)}</div>` : ''}
          ${g.estado === 'aprobado' && g.movimiento_id ? `<div class="mt-2 text-xs text-green-800">Registrado como egreso${g.revisado_en ? ' el ' + fechaHora(g.revisado_en) : ''}.</div>` : ''}
          <div class="flex flex-wrap gap-2 mt-3">
            ${(g.adjuntos || []).map((a) => `
              <button data-ver="${a.id}" class="block">${a.tipo_mime === 'application/pdf'
                ? '<div class="miniatura flex items-center justify-center text-3xl">📄</div>'
                : `<img src="${esc(urls[a.ruta] || '')}" alt="Ticket" class="miniatura" loading="lazy">`}</button>`).join('')
              || '<span class="text-sm text-gray-500">Sin foto del ticket</span>'}
          </div>
          ${tes ? `<div class="flex flex-wrap gap-2 mt-3 pt-3 border-t">
            ${g.estado !== 'aprobado' ? `<button class="btn btn-verde flex-1" data-aprobar="${g.id}">✔ Aprobar</button>` : ''}
            ${g.estado !== 'rechazado' ? `<button class="btn btn-peligro flex-1" data-rechazar="${g.id}">✕ Rechazar</button>` : ''}
            ${g.estado !== 'pendiente' ? `<button class="btn btn-secundario flex-1" data-revertir="${g.id}">↺ Volver a pendiente</button>` : ''}
          </div>` : ''}
        </div>`).join('')}</div>`;

    const buscar = (id) => gastos.find((g) => g.id === id);
    on(cont, 'click', '[data-ver]', (ev, b) => {
      const a = adjuntos.find((x) => x.id === b.dataset.ver);
      if (a && urls[a.ruta]) Adjuntos.ver(a, urls[a.ruta]);
    });
    on(cont, 'click', '[data-aprobar]', (ev, b) => this.aprobar(buscar(b.dataset.aprobar)));
    on(cont, 'click', '[data-rechazar]', async (ev, b) => {
      const g = buscar(b.dataset.rechazar);
      const motivo = await pedirTexto('Rechazar gasto', `Motivo del rechazo de "${g.concepto}" (${pesos(g.monto)})`, { textoOk: 'Rechazar' });
      if (!motivo) return;
      try {
        await q(App.sb.rpc('rechazar_gasto', { p_gasto: g.id, p_motivo: motivo }));
        toast('Gasto rechazado.');
        refrescarVista();
      } catch (e) { toastError(e); }
    });
    on(cont, 'click', '[data-revertir]', async (ev, b) => {
      const g = buscar(b.dataset.revertir);
      const msj = g.estado === 'aprobado'
        ? `¿Volver "${g.concepto}" a pendiente? Se borrará el egreso que se había registrado.`
        : `¿Volver "${g.concepto}" a pendiente?`;
      if (!(await confirmar(msj, { textoOk: 'Volver a pendiente' }))) return;
      try {
        await q(App.sb.rpc('revertir_gasto', { p_gasto: g.id }));
        toast('El gasto volvió a pendiente.');
        refrescarVista();
      } catch (e) { toastError(e); }
    });
  },

  /** Aprobar: elegir categoría y cuenta → se crea el egreso con sus adjuntos */
  aprobar(g) {
    const sugerida = Cat.categorias('egreso').find((c) => /super/i.test(c.nombre) && /super/i.test(g.concepto))
      || Cat.categorias('egreso').find((c) => /combust/i.test(c.nombre) && /(nafta|gasoil|combust|diesel|v-?power)/i.test(g.concepto));
    const m = abrirModal({
      titulo: 'Aprobar gasto',
      cuerpo: `<form class="space-y-3" novalidate>
        <div class="p-3 rounded-lg bg-gray-50"><div class="font-semibold">${esc(g.concepto)}</div>
          <div class="text-sm text-gray-600">${fecha(g.fecha)} · ${esc(g.autor_nombre || '')}</div>
          <div class="monto-egreso text-lg">${pesos(g.monto)}</div></div>
        <div><label class="etiqueta">Categoría de egreso *</label>
          <select name="categoria" class="campo">${opcionesHtml(Cat.categorias('egreso'), sugerida?.id, { vacio: 'Elegí una categoría' })}</select></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="etiqueta">Cuenta *</label><select name="cuenta" class="campo">${opcionesHtml([{ id: 'caja', nombre: 'Caja' }, { id: 'banco', nombre: 'Banco' }], 'caja')}</select></div>
          <div><label class="etiqueta">Fecha del egreso *</label><input type="date" name="fecha" value="${esc(g.fecha)}" class="campo"></div>
        </div>
      </form>`,
      pie: `<button class="btn btn-secundario" data-cerrar>Cancelar</button><button class="btn btn-verde" data-ok>✔ Aprobar</button>`
    });
    const form = $('form', m.el);
    $('[data-ok]', m.el).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      const d = leerForm(form);
      if (!d.categoria) return errorCampo(form, 'categoria', 'Elegí una categoría.');
      if (!esFechaValida(d.fecha)) return errorCampo(form, 'fecha', 'Ingresá una fecha válida.');
      try {
        await q(App.sb.rpc('aprobar_gasto', { p_gasto: g.id, p_categoria: d.categoria, p_cuenta: d.cuenta, p_fecha: d.fecha }));
        toast('Gasto aprobado y registrado como egreso.');
        m.cerrar();
        refrescarVista();
      } catch (e) { toastError(e); }
    }));
  }
};
