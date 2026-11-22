/* =====================================================================
   adjuntos.js · Comprobantes adjuntos (fotos y PDF) en Supabase Storage
   Bucket privado "comprobantes". Rutas:
     movimientos/{id}/archivo · gastos/{id}/archivo · notas/{id}/archivo
   ===================================================================== */
'use strict';

const Adjuntos = {
  BUCKET: 'comprobantes',
  MAX_BYTES: 5 * 1024 * 1024,
  MAX_LADO: 1600,
  CALIDAD: 0.7,

  /** Comprime una imagen con canvas: máximo 1600 px de lado, JPEG calidad 0,7 */
  async comprimirImagen(archivo) {
    let fuente;
    try {
      fuente = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
    } catch {
      fuente = await new Promise((ok, mal) => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = () => mal(new Error('No se pudo leer la imagen. Probá con JPG o PNG.'));
        img.src = URL.createObjectURL(archivo);
      });
    }
    const ancho = fuente.width, alto = fuente.height;
    const escala = Math.min(1, this.MAX_LADO / Math.max(ancho, alto));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(ancho * escala);
    canvas.height = Math.round(alto * escala);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';                       // fondo blanco para PNG transparentes
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(fuente, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', this.CALIDAD));
    if (!blob) throw new Error('No se pudo comprimir la imagen.');
    return blob;
  },

  /** Nombre de archivo seguro para la ruta de Storage */
  nombreSeguro(nombre, extension) {
    const base = String(nombre || 'archivo').replace(/\.[^.]+$/, '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'archivo';
    return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${base}.${extension}`;
  },

  /** Prepara un archivo: comprime imágenes, valida PDF y tamaño */
  async preparar(archivo) {
    if (archivo.type === 'application/pdf' || /\.pdf$/i.test(archivo.name)) {
      if (archivo.size > this.MAX_BYTES) throw new Error(`"${archivo.name}" supera los 5 MB.`);
      return { blob: archivo, mime: 'application/pdf', ext: 'pdf' };
    }
    if (archivo.type.startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(archivo.name)) {
      const blob = await this.comprimirImagen(archivo);
      if (blob.size > this.MAX_BYTES) throw new Error(`"${archivo.name}" supera los 5 MB aun comprimido.`);
      return { blob, mime: 'image/jpeg', ext: 'jpg' };
    }
    throw new Error(`"${archivo.name}": solo se permiten JPG, PNG o PDF.`);
  },

  /**
   * Sube archivos y los registra en la tabla adjuntos.
   * destino: { carpeta: 'movimientos'|'gastos'|'notas', id, campo: 'movimiento_id'|'gasto_id'|'nota_id' }
   */
  async subir(archivos, destino) {
    let subidos = 0;
    for (const archivo of archivos) {
      const { blob, mime, ext } = await this.preparar(archivo);
      const ruta = `${destino.carpeta}/${destino.id}/${this.nombreSeguro(archivo.name, ext)}`;
      const { error: errSubida } = await App.sb.storage.from(this.BUCKET)
        .upload(ruta, blob, { contentType: mime, upsert: false });
      if (errSubida) throw errSubida;
      const { error: errFila } = await App.sb.from('adjuntos').insert({
        [destino.campo]: destino.id, ruta, nombre: archivo.name || ruta.split('/').pop(), tipo_mime: mime, tamanio: blob.size
      });
      if (errFila) {
        await App.sb.storage.from(this.BUCKET).remove([ruta]);   // no dejar archivos huérfanos
        throw errFila;
      }
      subidos++;
    }
    return subidos;
  },

  /** Borra un adjunto (archivo + registro) */
  async borrar(adj) {
    const { error } = await App.sb.storage.from(this.BUCKET).remove([adj.ruta]);
    if (error) throw error;
    await q(App.sb.from('adjuntos').delete().eq('id', adj.id));
  },

  /** Borra los archivos de Storage de una lista de adjuntos (antes de borrar el registro padre) */
  async borrarArchivos(campo, id) {
    const lista = await q(App.sb.from('adjuntos').select('id, ruta').eq(campo, id));
    if (lista.length) {
      const { error } = await App.sb.storage.from(this.BUCKET).remove(lista.map((a) => a.ruta));
      if (error) throw error;
    }
  },

  /** URLs firmadas temporales (1 hora) para una lista de adjuntos */
  async urlsFirmadas(lista) {
    if (!lista.length) return {};
    const { data, error } = await App.sb.storage.from(this.BUCKET).createSignedUrls(lista.map((a) => a.ruta), 3600);
    if (error) throw error;
    const mapa = {};
    (data || []).forEach((d) => { if (d.signedUrl) mapa[d.path] = d.signedUrl; });
    return mapa;
  },

  /** Muestra un adjunto: imagen ampliada o PDF en un visor (con enlace a pestaña nueva) */
  ver(adj, url) {
    const esPdf = adj.tipo_mime === 'application/pdf';
    abrirModal({
      titulo: adj.nombre,
      ancho: 'sm:max-w-4xl',
      cuerpo: esPdf
        ? `<iframe src="${esc(url)}" class="w-full h-[70vh] rounded border" title="PDF"></iframe>`
        : `<img src="${esc(url)}" alt="${esc(adj.nombre)}" class="max-w-full max-h-[75vh] mx-auto rounded">`,
      pie: `<a class="btn btn-secundario" href="${esc(url)}" target="_blank" rel="noopener">↗ Abrir en pestaña nueva</a>
            <button class="btn btn-primario" data-cerrar>Cerrar</button>`
    });
  },

  /** HTML de los botones para elegir archivos (cámara o archivo) en un formulario */
  selectorHtml() {
    return `
      <div data-selector-adjuntos>
        <div class="flex flex-wrap gap-2">
          <label class="btn btn-secundario cursor-pointer">📷 Sacar foto
            <input type="file" accept="image/*" capture="environment" class="hidden" data-input-adj>
          </label>
          <label class="btn btn-secundario cursor-pointer">📁 Elegir archivo
            <input type="file" accept="image/*,application/pdf" multiple class="hidden" data-input-adj>
          </label>
        </div>
        <ul class="mt-2 space-y-1 text-sm" data-lista-adj></ul>
        <p class="text-xs text-gray-500 mt-1">JPG, PNG o PDF · máximo 5 MB por archivo. Las fotos se comprimen automáticamente.</p>
      </div>`;
  },

  /** Conecta el selector y devuelve una función que entrega los archivos elegidos */
  conectarSelector(raiz) {
    const cont = $('[data-selector-adjuntos]', raiz);
    const lista = $('[data-lista-adj]', cont);
    const elegidos = [];
    const pintar = () => {
      lista.innerHTML = elegidos.map((f, i) => `
        <li class="flex items-center gap-2 bg-gray-50 rounded px-2 py-1">
          <span>${f.type === 'application/pdf' ? '📄' : '🖼️'}</span>
          <span class="flex-1 truncate">${esc(f.name)}</span>
          <span class="text-gray-500">${(f.size / 1024 / 1024).toFixed(1)} MB</span>
          <button type="button" class="text-red-700 px-2" data-quitar="${i}" aria-label="Quitar">✕</button>
        </li>`).join('');
    };
    $$('[data-input-adj]', cont).forEach((inp) => inp.addEventListener('change', () => {
      for (const f of inp.files) {
        if (f.type === 'application/pdf' && f.size > this.MAX_BYTES) { toast(`"${f.name}" supera los 5 MB.`, 'error'); continue; }
        elegidos.push(f);
      }
      inp.value = '';
      pintar();
    }));
    on(lista, 'click', '[data-quitar]', (ev, b) => { elegidos.splice(Number(b.dataset.quitar), 1); pintar(); });
    return () => elegidos.slice();
  },

  /**
   * Gestor de adjuntos de un registro (ver, subir y borrar según permisos).
   * opciones: { titulo, campo, id, carpeta, puedeSubir, puedeBorrar, alCambiar }
   */
  async gestor(op) {
    const m = abrirModal({
      titulo: op.titulo || 'Comprobantes adjuntos',
      ancho: 'sm:max-w-2xl',
      cuerpo: cargandoHtml(),
      pie: '<button class="btn btn-primario" data-cerrar>Cerrar</button>',
      alCerrar: () => { if (cambios && op.alCambiar) op.alCambiar(); }
    });
    let cambios = false;
    let lista = [];
    let urls = {};

    const pintar = async () => {
      try {
        lista = await q(App.sb.from('adjuntos').select('*').eq(op.campo, op.id).order('creado_en'));
        urls = await this.urlsFirmadas(lista);
      } catch (e) {
        m.cuerpo.innerHTML = `<p class="text-red-700">${esc(mensajeError(e))}</p>`;
        return;
      }
      m.cuerpo.innerHTML = `
        ${lista.length ? `<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">${lista.map((a, i) => `
          <div class="border rounded-lg p-2 flex flex-col gap-2">
            <button type="button" data-ver="${i}" class="block">
              ${a.tipo_mime === 'application/pdf'
                ? '<div class="miniatura w-full flex items-center justify-center text-4xl">📄</div>'
                : `<img src="${esc(urls[a.ruta] || '')}" alt="" class="miniatura w-full" loading="lazy">`}
            </button>
            <div class="text-xs truncate" title="${esc(a.nombre)}">${esc(a.nombre)}</div>
            <div class="text-[11px] text-gray-500">${(a.tamanio / 1024).toFixed(0)} KB · ${fechaHora(a.creado_en)}</div>
            ${op.puedeBorrar ? `<button type="button" class="btn btn-peligro btn-chico" data-borrar="${i}">Borrar</button>` : ''}
          </div>`).join('')}</div>` : vacioHtml('No hay comprobantes adjuntos.')}
        ${op.puedeSubir ? `<div class="mt-4 border-t pt-4">
            <div class="font-semibold mb-2">Agregar comprobantes</div>
            ${this.selectorHtml()}
            <button type="button" class="btn btn-primario mt-3 w-full sm:w-auto" data-subir>Subir</button>
          </div>` : ''}`;
      if (op.puedeSubir) {
        const obtener = this.conectarSelector(m.cuerpo);
        $('[data-subir]', m.cuerpo).addEventListener('click', (ev) => conBoton(ev.currentTarget, async () => {
          const archivos = obtener();
          if (!archivos.length) { toast('Elegí al menos un archivo.', 'error'); return; }
          try {
            const n = await this.subir(archivos, { carpeta: op.carpeta, id: op.id, campo: op.campo });
            cambios = true;
            toast(n === 1 ? 'Comprobante subido.' : `${n} comprobantes subidos.`);
            await pintar();
          } catch (e) { toastError(e); }
        }, 'Subiendo…'));
      }
    };
    on(m.cuerpo, 'click', '[data-ver]', (ev, b) => {
      const a = lista[Number(b.dataset.ver)];
      if (urls[a.ruta]) this.ver(a, urls[a.ruta]);
    });
    on(m.cuerpo, 'click', '[data-borrar]', async (ev, b) => {
      const a = lista[Number(b.dataset.borrar)];
      if (!(await confirmar(`¿Borrar el comprobante "${a.nombre}"? No se puede deshacer.`))) return;
      try { await this.borrar(a); cambios = true; toast('Comprobante borrado.'); await pintar(); } catch (e) { toastError(e); }
    });
    await pintar();
  },

  /** Botón 📎 con la cantidad de adjuntos */
  botonHtml(cantidad, datos = '') {
    return `<button type="button" class="btn btn-icono ${cantidad ? 'btn-secundario' : 'btn-secundario opacity-60'}" ${datos}
      title="${cantidad ? cantidad + ' comprobante(s)' : 'Sin comprobante'}">📎${cantidad ? `<span class="text-xs font-bold">${cantidad}</span>` : ''}</button>`;
  }
};
