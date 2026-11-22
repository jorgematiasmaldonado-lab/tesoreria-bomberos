/* =====================================================================
   notas.js · Notas (eventos, informes técnicos, de actuación, etc.)
   ===================================================================== */
'use strict';

Vistas.notas = {
  puedeCrear: () => ['tesoreria', 'encargado'].includes(App.rol),
  puedeEditar: (n) => esTesoreria() || (App.rol === 'encargado' && n.creado_por === App.usuario.id),

  async render(cont) {
    const st = (App.estado.notas ||= { texto: '', tipo: '' });
    const tipos = App.cat.tiposNota || [];
    cont.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h1 class="text-2xl font-bold">Notas</h1>
        ${this.puedeCrear() ? '<button class="btn btn-primario" data-nueva>＋ Nueva nota</button>' : ''}
      </div>
      <div class="tarjeta mb-3 grid sm:grid-cols-3 gap-2">
        <input type="search" data-buscar value="${esc(st.texto)}" placeholder="Buscar en título o texto" class="campo campo-chico sm:col-span-2">
        <select data-tipo class="campo campo-chico">${opcionesHtml(tipos, st.tipo, { vacio: 'Todos los tipos' })}</select>
      </div>
      <div data-lista>${cargandoHtml()}</div>`;
    on(cont, 'click', '[data-nueva]', () => this.formulario(null));

    const notas = await qTodo(() => App.sb.from('notas').select('*, adjuntos(count)').order('fecha', { ascending: false }).order('creado_en', { ascending: false }));
    if (App.vista !== 'notas') return;
    const nombreTipo = (id) => tipos.find((t) => t.id === id)?.nombre || 'Sin tipo';

    const pintar = () => {
      const t = st.texto.trim().toLowerCase();
      const lista = notas.filter((n) => (!st.tipo || n.tipo_id === st.tipo)
        && (!t || [n.titulo, n.texto, n.autor_nombre].some((x) => String(x || '').toLowerCase().includes(t))));
      $('[data-lista]', cont).innerHTML = !lista.length ? `<div class="tarjeta">${vacioHtml('No hay notas.')}</div>` : `
        <div class="grid gap-3 md:grid-cols-2">${lista.map((n) => `
          <div class="tarjeta flex flex-col">
            <div class="flex justify-between gap-2 items-start">
              <button class="text-left font-bold text-lg hover:underline" data-ver="${n.id}">${esc(n.titulo)}</button>
              <span class="chip chip-azul">${esc(nombreTipo(n.tipo_id))}</span>
            </div>
            <div class="text-xs text-gray-500">${fecha(n.fecha)} · ${esc(n.autor_nombre || '—')}</div>
            <p class="text-sm text-gray-700 mt-2 flex-1 line-clamp-3">${esc((n.texto || '').slice(0, 280))}${(n.texto || '').length > 280 ? '…' : ''}</p>
            <div class="flex flex-wrap gap-2 mt-3">
              <button class="btn btn-secundario btn-chico" data-ver="${n.id}">Ver</button>
              ${Adjuntos.botonHtml(n.adjuntos?.[0]?.count || 0, `data-adj="${n.id}"`)}
              <button class="btn btn-secundario btn-icono" data-imprimir="${n.id}" title="Imprimir">🖨</button>
              ${this.puedeEditar(n) ? `<button class="btn btn-secundario btn-icono" data-editar="${n.id}" title="Editar">✏️</button>
                <button class="btn btn-peligro btn-icono" data-borrar="${n.id}" title="Borrar">🗑</button>` : ''}
            </div>
          </div>`).join('')}</div>`;
    };
    pintar();
    $('[data-buscar]', cont).addEventListener('input', debounce((ev) => { st.texto = ev.target.value; pintar(); }, 250));
    $('[data-tipo]', cont).addEventListener('change', (ev) => { st.tipo = ev.target.value; pintar(); });

    const buscar = (id) => notas.find((n) => n.id === id);
    on(cont, 'click', '[data-ver]', (ev, b) => this.ver(buscar(b.dataset.ver), nombreTipo));
    on(cont, 'click', '[data-editar]', (ev, b) => this.formulario(buscar(b.dataset.editar)));
    on(cont, 'click', '[data-imprimir]', (ev, b) => this.imprimir(buscar(b.dataset.imprimir), nombreTipo));
    on(cont, 'click', '[data-adj]', (ev, b) => {
      const n = buscar(b.dataset.adj);
      const puede = this.puedeEditar(n);
      Adjuntos.gestor({ titulo: `Adjuntos · ${n.titulo}`, campo: 'nota_id', id: n.id, carpeta: 'notas', puedeSubir: puede, puedeBorrar: puede, alCambiar: refrescarVista });
    });
    on(cont, 'click', '[data-borrar]', async (ev, b) => {
      const n = buscar(b.dataset.borrar);
      if (!(await confirmar(`¿Borrar la nota "${n.titulo}" y sus adjuntos?`))) return;
      try {
        await Adjuntos.borrarArchivos('nota_id', n.id);
        await q(App.sb.from('notas').delete().eq('id', n.id));
        toast('Nota borrada.');
        refrescarVista();
      } catch (e) { toastError(e); }
    });
  },

  ver(n, nombreTipo) {
    const m = abrirModal({
      titulo: n.titulo, ancho: 'sm:max-w-2xl',
      cuerpo: `<div class="text-sm text-gray-500 mb-3">${fecha(n.fecha)} · ${esc(nombreTipo(n.tipo_id))} · ${esc(n.autor_nombre || '')}</div>
        <div class="whitespace-pre-wrap">${esc(n.texto || '')}</div>`,
      pie: `<button class="btn btn-secundario" data-adj-modal>📎 Adjuntos</button><button class="btn btn-secundario" data-imp-modal>🖨 Imprimir</button><button class="btn btn-primario" data-cerrar>Cerrar</button>`
    });
    $('[data-imp-modal]', m.el).addEventListener('click', () => this.imprimir(n, nombreTipo));
    $('[data-adj-modal]', m.el).addEventListener('click', () => {
      const puede = this.puedeEditar(n);
      Adjuntos.gestor({ titulo: `Adjuntos · ${n.titulo}`, campo: 'nota_id', id: n.id, carpeta: 'notas', puedeSubir: puede, puedeBorrar: puede, alCambiar: refrescarVista });
    });
  },

  formulario(nota) {
    const n = nota || { fecha: hoy(), tipo_id: (App.cat.tiposNota || []).find((t) => t.nombre === 'General')?.id };
    const tipos = (App.cat.tiposNota || []).filter((t) => t.activo || t.id === n.tipo_id);
    const m = abrirModal({
      titulo: nota ? 'Editar nota' : 'Nueva nota', ancho: 'sm:max-w-2xl',
      cuerpo: `<form class="space-y-3" novalidate>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="etiqueta">Fecha *</label><input type="date" name="fecha" value="${esc(n.fecha)}" class="campo"></div>
          <div><label class="etiqueta">Tipo *</label><select name="tipo_id" class="campo">${opcionesHtml(tipos, n.tipo_id, { vacio: 'Elegí un tipo' })}</select></div>
        </div>
        <div><label class="etiqueta">Título *</label><input name="titulo" value="${esc(n.titulo || '')}" class="campo" maxlength="200"></div>
        <div><label class="etiqueta">Texto</label><textarea name="texto" class="campo" rows="8">${esc(n.texto || '')}</textarea></div>
        ${nota ? '' : `<div><label class="etiqueta">Adjuntos (opcional)</label>${Adjuntos.selectorHtml()}</div>`}
      </form>`,
      pie: `<button class="btn btn-secundario" data-cerrar>Cancelar</button><button class="btn btn-primario" data-ok>Guardar</button>`
    });
    const form = $('form', m.el);
    const archivos = nota ? () => [] : Adjuntos.conectarSelector(form);
    $('[data-ok]', m.el).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
      const d = leerForm(form);
      if (!esFechaValida(d.fecha)) return errorCampo(form, 'fecha', 'Ingresá una fecha válida.');
      if (!d.tipo_id) return errorCampo(form, 'tipo_id', 'Elegí el tipo de nota.');
      if (!d.titulo) return errorCampo(form, 'titulo', 'El título es obligatorio.');
      try {
        if (nota) await q(App.sb.from('notas').update(d).eq('id', nota.id));
        else {
          const nueva = await q(App.sb.from('notas').insert(d).select('id').single());
          const lista = archivos();
          if (lista.length) {
            try { await Adjuntos.subir(lista, { carpeta: 'notas', id: nueva.id, campo: 'nota_id' }); }
            catch (e) { toast('La nota se guardó, pero falló la subida de un adjunto: ' + mensajeError(e), 'error', 7000); }
          }
        }
        toast('Nota guardada.');
        m.cerrar();
        refrescarVista();
      } catch (e) { toastError(e); }
    }));
  },

  imprimir(n, nombreTipo) {
    imprimir(`
      ${encabezadoDoc(nombreTipo(n.tipo_id), fecha(n.fecha))}
      <h2>${esc(n.titulo)}</h2>
      <div style="white-space:pre-wrap">${esc(n.texto || '')}</div>
      <p style="margin-top:14px;font-size:9pt;color:#555">Autor: ${esc(n.autor_nombre || '')}</p>
      ${firmasDoc(['Firma'])}
      ${pieDoc()}`, `Nota - ${n.titulo}`);
  }
};
