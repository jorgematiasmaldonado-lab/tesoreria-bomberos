/* =====================================================================
   socios.js · Padrón de socios, cobro de cuotas y estado por mes
   ===================================================================== */
'use strict';

Vistas.socios = {
  async render(cont) {
    const st = (App.estado.socios ||= { pestana: 'padron', texto: '', inactivos: false, mes: mesActual() });
    const tes = esTesoreria();
    cont.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h1 class="text-2xl font-bold">Socios</h1>
        ${tes ? '<button class="btn btn-primario" data-nuevo>＋ Nuevo socio</button>' : ''}
      </div>
      <div class="flex gap-2 mb-3">
        <button class="subpestana ${st.pestana === 'padron' ? 'activa' : ''}" data-pestana="padron">Padrón</button>
        <button class="subpestana ${st.pestana === 'mes' ? 'activa' : ''}" data-pestana="mes">Estado por mes</button>
      </div>
      <div data-contenido>${cargandoHtml()}</div>`;
    on(cont, 'click', '[data-pestana]', (ev, b) => { st.pestana = b.dataset.pestana; renderVista(); });
    on(cont, 'click', '[data-nuevo]', () => this.formulario(null));

    const [socios, cuotas] = await Promise.all([
      qTodo(() => App.sb.from('socios').select('*').order('nombre')),
      qTodo(() => App.sb.from('cuotas_pagadas').select('socio_id, mes, monto, movimiento_id'))
    ]);
    if (App.vista !== 'socios') return;
    const pagos = {};   // socio_id → Set de meses "aaaa-mm"
    cuotas.forEach((c) => { (pagos[c.socio_id] ||= new Set()).add(c.mes.slice(0, 7)); });
    this._datos = { socios, cuotas, pagos };

    const zona = $('[data-contenido]', cont);
    if (st.pestana === 'padron') this.padron(zona, st, socios, pagos);
    else this.porMes(zona, st, socios, pagos);

    const buscar = (id) => socios.find((s) => s.id === id);
    on(cont, 'click', '[data-editar]', (ev, b) => this.formulario(buscar(b.dataset.editar)));
    on(cont, 'click', '[data-cobrar]', (ev, b) => this.cobrar(buscar(b.dataset.cobrar), pagos));
    on(cont, 'click', '[data-historial]', (ev, b) => this.historial(buscar(b.dataset.historial)));
    on(cont, 'click', '[data-wa]', (ev, b) => {
      const s = buscar(b.dataset.wa);
      abrirWhatsApp(this.mensajeRecordatorio(s, this.mesesAdeudados(s, pagos, st.mes)), s.telefono);
    });
    on(cont, 'click', '[data-borrar]', async (ev, b) => {
      const s = buscar(b.dataset.borrar);
      if (!(await confirmar(`¿Borrar a "${s.nombre}" del padrón?\nSe borra su historial de cuotas (los ingresos ya registrados en Movimientos se conservan). Si dejó de ser socio, conviene marcarlo como inactivo.`))) return;
      try { await q(App.sb.from('socios').delete().eq('id', s.id)); toast('Socio borrado.'); refrescarVista(); } catch (e) { toastError(e); }
    });
  },

  /** Meses adeudados por un socio hasta el mes indicado (máximo 12 hacia atrás) */
  mesesAdeudados(s, pagos, hastaMes) {
    const lista = [];
    const alta = (s.fecha_alta || hoy()).slice(0, 7);
    for (let i = 0; i < 12; i++) {
      const mes = sumarMeses(hastaMes, -i);
      if (mes < alta) break;
      if (!pagos[s.id]?.has(mes)) lista.unshift(mes);
    }
    return lista;
  },

  mensajeRecordatorio(s, meses) {
    const nombre = (App.config.nombre || 'Bomberos Voluntarios de Villa Río Icho Cruz').replace(/^Asociación de /, '');
    const detalle = meses.map(nombreMes).join(', ');
    const total = meses.length * Number(s.cuota);
    return `Hola ${s.nombre.split(' ')[0]}! 👋 Te escribimos de ${nombre} 🚒.\n`
      + `Te recordamos que tenés pendiente la cuota social de: ${detalle} (${pesos(total)}).\n`
      + `Tu aporte es fundamental para seguir cuidando a nuestra comunidad. ¡Muchas gracias! ❤️`;
  },

  padron(zona, st, socios, pagos) {
    const tes = esTesoreria();
    zona.innerHTML = `
      <div class="tarjeta mb-3 flex flex-wrap gap-3 items-center">
        <input type="search" data-buscar value="${esc(st.texto)}" placeholder="Buscar por nombre, DNI o teléfono" class="campo campo-chico flex-1 min-w-[12rem]">
        <label class="flex items-center gap-2"><input type="checkbox" data-inactivos ${st.inactivos ? 'checked' : ''} class="w-5 h-5"> Mostrar inactivos</label>
        <button class="btn btn-secundario btn-chico" data-exportar>⬇ Excel</button>
      </div>
      <div data-filas></div>`;
    const pintar = () => {
      const t = st.texto.toLowerCase();
      const lista = socios.filter((s) => (st.inactivos || s.activo)
        && (!t || [s.nombre, s.dni, s.telefono, s.direccion].some((x) => String(x || '').toLowerCase().includes(t))));
      const mes = mesActual();
      $('[data-filas]', zona).innerHTML = !lista.length ? `<div class="tarjeta">${vacioHtml('No hay socios para mostrar.')}</div>` : `
        <p class="text-sm text-gray-600 mb-2">${lista.length} socio(s)</p>
        <div class="grid gap-2 md:grid-cols-2">${lista.map((s) => {
          const alDia = pagos[s.id]?.has(mes);
          return `<div class="tarjeta p-3">
            <div class="flex justify-between gap-2">
              <div class="min-w-0"><div class="font-semibold">${esc(s.nombre)} ${s.activo ? '' : '<span class="chip chip-gris">Inactivo</span>'}</div>
                <div class="text-sm text-gray-500">${[s.dni && 'DNI ' + s.dni, s.telefono, s.direccion].filter(Boolean).map(esc).join(' · ')}</div></div>
              <div class="text-right"><div class="font-bold num">${pesos(s.cuota)}</div>
                ${s.activo ? `<span class="chip ${alDia ? 'chip-verde' : 'chip-rojo'}">${alDia ? 'Al día' : 'Debe ' + MESES[Number(mes.slice(5)) - 1].toLowerCase()}</span>` : ''}</div>
            </div>
            <div class="flex flex-wrap gap-2 mt-2">
              ${tes && s.activo ? `<button class="btn btn-verde btn-chico" data-cobrar="${s.id}">💲 Cobrar cuota</button>` : ''}
              <button class="btn btn-secundario btn-chico" data-historial="${s.id}">Pagos</button>
              ${tes ? `<button class="btn btn-secundario btn-icono" data-editar="${s.id}" title="Editar">✏️</button>
                       <button class="btn btn-peligro btn-icono" data-borrar="${s.id}" title="Borrar">🗑</button>` : ''}
            </div>
          </div>`;
        }).join('')}</div>`;
    };
    pintar();
    $('[data-buscar]', zona).addEventListener('input', debounce((ev) => { st.texto = ev.target.value; pintar(); }, 250));
    $('[data-inactivos]', zona).addEventListener('change', (ev) => { st.inactivos = ev.target.checked; pintar(); });
    $('[data-exportar]', zona).addEventListener('click', () => exportarCSV('socios.csv', [
      { titulo: 'Nombre', valor: (s) => s.nombre }, { titulo: 'DNI', valor: (s) => s.dni },
      { titulo: 'Teléfono', valor: (s) => s.telefono }, { titulo: 'Dirección', valor: (s) => s.direccion },
      { titulo: 'Cuota', valor: (s) => numExcel(s.cuota) }, { titulo: 'Alta', valor: (s) => fecha(s.fecha_alta) },
      { titulo: 'Estado', valor: (s) => (s.activo ? 'Activo' : 'Inactivo') }
    ], socios));
  },

  porMes(zona, st, socios, pagos) {
    const { hasta } = rangoMes(st.mes);
    const activos = socios.filter((s) => s.activo && s.fecha_alta <= hasta);
    const alDia = activos.filter((s) => pagos[s.id]?.has(st.mes));
    const deben = activos.filter((s) => !pagos[s.id]?.has(st.mes));
    const adeudado = deben.reduce((t, s) => t + Number(s.cuota), 0);
    zona.innerHTML = `
      <div class="flex flex-wrap items-center gap-3 mb-3">${selectorMesHtml(st.mes)}</div>
      <div class="grid grid-cols-3 gap-2 mb-3 text-center">
        <div class="tarjeta py-2"><div class="text-xs text-gray-500">Al día</div><div class="text-xl font-bold text-green-800">${alDia.length}</div></div>
        <div class="tarjeta py-2"><div class="text-xs text-gray-500">Deben</div><div class="text-xl font-bold text-red-700">${deben.length}</div></div>
        <div class="tarjeta py-2"><div class="text-xs text-gray-500">Total adeudado</div><div class="font-bold monto-egreso">${pesos(adeudado)}</div></div>
      </div>
      <div class="grid md:grid-cols-2 gap-3">
        <div class="tarjeta">
          <div class="flex items-center justify-between mb-2"><h2 class="font-bold text-red-700">Deben ${esc(nombreMes(st.mes))}</h2>
            ${deben.length ? '<button class="btn btn-secundario btn-chico" data-copiar-lista>📋 Copiar lista</button>' : ''}</div>
          ${deben.length ? `<ul class="divide-y">${deben.map((s) => {
            const meses = this.mesesAdeudados(s, pagos, st.mes);
            return `<li class="py-2 flex items-center gap-2">
              <div class="flex-1 min-w-0"><div class="font-medium truncate">${esc(s.nombre)}</div>
                <div class="text-xs text-gray-500">${meses.length} mes(es) · ${pesos(meses.length * s.cuota)}${s.telefono ? '' : ' · sin teléfono'}</div></div>
              <button class="btn btn-verde btn-icono" data-wa="${s.id}" title="Recordatorio por WhatsApp">💬</button>
              ${esTesoreria() ? `<button class="btn btn-secundario btn-chico" data-cobrar="${s.id}">💲</button>` : ''}
            </li>`;
          }).join('')}</ul>` : '<p class="text-gray-500">✅ Todos los socios activos pagaron.</p>'}
        </div>
        <div class="tarjeta">
          <h2 class="font-bold text-green-800 mb-2">Al día</h2>
          ${alDia.length ? `<ul class="divide-y">${alDia.map((s) => `<li class="py-2 flex justify-between"><span>${esc(s.nombre)}</span><span class="num text-gray-600">${pesos(s.cuota)}</span></li>`).join('')}</ul>`
            : '<p class="text-gray-500">Nadie pagó todavía este mes.</p>'}
        </div>
      </div>`;
    conectarSelectorMes(zona, (mes) => { st.mes = mes; renderVista(); });
    $('[data-copiar-lista]', zona)?.addEventListener('click', () => {
      copiarTexto(`*Socios con cuota pendiente · ${nombreMes(st.mes)}*\n` + deben.map((s) => `- ${s.nombre}: ${pesos(s.cuota)}`).join('\n')
        + `\n\n*Total adeudado: ${pesos(adeudado)}*`);
    });
  },

  formulario(soc) {
    const s = soc || { activo: true, fecha_alta: hoy(), cuota: '' };
    const m = abrirModal({
      titulo: soc ? 'Editar socio' : 'Nuevo socio',
      cuerpo: `<form class="space-y-3" novalidate>
        <div><label class="etiqueta">Nombre y apellido *</label><input name="nombre" value="${esc(s.nombre || '')}" class="campo" maxlength="200"></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="etiqueta">DNI</label><input name="dni" value="${esc(s.dni || '')}" class="campo" inputmode="numeric"></div>
          <div><label class="etiqueta">Teléfono (WhatsApp)</label><input name="telefono" value="${esc(s.telefono || '')}" class="campo" inputmode="tel" placeholder="3541 123456"></div>
        </div>
        <div><label class="etiqueta">Dirección</label><input name="direccion" value="${esc(s.direccion || '')}" class="campo"></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="etiqueta">Cuota mensual *</label><input name="cuota" inputmode="decimal" value="${esc(montoInput(s.cuota))}" class="campo" placeholder="0,00"></div>
          <div><label class="etiqueta">Fecha de alta *</label><input type="date" name="fecha_alta" value="${esc(s.fecha_alta)}" class="campo"></div>
        </div>
        <label class="flex items-center gap-2"><input type="checkbox" name="activo" ${s.activo ? 'checked' : ''} class="w-5 h-5"> Socio activo</label>
        <div><label class="etiqueta">Observaciones</label><textarea name="observaciones" class="campo">${esc(s.observaciones || '')}</textarea></div>
      </form>`,
      pie: `<button class="btn btn-secundario" data-cerrar>Cancelar</button><button class="btn btn-primario" data-ok>Guardar</button>`
    });
    const form = $('form', m.el);
    $('[data-ok]', m.el).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      const d = leerForm(form);
      const cuota = parseMonto(d.cuota);
      if (!d.nombre) return errorCampo(form, 'nombre', 'El nombre es obligatorio.');
      if (!(cuota > 0)) return errorCampo(form, 'cuota', 'La cuota mensual debe ser mayor a 0.');
      if (!esFechaValida(d.fecha_alta)) return errorCampo(form, 'fecha_alta', 'Ingresá una fecha válida.');
      try {
        const fila = { ...d, cuota };
        if (soc) await q(App.sb.from('socios').update(fila).eq('id', soc.id));
        else await q(App.sb.from('socios').insert(fila));
        toast('Socio guardado.');
        m.cerrar();
        refrescarVista();
      } catch (e) { toastError(e); }
    }));
  },

  /** Cobrar uno o varios meses → un ingreso automático en "Cuotas sociales" */
  cobrar(s, pagos) {
    const actual = mesActual();
    const alta = s.fecha_alta.slice(0, 7);
    const meses = [];
    for (let i = -12; i <= 6; i++) {
      const mes = sumarMeses(actual, i);
      if (mes >= alta || i >= 0) meses.push(mes);
    }
    const pagado = (mes) => pagos[s.id]?.has(mes);
    const m = abrirModal({
      titulo: `Cobrar cuota · ${s.nombre}`,
      ancho: 'sm:max-w-xl',
      cuerpo: `<form class="space-y-3" novalidate>
        <div class="text-sm text-gray-600">Cuota mensual: <b>${pesos(s.cuota)}</b>. Elegí los meses que paga:</div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${meses.map((mes) => `
          <label class="flex items-center gap-2 border rounded-lg px-2 py-2 ${pagado(mes) ? 'bg-green-50 text-green-800' : 'bg-white'}">
            <input type="checkbox" value="${mes}" data-mes class="w-5 h-5" ${pagado(mes) ? 'disabled checked' : ''}
              ${!pagado(mes) && mes === actual ? 'checked' : ''}>
            <span class="text-sm">${esc(nombreMes(mes))}${pagado(mes) ? ' ✔' : ''}</span></label>`).join('')}</div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="etiqueta">Medio de pago *</label><select name="medio" class="campo">${opcionesHtml(MEDIOS_PAGO, 'Efectivo')}</select></div>
          <div><label class="etiqueta">Fecha *</label><input type="date" name="fecha" value="${hoy()}" class="campo"></div>
        </div>
        <div class="text-right text-xl font-bold">Total: <span data-total></span></div>
      </form>`,
      pie: `<button class="btn btn-secundario" data-cerrar>Cancelar</button><button class="btn btn-verde" data-ok>💲 Cobrar</button>`
    });
    const form = $('form', m.el);
    const elegidos = () => $$('[data-mes]:checked:not(:disabled)', form).map((c) => c.value);
    const total = () => { $('[data-total]', form).textContent = pesos(elegidos().length * s.cuota); };
    form.addEventListener('change', total);
    total();
    $('[data-ok]', m.el).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      const d = leerForm(form);
      const lista = elegidos();
      if (!lista.length) return toast('Elegí al menos un mes.', 'error');
      if (!esFechaValida(d.fecha)) return errorCampo(form, 'fecha', 'Ingresá una fecha válida.');
      try {
        await q(App.sb.rpc('cobrar_cuotas', { p_socio: s.id, p_meses: lista.map((x) => x + '-01'), p_medio: d.medio, p_fecha: d.fecha }));
        toast(`Cobradas ${lista.length} cuota(s) de ${s.nombre}.`);
        m.cerrar();
        refrescarVista();
      } catch (e) { toastError(e); }
    }, 'Cobrando…'));
  },

  /** Historial de pagos del socio (con opción de anular un cobro) */
  historial(s) {
    const cuotas = this._datos.cuotas.filter((c) => c.socio_id === s.id).sort((a, b) => b.mes.localeCompare(a.mes));
    const m = abrirModal({
      titulo: `Pagos · ${s.nombre}`,
      cuerpo: !cuotas.length ? vacioHtml('No registra pagos.') : `<ul class="divide-y">${cuotas.map((c) => `
        <li class="py-2 flex items-center gap-2"><span class="flex-1">${esc(nombreMes(c.mes.slice(0, 7)))}</span><span class="num">${pesos(c.monto)}</span>
          ${esTesoreria() ? `<button class="btn btn-peligro btn-chico" data-anular="${c.movimiento_id}">Anular</button>` : ''}</li>`).join('')}</ul>`,
      pie: '<button class="btn btn-primario" data-cerrar>Cerrar</button>'
    });
    on(m.cuerpo, 'click', '[data-anular]', async (ev, b) => {
      const juntos = cuotas.filter((c) => c.movimiento_id === b.dataset.anular).map((c) => nombreMes(c.mes.slice(0, 7)));
      if (!(await confirmar(`¿Anular este cobro? Se borrará el ingreso y quedarán impagos: ${juntos.join(', ')}.`, { textoOk: 'Anular cobro' }))) return;
      try { await q(App.sb.rpc('anular_cuotas', { p_movimiento: b.dataset.anular })); toast('Cobro anulado.'); m.cerrar(); refrescarVista(); } catch (e) { toastError(e); }
    });
  }
};
