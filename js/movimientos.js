/* =====================================================================
   movimientos.js · Ingresos y egresos, filtros, comprobantes y exportación
   ===================================================================== */
'use strict';

const ORIGENES = {
  manual: null,
  extintores: { texto: 'Extintores', modulo: 'Extintores' },
  socios: { texto: 'Cuota social', modulo: 'Socios' },
  gasto: { texto: 'Gasto encargado', modulo: 'Gastos a aprobar' }
};

Vistas.movimientos = {
  async render(cont) {
    const st = App.estado.movimientos = {
      modo: 'mes', mes: mesActual(), desde: rangoMes(mesActual()).desde, hasta: hoy(),
      tipo: '', categoria: '', cuenta: '', texto: '', sinComp: false,
      ...(App.estado.movimientos || {})
    };
    const rango = st.modo === 'mes' ? rangoMes(st.mes) : { desde: st.desde, hasta: st.hasta };
    const tes = esTesoreria();

    cont.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h1 class="text-2xl font-bold">Movimientos</h1>
        <div class="flex flex-wrap gap-2">
          ${tes ? `<button class="btn btn-verde" data-nuevo="ingreso">＋ Ingreso</button>
                   <button class="btn btn-primario" data-nuevo="egreso">－ Egreso</button>` : ''}
          <button class="btn btn-secundario" data-exportar>⬇ Excel</button>
        </div>
      </div>
      <form class="tarjeta mb-3 grid grid-cols-2 md:grid-cols-6 gap-2 items-end" data-filtros>
        <div class="col-span-2 md:col-span-1">
          <label class="etiqueta">Período</label>
          <select name="modo" class="campo campo-chico">
            <option value="mes" ${st.modo === 'mes' ? 'selected' : ''}>Mes</option>
            <option value="rango" ${st.modo === 'rango' ? 'selected' : ''}>Rango de fechas</option>
          </select>
        </div>
        ${st.modo === 'mes'
          ? `<div class="col-span-2 md:col-span-2"><label class="etiqueta">Mes</label>${selectorMesHtml(st.mes)}</div>`
          : `<div><label class="etiqueta">Desde</label><input type="date" name="desde" value="${esc(st.desde)}" class="campo campo-chico"></div>
             <div><label class="etiqueta">Hasta</label><input type="date" name="hasta" value="${esc(st.hasta)}" class="campo campo-chico"></div>`}
        <div><label class="etiqueta">Tipo</label>
          <select name="tipo" class="campo campo-chico">${opcionesHtml([{ id: 'ingreso', nombre: 'Ingresos' }, { id: 'egreso', nombre: 'Egresos' }], st.tipo, { vacio: 'Todos' })}</select></div>
        <div><label class="etiqueta">Cuenta</label>
          <select name="cuenta" class="campo campo-chico">${opcionesHtml([{ id: 'caja', nombre: 'Caja' }, { id: 'banco', nombre: 'Banco' }], st.cuenta, { vacio: 'Todas' })}</select></div>
        <div class="col-span-2 md:col-span-1"><label class="etiqueta">Categoría</label>
          <select name="categoria" class="campo campo-chico">${opcionesHtml(
            (App.cat.categorias || []).filter((c) => !st.tipo || c.tipo === st.tipo), st.categoria,
            { vacio: 'Todas', texto: (c) => `${c.tipo === 'ingreso' ? '↑' : '↓'} ${c.nombre}` })}</select></div>
        <div class="col-span-2 md:col-span-3"><label class="etiqueta">Buscar</label>
          <input type="search" name="texto" value="${esc(st.texto)}" placeholder="Descripción, comprobante, monto…" class="campo campo-chico"></div>
        <label class="col-span-2 md:col-span-2 flex items-center gap-2 py-2"><input type="checkbox" name="sinComp" ${st.sinComp ? 'checked' : ''} class="w-5 h-5"> Solo sin comprobante</label>
      </form>
      <div data-resultado>${cargandoHtml()}</div>`;

    const form = $('[data-filtros]', cont);
    const aplicar = () => {
      const d = leerForm(form);
      Object.assign(st, d);
      if (st.categoria && !Cat.categoria(st.categoria)) st.categoria = '';
      if (st.tipo && Cat.categoria(st.categoria)?.tipo !== st.tipo) st.categoria = '';
      renderVista();
    };
    form.addEventListener('change', (ev) => { if (ev.target.name !== 'texto' && ev.target.name !== 'mes') aplicar(); });
    $('[name="texto"]', form).addEventListener('input', debounce(() => { st.texto = $('[name="texto"]', form).value; pintar(); }, 250));
    if (st.modo === 'mes') conectarSelectorMes(cont, (mes) => { st.mes = mes; renderVista(); });

    if (st.modo === 'rango' && (!esFechaValida(st.desde) || !esFechaValida(st.hasta) || st.desde > st.hasta)) {
      $('[data-resultado]', cont).innerHTML = vacioHtml('Elegí un rango de fechas válido.');
      return;
    }

    let filas = await qTodo(() => {
      let c = App.sb.from('movimientos').select('*, adjuntos(count)').gte('fecha', rango.desde).lte('fecha', rango.hasta);
      if (st.tipo) c = c.eq('tipo', st.tipo);
      if (st.cuenta) c = c.eq('cuenta', st.cuenta);
      if (st.categoria) c = c.eq('categoria_id', st.categoria);
      return c.order('fecha', { ascending: false }).order('creado_en', { ascending: false });
    });
    if (App.vista !== 'movimientos') return;
    let visibles = [];

    const pintar = () => {
      const t = st.texto.toLowerCase();
      visibles = filas.filter((m) => {
        if (st.sinComp && m.adjuntos?.[0]?.count) return false;
        if (!t) return true;
        return [m.descripcion, m.comprobante, Cat.nombreCategoria(m.categoria_id), fecha(m.fecha), pesos(m.monto), String(m.monto)]
          .some((x) => String(x || '').toLowerCase().includes(t));
      });
      const ing = visibles.filter((m) => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0);
      const egr = visibles.filter((m) => m.tipo === 'egreso').reduce((s, m) => s + Number(m.monto), 0);
      const subs = Object.fromEntries((App.cat.subsidios || []).map((s) => [s.id, s.nombre]));

      const acciones = (m) => {
        const n = m.adjuntos?.[0]?.count || 0;
        return `${Adjuntos.botonHtml(n, `data-adj="${m.id}"`)}
          ${tes ? `<button class="btn btn-icono btn-secundario" data-editar="${m.id}" title="Editar">✏️</button>` : ''}
          ${tes && m.origen === 'manual' ? `<button class="btn btn-icono btn-peligro" data-borrar="${m.id}" title="Borrar">🗑</button>` : ''}`;
      };
      const origen = (m) => ORIGENES[m.origen] ? `<span class="chip chip-azul" title="Generado desde ${ORIGENES[m.origen].modulo}">⚙ ${ORIGENES[m.origen].texto}</span>` : '';

      $('[data-resultado]', cont).innerHTML = `
        <div class="grid grid-cols-3 gap-2 mb-3 text-center">
          <div class="tarjeta py-2"><div class="text-xs text-gray-500">Ingresos</div><div class="monto-ingreso num text-center">${pesos(ing)}</div></div>
          <div class="tarjeta py-2"><div class="text-xs text-gray-500">Egresos</div><div class="monto-egreso num text-center">${pesos(egr)}</div></div>
          <div class="tarjeta py-2"><div class="text-xs text-gray-500">Neto · ${visibles.length} mov.</div><div class="font-bold num text-center">${pesos(ing - egr)}</div></div>
        </div>
        ${!visibles.length ? `<div class="tarjeta">${vacioHtml('No hay movimientos con estos filtros.')}</div>` : `
        <div class="tarjeta p-0 overflow-hidden hidden md:block">
          <table class="tabla">
            <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Comprob.</th><th>Cuenta</th><th class="num">Monto</th><th></th></tr></thead>
            <tbody>${visibles.map((m) => `
              <tr>
                <td class="whitespace-nowrap">${fecha(m.fecha)}</td>
                <td>${esc(Cat.nombreCategoria(m.categoria_id))}<div>${origen(m)}</div></td>
                <td>${esc(m.descripcion)}${m.subsidio_id ? `<div class="text-xs text-gray-500">Subsidio: ${esc(subs[m.subsidio_id] || '')}</div>` : ''}</td>
                <td>${esc(m.comprobante)}</td>
                <td>${NOMBRE_CUENTA[m.cuenta]}</td>
                <td class="num ${m.tipo === 'ingreso' ? 'monto-ingreso' : 'monto-egreso'}">${m.tipo === 'egreso' ? '−' : ''}${pesos(m.monto)}</td>
                <td class="whitespace-nowrap text-right">${acciones(m)}</td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="md:hidden space-y-2">${visibles.map((m) => `
          <div class="tarjeta p-3">
            <div class="flex justify-between gap-2">
              <div class="min-w-0">
                <div class="font-semibold">${esc(Cat.nombreCategoria(m.categoria_id))}</div>
                <div class="text-xs text-gray-500">${fecha(m.fecha)} · ${NOMBRE_CUENTA[m.cuenta]}${m.comprobante ? ' · N° ' + esc(m.comprobante) : ''}</div>
              </div>
              <div class="num ${m.tipo === 'ingreso' ? 'monto-ingreso' : 'monto-egreso'}">${m.tipo === 'egreso' ? '−' : ''}${pesos(m.monto)}</div>
            </div>
            ${m.descripcion ? `<div class="text-sm mt-1">${esc(m.descripcion)}</div>` : ''}
            ${m.subsidio_id ? `<div class="text-xs text-gray-500">Subsidio: ${esc(subs[m.subsidio_id] || '')}</div>` : ''}
            <div class="flex items-center justify-between mt-2"><div>${origen(m)}</div><div class="flex gap-1">${acciones(m)}</div></div>
          </div>`).join('')}</div>`}`;
    };
    pintar();

    const buscar = (id) => filas.find((m) => m.id === id);
    on(cont, 'click', '[data-nuevo]', (ev, b) => this.formulario(null, b.dataset.nuevo));
    on(cont, 'click', '[data-editar]', (ev, b) => this.formulario(buscar(b.dataset.editar)));
    on(cont, 'click', '[data-borrar]', (ev, b) => this.borrar(buscar(b.dataset.borrar)));
    on(cont, 'click', '[data-adj]', (ev, b) => {
      const m = buscar(b.dataset.adj);
      Adjuntos.gestor({
        titulo: `Comprobantes · ${Cat.nombreCategoria(m.categoria_id)} ${pesos(m.monto)}`,
        campo: 'movimiento_id', id: m.id, carpeta: 'movimientos',
        puedeSubir: tes, puedeBorrar: tes, alCambiar: refrescarVista
      });
    });
    on(cont, 'click', '[data-exportar]', () => {
      const subs = Object.fromEntries((App.cat.subsidios || []).map((s) => [s.id, s.nombre]));
      exportarCSV(`movimientos_${rango.desde}_${rango.hasta}.csv`, [
        { titulo: 'Fecha', valor: (m) => fecha(m.fecha) },
        { titulo: 'Tipo', valor: (m) => (m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso') },
        { titulo: 'Categoría', valor: (m) => Cat.nombreCategoria(m.categoria_id) },
        { titulo: 'Cuenta', valor: (m) => NOMBRE_CUENTA[m.cuenta] },
        { titulo: 'Monto', valor: (m) => numExcel(m.tipo === 'egreso' ? -m.monto : m.monto) },
        { titulo: 'Descripción', valor: (m) => m.descripcion },
        { titulo: 'Comprobante', valor: (m) => m.comprobante },
        { titulo: 'Subsidio', valor: (m) => subs[m.subsidio_id] || '' },
        { titulo: 'Origen', valor: (m) => ORIGENES[m.origen]?.texto || 'Manual' },
        { titulo: 'Adjuntos', valor: (m) => m.adjuntos?.[0]?.count || 0 }
      ], visibles);
    });
  },

  /** Formulario de alta / edición */
  formulario(mov, tipoNuevo) {
    const nuevo = !mov;
    const m = mov || { fecha: hoy(), tipo: tipoNuevo, cuenta: 'caja', origen: 'manual' };
    const auto = m.origen !== 'manual';
    const modal = abrirModal({
      titulo: nuevo ? (m.tipo === 'ingreso' ? 'Nuevo ingreso' : 'Nuevo egreso') : 'Editar movimiento',
      cuerpo: `<form class="space-y-3" novalidate>
        ${auto ? `<div class="p-3 rounded-lg bg-blue-50 text-sm text-blue-900">Este movimiento se generó desde <b>${esc(ORIGENES[m.origen].modulo)}</b>. El monto, el tipo y la fecha se modifican desde ese módulo.</div>` : ''}
        <div class="grid grid-cols-2 gap-3">
          <div><label class="etiqueta">Fecha *</label><input type="date" name="fecha" value="${esc(m.fecha)}" class="campo" ${auto ? 'disabled' : ''}></div>
          <div><label class="etiqueta">Tipo *</label>
            <select name="tipo" class="campo" ${auto ? 'disabled' : ''}>${opcionesHtml([{ id: 'ingreso', nombre: 'Ingreso' }, { id: 'egreso', nombre: 'Egreso' }], m.tipo)}</select></div>
        </div>
        <div><label class="etiqueta">Categoría *</label><select name="categoria_id" class="campo"></select></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="etiqueta">Monto *</label><input name="monto" inputmode="decimal" value="${esc(montoInput(m.monto))}" placeholder="0,00" class="campo" ${auto ? 'disabled' : ''}></div>
          <div><label class="etiqueta">Cuenta *</label>
            <select name="cuenta" class="campo">${opcionesHtml([{ id: 'caja', nombre: 'Caja' }, { id: 'banco', nombre: 'Banco' }], m.cuenta)}</select></div>
        </div>
        <div><label class="etiqueta">Descripción</label><input name="descripcion" value="${esc(m.descripcion || '')}" class="campo" maxlength="500"></div>
        <div><label class="etiqueta">N° de comprobante o factura</label><input name="comprobante" value="${esc(m.comprobante || '')}" class="campo" maxlength="100"></div>
        <div><label class="etiqueta">Subsidio asociado (opcional)</label>
          <select name="subsidio_id" class="campo">${opcionesHtml(App.cat.subsidios || [], m.subsidio_id, { vacio: '— Ninguno —', texto: (s) => `${s.nombre} (${s.organismo})` })}</select></div>
        ${nuevo ? `<div><label class="etiqueta">Comprobantes adjuntos</label>${Adjuntos.selectorHtml()}</div>` : ''}
      </form>`,
      pie: `<button class="btn btn-secundario" data-cerrar>Cancelar</button><button class="btn btn-primario" data-guardar>Guardar</button>`
    });
    const form = $('form', modal.el);
    const selCat = $('[name="categoria_id"]', form);
    const pintarCategorias = () => {
      const tipo = $('[name="tipo"]', form).value;
      const lista = Cat.categorias(tipo).concat(
        m.categoria_id && Cat.categoria(m.categoria_id)?.tipo === tipo && !Cat.categoria(m.categoria_id).activa ? [Cat.categoria(m.categoria_id)] : []);
      selCat.innerHTML = opcionesHtml(lista, m.categoria_id, { vacio: 'Elegí una categoría' });
    };
    pintarCategorias();
    $('[name="tipo"]', form).addEventListener('change', pintarCategorias);
    const obtenerArchivos = nuevo ? Adjuntos.conectarSelector(form) : () => [];

    $('[data-guardar]', modal.el).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      const d = leerForm(form);
      const monto = parseMonto(d.monto);
      if (!auto) {
        if (!esFechaValida(d.fecha)) return errorCampo(form, 'fecha', 'Ingresá una fecha válida.');
        if (!(monto > 0)) return errorCampo(form, 'monto', 'El monto debe ser mayor a 0.');
      }
      if (!d.categoria_id) return errorCampo(form, 'categoria_id', 'Elegí una categoría.');
      const fila = {
        categoria_id: d.categoria_id, cuenta: d.cuenta, descripcion: d.descripcion,
        comprobante: d.comprobante, subsidio_id: d.subsidio_id || null
      };
      if (!auto) Object.assign(fila, { fecha: d.fecha, tipo: d.tipo, monto });
      try {
        if (nuevo) {
          const creado = await q(App.sb.from('movimientos').insert(fila).select('id').single());
          const archivos = obtenerArchivos();
          if (archivos.length) {
            try { await Adjuntos.subir(archivos, { carpeta: 'movimientos', id: creado.id, campo: 'movimiento_id' }); }
            catch (e) { toast('El movimiento se guardó, pero falló la subida de un comprobante: ' + mensajeError(e), 'error', 7000); }
          }
          toast(d.tipo === 'ingreso' ? 'Ingreso registrado.' : 'Egreso registrado.');
        } else {
          await q(App.sb.from('movimientos').update(fila).eq('id', m.id));
          toast('Movimiento actualizado.');
        }
        modal.cerrar();
        refrescarVista();
      } catch (e) { toastError(e); }
    }));
  },

  async borrar(m) {
    if (!(await confirmar(`¿Borrar el ${m.tipo} de ${pesos(m.monto)} del ${fecha(m.fecha)}?\nTambién se borrarán sus comprobantes adjuntos.`))) return;
    try {
      await Adjuntos.borrarArchivos('movimiento_id', m.id);
      await q(App.sb.from('movimientos').delete().eq('id', m.id));
      toast('Movimiento borrado.');
      refrescarVista();
    } catch (e) { toastError(e); }
  }
};
