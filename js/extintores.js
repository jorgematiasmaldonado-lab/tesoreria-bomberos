/* =====================================================================
   extintores.js · Órdenes de carga de extintores: recepción, cobro,
   retiro y comprobantes imprimibles (original y duplicado)
   ===================================================================== */
'use strict';

const ESTADOS_EXT = {
  recibido: { texto: 'Recibido', chip: 'chip-azul' },
  listo: { texto: 'Listo para retirar', chip: 'chip-amarillo' },
  entregado: { texto: 'Entregado', chip: 'chip-verde' }
};
const nroOrden = (n) => String(n).padStart(5, '0');

Vistas.extintores = {
  puedeEditar: () => ['tesoreria', 'extintores'].includes(App.rol),

  async render(cont) {
    const st = (App.estado.extintores ||= { texto: '', estado: '', impagas: false });
    const edita = this.puedeEditar();
    cont.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h1 class="text-2xl font-bold">Extintores</h1>
        ${edita ? '<button class="btn btn-primario text-lg" data-nueva>＋ Nueva orden</button>' : ''}
      </div>
      <div class="tarjeta mb-3 grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
        <div class="col-span-2"><label class="etiqueta">Buscar</label>
          <input type="search" data-buscar value="${esc(st.texto)}" placeholder="Cliente, DNI, N° de orden o N° de extintor" class="campo campo-chico"></div>
        <div><label class="etiqueta">Estado</label>
          <select data-estado class="campo campo-chico">${opcionesHtml(Object.entries(ESTADOS_EXT).map(([id, e]) => ({ id, nombre: e.texto })), st.estado, { vacio: 'Todos' })}</select></div>
        <label class="flex items-center gap-2 py-2"><input type="checkbox" data-impagas ${st.impagas ? 'checked' : ''} class="w-5 h-5"> Pendientes de pago</label>
      </div>
      <div data-lista>${cargandoHtml()}</div>`;
    on(cont, 'click', '[data-nueva]', () => this.formulario(null));
    $('[data-estado]', cont).addEventListener('change', (ev) => { st.estado = ev.target.value; pintar(); });
    $('[data-impagas]', cont).addEventListener('change', (ev) => { st.impagas = ev.target.checked; pintar(); });
    $('[data-buscar]', cont).addEventListener('input', debounce((ev) => { st.texto = ev.target.value; pintar(); }, 250));

    const ordenes = await qTodo(() => App.sb.from('ext_ordenes').select('*, ext_items(*)').order('numero', { ascending: false }));
    if (App.vista !== 'extintores') return;
    ordenes.forEach((o) => o.ext_items.sort((a, b) => a.orden - b.orden));

    const pintar = () => {
      const t = st.texto.trim().toLowerCase().replace(/^0+(?=\d)/, '');
      const lista = ordenes.filter((o) => {
        if (st.estado && o.estado !== st.estado) return false;
        if (st.impagas && o.pagado) return false;
        if (!t) return true;
        return String(o.numero) === t || nroOrden(o.numero).includes(t)
          || [o.cliente_nombre, o.cliente_doc, o.cliente_tel].some((x) => String(x || '').toLowerCase().includes(t))
          || o.ext_items.some((i) => String(i.numero_serie || '').toLowerCase().includes(t));
      });
      const impagas = lista.filter((o) => !o.pagado).reduce((s, o) => s + Number(o.total), 0);
      $('[data-lista]', cont).innerHTML = !lista.length
        ? `<div class="tarjeta">${vacioHtml('No hay órdenes para mostrar.')}</div>`
        : `<p class="text-sm text-gray-600 mb-2">${lista.length} orden(es)${impagas ? ` · Pendiente de cobro: <b>${pesos(impagas)}</b>` : ''}</p>
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">${lista.map((o) => `
          <div class="tarjeta flex flex-col">
            <div class="flex justify-between items-start gap-2">
              <div class="min-w-0">
                <div class="text-xs text-gray-500">Orden N°</div>
                <div class="text-2xl font-bold" style="color:#D32F2F">${nroOrden(o.numero)}</div>
              </div>
              <div class="text-right space-y-1">
                <span class="chip ${ESTADOS_EXT[o.estado].chip}">${ESTADOS_EXT[o.estado].texto}</span><br>
                ${o.pagado ? `<span class="chip chip-verde">✔ Pagado</span>` : `<span class="chip chip-rojo">Impago</span>`}
              </div>
            </div>
            <div class="font-semibold mt-1">${esc(o.cliente_nombre)}</div>
            <div class="text-sm text-gray-500">${[o.cliente_doc && 'DNI/CUIT ' + o.cliente_doc, o.cliente_tel && 'Tel. ' + o.cliente_tel].filter(Boolean).map(esc).join(' · ')}</div>
            <div class="text-sm text-gray-500">Recibido ${fecha(o.fecha_recepcion)}${o.fecha_entrega_estimada ? ' · Entrega est. ' + fecha(o.fecha_entrega_estimada) : ''}</div>
            <ul class="text-sm mt-2 space-y-0.5 flex-1">${o.ext_items.map((i) => `
              <li class="flex justify-between gap-2"><span class="truncate">🧯 ${esc(i.numero_serie || 's/n')} · ${esc(i.tipo)} ${esc(i.capacidad)}</span><span class="num">${pesos(i.precio)}</span></li>`).join('')}</ul>
            <div class="flex justify-between items-center border-t mt-2 pt-2">
              <span class="text-sm text-gray-500">${o.pagado ? `Cobrado ${fecha(o.fecha_pago)} · ${esc(o.medio_pago)}` : ''}</span>
              <span class="text-lg font-bold num">${pesos(o.total)}</span>
            </div>
            ${o.estado === 'entregado' ? `<div class="text-xs text-gray-500">Retiró ${esc(o.retiro_nombre || '')} (DNI ${esc(o.retiro_dni || '')}) el ${fecha(o.retiro_fecha)}</div>` : ''}
            <div class="flex flex-wrap gap-2 mt-3">
              ${edita && !o.pagado ? `<button class="btn btn-verde btn-chico flex-1" data-cobrar="${o.id}">💲 Cobrar</button>` : ''}
              ${edita && o.estado === 'recibido' ? `<button class="btn btn-secundario btn-chico flex-1" data-listo="${o.id}">✔ Listo</button>` : ''}
              ${edita && o.estado !== 'entregado' ? `<button class="btn btn-primario btn-chico flex-1" data-retiro="${o.id}">📦 Retiro</button>` : ''}
              <button class="btn btn-secundario btn-chico" data-imp-recepcion="${o.id}" title="Comprobante de recepción">🖨 Recepción</button>
              ${o.estado === 'entregado' ? `<button class="btn btn-secundario btn-chico" data-imp-retiro="${o.id}">🖨 Retiro</button>` : ''}
              ${edita && !o.pagado ? `<button class="btn btn-secundario btn-icono" data-editar="${o.id}" title="Editar">✏️</button>` : ''}
              ${edita && o.estado !== 'recibido' && o.estado !== 'entregado' ? `<button class="btn btn-secundario btn-icono" data-volver="${o.id}" title="Volver a Recibido">↺</button>` : ''}
              ${esTesoreria() && o.pagado ? `<button class="btn btn-peligro btn-chico" data-anular="${o.id}">Anular cobro</button>` : ''}
              ${(edita && !o.pagado) || esTesoreria() ? `<button class="btn btn-peligro btn-icono" data-borrar="${o.id}" title="Borrar">🗑</button>` : ''}
            </div>
          </div>`).join('')}</div>`;
    };
    pintar();

    const buscar = (id) => ordenes.find((o) => o.id === id);
    on(cont, 'click', '[data-editar]', (ev, b) => this.formulario(buscar(b.dataset.editar)));
    on(cont, 'click', '[data-cobrar]', (ev, b) => this.cobrar(buscar(b.dataset.cobrar)));
    on(cont, 'click', '[data-retiro]', (ev, b) => this.retiro(buscar(b.dataset.retiro)));
    on(cont, 'click', '[data-imp-recepcion]', (ev, b) => this.imprimir(buscar(b.dataset.impRecepcion), 'recepcion'));
    on(cont, 'click', '[data-imp-retiro]', (ev, b) => this.imprimir(buscar(b.dataset.impRetiro), 'retiro'));
    on(cont, 'click', '[data-listo]', async (ev, b) => {
      try { await q(App.sb.from('ext_ordenes').update({ estado: 'listo' }).eq('id', b.dataset.listo)); toast('Orden lista para retirar.'); refrescarVista(); } catch (e) { toastError(e); }
    });
    on(cont, 'click', '[data-volver]', async (ev, b) => {
      try { await q(App.sb.from('ext_ordenes').update({ estado: 'recibido' }).eq('id', b.dataset.volver)); refrescarVista(); } catch (e) { toastError(e); }
    });
    on(cont, 'click', '[data-anular]', async (ev, b) => {
      const o = buscar(b.dataset.anular);
      if (!(await confirmar(`¿Anular el cobro de la orden N° ${nroOrden(o.numero)}?\nSe borrará el ingreso de ${pesos(o.total)} en la contaduría.`, { textoOk: 'Anular cobro' }))) return;
      try { await q(App.sb.rpc('ext_anular_cobro', { p_orden: o.id })); toast('Cobro anulado.'); refrescarVista(); } catch (e) { toastError(e); }
    });
    on(cont, 'click', '[data-borrar]', async (ev, b) => {
      const o = buscar(b.dataset.borrar);
      const extra = o.pagado ? '\nLa orden está cobrada: también se borrará su ingreso en la contaduría.' : '';
      if (!(await confirmar(`¿Borrar la orden N° ${nroOrden(o.numero)} de ${o.cliente_nombre}?${extra}`))) return;
      try { await q(App.sb.from('ext_ordenes').delete().eq('id', o.id)); toast('Orden borrada.'); refrescarVista(); } catch (e) { toastError(e); }
    });
  },

  /** Alta / edición de orden (solo si no está cobrada) */
  formulario(orden) {
    const o = orden || { fecha_recepcion: hoy(), fecha_entrega_estimada: sumarDias(hoy(), 7), ext_items: [] };
    const tipos = (App.cat.tiposExtintor || []).filter((t) => t.activo).map((t) => t.nombre);
    const filaHtml = (it = {}) => `
      <div class="border rounded-lg p-2 grid grid-cols-2 sm:grid-cols-12 gap-2 items-end" data-item data-id="${esc(it.id || '')}">
        <div class="col-span-2 sm:col-span-3"><label class="etiqueta">N° extintor / serie</label><input name="numero_serie" value="${esc(it.numero_serie || '')}" class="campo campo-chico"></div>
        <div class="sm:col-span-3"><label class="etiqueta">Tipo</label><select name="tipo" class="campo campo-chico">${opcionesHtml(
          it.tipo && !tipos.includes(it.tipo) ? [it.tipo, ...tipos] : tipos, it.tipo || tipos[0])}</select></div>
        <div class="sm:col-span-2"><label class="etiqueta">Capacidad</label><input name="capacidad" value="${esc(it.capacidad || '')}" placeholder="5 kg" class="campo campo-chico"></div>
        <div class="sm:col-span-3"><label class="etiqueta">Precio *</label><input name="precio" inputmode="decimal" value="${esc(montoInput(it.precio))}" placeholder="0,00" class="campo campo-chico"></div>
        <div class="col-span-2 sm:col-span-1 text-right"><button type="button" class="btn btn-peligro btn-icono" data-quitar title="Quitar">✕</button></div>
      </div>`;
    const m = abrirModal({
      titulo: orden ? `Editar orden N° ${nroOrden(orden.numero)}` : 'Nueva orden de carga',
      ancho: 'sm:max-w-3xl',
      cuerpo: `<form class="space-y-4" novalidate>
        <fieldset class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <legend class="font-bold mb-1">Cliente</legend>
          <div class="sm:col-span-3"><label class="etiqueta">Nombre y apellido / Razón social *</label><input name="cliente_nombre" value="${esc(o.cliente_nombre || '')}" class="campo" maxlength="200"></div>
          <div><label class="etiqueta">DNI / CUIT</label><input name="cliente_doc" value="${esc(o.cliente_doc || '')}" class="campo" inputmode="numeric"></div>
          <div class="sm:col-span-2"><label class="etiqueta">Teléfono</label><input name="cliente_tel" value="${esc(o.cliente_tel || '')}" class="campo" inputmode="tel"></div>
        </fieldset>
        <fieldset>
          <legend class="font-bold mb-1">Extintores</legend>
          <div class="space-y-2" data-items>${(o.ext_items.length ? o.ext_items : [{}]).map(filaHtml).join('')}</div>
          <button type="button" class="btn btn-secundario mt-2" data-agregar>＋ Agregar extintor</button>
          <div class="text-right text-xl font-bold mt-2">Total: <span data-total>${pesos(0)}</span></div>
        </fieldset>
        <fieldset class="grid grid-cols-2 gap-3">
          <div><label class="etiqueta">Fecha de recepción *</label><input type="date" name="fecha_recepcion" value="${esc(o.fecha_recepcion)}" class="campo"></div>
          <div><label class="etiqueta">Entrega estimada</label><input type="date" name="fecha_entrega_estimada" value="${esc(o.fecha_entrega_estimada || '')}" class="campo"></div>
          <div class="col-span-2"><label class="etiqueta">Observaciones</label><textarea name="observaciones" class="campo">${esc(o.observaciones || '')}</textarea></div>
        </fieldset>
      </form>`,
      pie: `<button class="btn btn-secundario" data-cerrar>Cancelar</button><button class="btn btn-primario" data-ok>Guardar${orden ? '' : ' e imprimir'}</button>`
    });
    const form = $('form', m.el);
    const items = $('[data-items]', form);
    const total = () => {
      const t = $$('[data-item]', items).reduce((s, f) => s + (parseMonto($('[name="precio"]', f).value) || 0), 0);
      $('[data-total]', form).textContent = pesos(t);
    };
    total();
    items.addEventListener('input', total);
    $('[data-agregar]', form).addEventListener('click', () => {
      items.insertAdjacentHTML('beforeend', filaHtml());
      $('[data-item]:last-child [name="numero_serie"]', items).focus();
    });
    on(items, 'click', '[data-quitar]', (ev, b) => {
      if ($$('[data-item]', items).length === 1) { toast('La orden debe tener al menos un extintor.', 'error'); return; }
      b.closest('[data-item]').remove(); total();
    });

    $('[data-ok]', m.el).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      const d = leerForm(form);
      if (!d.cliente_nombre) return errorCampo(form, 'cliente_nombre', 'El nombre del cliente es obligatorio.');
      if (!esFechaValida(d.fecha_recepcion)) return errorCampo(form, 'fecha_recepcion', 'Ingresá la fecha de recepción.');
      if (d.fecha_entrega_estimada && !esFechaValida(d.fecha_entrega_estimada)) return errorCampo(form, 'fecha_entrega_estimada', 'Fecha inválida.');
      const filas = [];
      for (const [i, f] of $$('[data-item]', items).entries()) {
        const precio = parseMonto($('[name="precio"]', f).value);
        if (!(precio > 0)) {
          const inp = $('[name="precio"]', f); inp.classList.add('error'); inp.focus();
          return toast(`El precio del extintor ${i + 1} debe ser mayor a 0.`, 'error');
        }
        filas.push({ id: f.dataset.id || null, numero_serie: $('[name="numero_serie"]', f).value.trim(),
          tipo: $('[name="tipo"]', f).value, capacidad: $('[name="capacidad"]', f).value.trim(), precio, orden: i + 1 });
      }
      const cab = {
        cliente_nombre: d.cliente_nombre, cliente_doc: d.cliente_doc, cliente_tel: d.cliente_tel,
        fecha_recepcion: d.fecha_recepcion, fecha_entrega_estimada: d.fecha_entrega_estimada || null, observaciones: d.observaciones
      };
      try {
        let id = orden?.id;
        if (orden) {
          await q(App.sb.from('ext_ordenes').update(cab).eq('id', id));
          const quedan = filas.filter((f) => f.id).map((f) => f.id);
          const borrar = orden.ext_items.filter((i) => !quedan.includes(i.id)).map((i) => i.id);
          if (borrar.length) await q(App.sb.from('ext_items').delete().in('id', borrar));
          for (const f of filas.filter((x) => x.id)) {
            const { id: idItem, ...resto } = f;
            await q(App.sb.from('ext_items').update(resto).eq('id', idItem));
          }
        } else {
          id = (await q(App.sb.from('ext_ordenes').insert(cab).select('id').single())).id;
        }
        const nuevos = filas.filter((f) => !f.id).map(({ id: _x, ...resto }) => ({ ...resto, orden_id: id }));
        if (nuevos.length) await q(App.sb.from('ext_items').insert(nuevos));
        const guardada = await q(App.sb.from('ext_ordenes').select('*, ext_items(*)').eq('id', id).single());
        guardada.ext_items.sort((a, b) => a.orden - b.orden);
        toast(orden ? 'Orden actualizada.' : `Orden N° ${nroOrden(guardada.numero)} creada.`);
        m.cerrar();
        refrescarVista();
        if (!orden) this.imprimir(guardada, 'recepcion');
      } catch (e) { toastError(e); }
    }));
  },

  /** HTML de selección de medio de pago */
  medioHtml() {
    return `<div class="grid grid-cols-2 gap-3">
      <div><label class="etiqueta">Medio de pago *</label><select name="medio" class="campo">${opcionesHtml(MEDIOS_PAGO, 'Efectivo')}</select></div>
      <div><label class="etiqueta">Fecha de cobro *</label><input type="date" name="fecha_pago" value="${hoy()}" class="campo"></div>
    </div>
    <p class="text-sm text-gray-600" data-destino>Se registrará un ingreso en <b>Caja</b> (categoría Extintores).</p>`;
  },
  conectarMedio(raiz) {
    const sel = $('[name="medio"]', raiz);
    const destino = () => { $('[data-destino]', raiz).innerHTML = `Se registrará un ingreso en <b>${NOMBRE_CUENTA[cuentaPorMedio(sel.value)]}</b> (categoría Extintores).`; };
    sel.addEventListener('change', destino);
  },

  cobrar(o) {
    const m = abrirModal({
      titulo: `Cobrar orden N° ${nroOrden(o.numero)}`,
      cuerpo: `<form class="space-y-3" novalidate>
        <div class="p-3 rounded-lg bg-gray-50 flex justify-between"><span>${esc(o.cliente_nombre)}</span><b class="text-xl">${pesos(o.total)}</b></div>
        ${this.medioHtml()}</form>`,
      pie: `<button class="btn btn-secundario" data-cerrar>Cancelar</button><button class="btn btn-verde" data-ok>💲 Cobrar ${pesos(o.total)}</button>`
    });
    const form = $('form', m.el);
    this.conectarMedio(form);
    $('[data-ok]', m.el).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      const d = leerForm(form);
      if (!esFechaValida(d.fecha_pago)) return errorCampo(form, 'fecha_pago', 'Ingresá una fecha válida.');
      try {
        await q(App.sb.rpc('ext_cobrar', { p_orden: o.id, p_medio: d.medio, p_fecha: d.fecha_pago }));
        toast(`Orden N° ${nroOrden(o.numero)} cobrada.`);
        m.cerrar();
        refrescarVista();
      } catch (e) { toastError(e); }
    }, 'Cobrando…'));
  },

  /** Retiro: fecha y quién retira; si no está paga se cobra en el momento */
  retiro(o) {
    const m = abrirModal({
      titulo: `Retiro · Orden N° ${nroOrden(o.numero)}`,
      cuerpo: `<form class="space-y-3" novalidate>
        <div class="p-3 rounded-lg bg-gray-50"><div class="font-semibold">${esc(o.cliente_nombre)}</div>
          <div class="text-sm">${o.ext_items.map((i) => esc(i.numero_serie || 's/n')).join(', ')}</div>
          <div class="text-xl font-bold">${pesos(o.total)}</div></div>
        <div class="grid grid-cols-2 gap-3">
          <div class="col-span-2"><label class="etiqueta">Fecha de retiro *</label><input type="date" name="retiro_fecha" value="${hoy()}" class="campo"></div>
          <div><label class="etiqueta">Retira (nombre) *</label><input name="retiro_nombre" value="${esc(o.cliente_nombre)}" class="campo"></div>
          <div><label class="etiqueta">DNI de quien retira *</label><input name="retiro_dni" value="${esc(/^\d{7,8}$/.test(o.cliente_doc || '') ? o.cliente_doc : '')}" class="campo" inputmode="numeric"></div>
        </div>
        ${o.pagado ? '<p class="chip chip-verde">✔ La orden ya está paga</p>'
          : `<div class="border-t pt-3 space-y-3"><div class="font-semibold text-red-700">La orden no está paga: se cobra ahora.</div>${this.medioHtml()}</div>`}
      </form>`,
      pie: `<button class="btn btn-secundario" data-cerrar>Cancelar</button><button class="btn btn-primario" data-ok>📦 Registrar retiro e imprimir</button>`
    });
    const form = $('form', m.el);
    if (!o.pagado) this.conectarMedio(form);
    $('[data-ok]', m.el).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      const d = leerForm(form);
      if (!esFechaValida(d.retiro_fecha)) return errorCampo(form, 'retiro_fecha', 'Ingresá la fecha de retiro.');
      if (!d.retiro_nombre) return errorCampo(form, 'retiro_nombre', 'Indicá quién retira.');
      if (!d.retiro_dni) return errorCampo(form, 'retiro_dni', 'Indicá el DNI de quien retira.');
      if (!o.pagado && !esFechaValida(d.fecha_pago)) return errorCampo(form, 'fecha_pago', 'Ingresá la fecha de cobro.');
      try {
        if (!o.pagado) await q(App.sb.rpc('ext_cobrar', { p_orden: o.id, p_medio: d.medio, p_fecha: d.fecha_pago }));
        await q(App.sb.from('ext_ordenes').update({
          estado: 'entregado', retiro_fecha: d.retiro_fecha, retiro_nombre: d.retiro_nombre, retiro_dni: d.retiro_dni
        }).eq('id', o.id));
        const final = await q(App.sb.from('ext_ordenes').select('*, ext_items(*)').eq('id', o.id).single());
        final.ext_items.sort((a, b) => a.orden - b.orden);
        toast('Retiro registrado.');
        m.cerrar();
        refrescarVista();
        this.imprimir(final, 'retiro');
      } catch (e) { toastError(e); }
    }));
  },

  /** Comprobante imprimible: dos copias por hoja (ORIGINAL – Cliente / DUPLICADO – Cuartel) */
  imprimir(o, tipo) {
    const titulo = tipo === 'retiro' ? 'Comprobante de retiro' : 'Comprobante de recepción';
    const copia = (etiqueta) => `
      <div class="doc-copia">
        <div class="doc-etiqueta-copia">${etiqueta}</div>
        ${encabezadoDoc(titulo, `Orden N° ${nroOrden(o.numero)}`)}
        <table>
          <tr><th style="width:22%">Cliente</th><td>${esc(o.cliente_nombre)}</td><th style="width:16%">DNI/CUIT</th><td>${esc(o.cliente_doc || '—')}</td></tr>
          <tr><th>Teléfono</th><td>${esc(o.cliente_tel || '—')}</td><th>Recepción</th><td>${fecha(o.fecha_recepcion)}</td></tr>
          ${tipo === 'retiro'
            ? `<tr><th>Retiró</th><td>${esc(o.retiro_nombre || '')} · DNI ${esc(o.retiro_dni || '')}</td><th>Fecha retiro</th><td>${fecha(o.retiro_fecha)}</td></tr>`
            : `<tr><th>Entrega estimada</th><td colspan="3">${fecha(o.fecha_entrega_estimada) || '—'}</td></tr>`}
        </table>
        <table>
          <thead><tr><th>#</th><th>N° extintor / serie</th><th>Tipo</th><th>Capacidad</th><th class="num">Precio</th></tr></thead>
          <tbody>${o.ext_items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.numero_serie || 's/n')}</td><td>${esc(i.tipo)}</td><td>${esc(i.capacidad)}</td><td class="num">${pesos(i.precio)}</td></tr>`).join('')}</tbody>
          <tfoot><tr class="total"><td colspan="4" style="text-align:right">TOTAL</td><td class="num">${pesos(o.total)}</td></tr></tfoot>
        </table>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div style="font-size:9pt;flex:1">${o.observaciones ? '<b>Observaciones:</b> ' + escMultilinea(o.observaciones) : ''}</div>
          ${o.pagado ? `<div style="text-align:center"><span class="doc-sello">PAGADO</span><div style="font-size:8pt">${fecha(o.fecha_pago)} · ${esc(o.medio_pago || '')}</div></div>`
                     : '<span class="doc-sello rojo">PENDIENTE DE PAGO</span>'}
        </div>
        ${firmasDoc(tipo === 'retiro' ? ['Entregó (Cuartel)', 'Recibí conforme (Cliente)'] : ['Recibió (Cuartel)', 'Cliente'])}
      </div>`;
    imprimir(`${copia('ORIGINAL – Cliente')}<div class="doc-corte"><span>✂ cortar aquí</span></div>${copia('DUPLICADO – Cuartel')}`,
      `${titulo} - Orden ${nroOrden(o.numero)}`);
  }
};
