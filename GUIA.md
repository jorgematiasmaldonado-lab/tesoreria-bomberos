# Guía de instalación · Sistema de Tesorería y Gestión
**Asociación de Bomberos Voluntarios de Villa Río Icho Cruz**

Desarrollado por Maldonado Jorge Matias · JMM Gestiones & Tecnología — Licencia de uso otorgada a BV Villa Río Icho Cruz

---

## Qué hay en la carpeta

| Archivo / carpeta | Para qué sirve |
|---|---|
| `index.html` | La aplicación (pantallas) |
| `app.js` | Núcleo: ingreso, roles, menú, tiempo real |
| `js/` | Un archivo por sección (movimientos, extintores, socios, etc.) |
| `styles.css` | Estilos propios e impresión en A4 |
| `config.js` | **Hay que completarlo**: URL y anon key de Supabase |
| `supabase.sql` | Script que crea toda la base de datos y la seguridad |
| `manifest.json`, `sw.js`, `icons/` | Para instalar la app en el celular o la PC |
| `logo.png` | Logo del cuartel (**reemplazarlo por el logo real**) |
| `generar-iconos.html` | Herramienta para crear los íconos a partir del logo |

No hace falta instalar nada en la computadora: todo funciona desde el navegador.

---

## Paso 1 · Crear el proyecto en Supabase

1. Entrar a <https://supabase.com> y crear una cuenta (se puede entrar con GitHub).
2. **New project**:
   - *Name*: `bomberos-icho-cruz`
   - *Database Password*: inventar una contraseña fuerte y **guardarla** en un lugar seguro.
   - *Region*: **South America (São Paulo)**, la más cercana.
3. Esperar 1 o 2 minutos a que el proyecto quede listo.

> En el plan gratuito, Supabase pausa el proyecto si pasa una semana sin uso. Si pasa, entrar al panel y tocar **Restore**. Con el uso diario del cuartel no debería pasar.

## Paso 2 · Ejecutar el script SQL

1. En el menú de la izquierda: **SQL Editor** → **New query**.
2. Abrir `supabase.sql` con el Bloc de notas, copiar **todo** el contenido y pegarlo.
3. Tocar **Run**. Tiene que decir *Success*.

El script crea las tablas, los índices, las políticas de seguridad (RLS), los triggers de auditoría, el bucket privado `comprobantes` con sus políticas, el tiempo real y los datos iniciales: categorías, tipos de emergencia, tipos de extintor, niveles de combustible, tipos de nota y la plantilla de móviles.

> Se puede volver a ejecutar sin perder datos, por ejemplo al instalar una versión nueva.

## Paso 3 · Configurar el ingreso (Authentication)

1. **Authentication → Sign In / Providers** (en algunas versiones: *Providers → Email*):
   - **Enable Email provider**: activado.
   - **Confirm email**: **DESACTIVADO**. Es importante: así los usuarios que crea Tesorería desde la app pueden entrar enseguida.
   - **Allow new users to sign up**: activado. La app lo necesita para crear usuarios. Igual es seguro: cualquier cuenta nueva queda **sin rol y desactivada**, y no ve nada hasta que Tesorería le asigna un rol.
2. **Authentication → URL Configuration**:
   - **Site URL**: la dirección donde va a quedar publicada la app (ver Paso 6), por ejemplo `https://usuario.github.io/tesoreria-bomberos/`.
   - **Redirect URLs**: agregar esa misma dirección. Se usa en el email de "recuperar contraseña".

## Paso 4 · Crear el primer usuario de Tesorería

1. **Authentication → Users → Add user → Create new user**.
   - Email y contraseña del tesorero.
   - Tildar **Auto Confirm User**.
2. Volver a **SQL Editor → New query**, pegar esto (cambiando el email y el nombre) y tocar **Run**:

```sql
insert into public.perfiles (id, email, nombre, rol, activo)
select id, email, 'Nombre del Tesorero', 'tesoreria', true
  from auth.users
 where lower(email) = lower('tesoreria@ejemplo.com')
on conflict (id) do update
   set rol = 'tesoreria', activo = true, nombre = excluded.nombre;

select email, nombre, rol, activo from public.perfiles;
```

En el resultado tiene que aparecer el email con rol `tesoreria` y activo `true`. (Supabase guarda los emails en minúsculas; esta consulta funciona aunque lo escribas con mayúsculas, e incluso si el usuario se creó antes de ejecutar `supabase.sql`.) Los demás usuarios se crean después desde la app: **Configuración → Usuarios**.

## Paso 5 · Completar `config.js`

1. En Supabase: **Project Settings → API Keys** (o *Data API*).
2. Copiar:
   - **Project URL**, del tipo `https://abcdefghijk.supabase.co`.
   - **anon public key**: es una clave larga que empieza con `eyJ...`. Si la pantalla muestra claves nuevas `sb_publishable_...`, ir a la pestaña **Legacy API Keys** y copiar la *anon*.
3. Abrir `config.js` con el Bloc de notas y reemplazar los dos valores:

```js
window.CONFIG = {
  SUPABASE_URL: 'https://abcdefghijk.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....'
};
```

> La *anon key* es pública y puede estar en GitHub. **Nunca** pongas la *service_role key* en ningún archivo.

## Paso 6 · Publicar en GitHub Pages con GitHub Desktop

1. Crear una cuenta en <https://github.com> e instalar **GitHub Desktop** (<https://desktop.github.com>).
2. En GitHub Desktop: **File → Add local repository** y elegir la carpeta del sistema. Si avisa que no es un repositorio, tocar **create a repository** → **Create repository**.
3. Escribir un resumen (por ejemplo "Versión inicial"), tocar **Commit to main** y después **Publish repository**.
   - Nombre: `tesoreria-bomberos`.
   - Para usar GitHub Pages gratis, el repositorio tiene que ser **público** (destildar *Keep this code private*). No hay riesgo: los datos están en Supabase, protegidos por usuario y contraseña, no en el código.
4. En github.com, abrir el repositorio → **Settings → Pages**:
   - *Source*: **Deploy from a branch**.
   - *Branch*: **main** / **(root)** → **Save**.
5. En 1 o 2 minutos la app queda en `https://TU-USUARIO.github.io/tesoreria-bomberos/`. Esa es la dirección que va en el Paso 3 (Site URL y Redirect URLs).

**Para publicar cambios:** editar los archivos, abrir GitHub Desktop, **Commit to main** → **Push origin**. Si cambiás algún archivo de la app, subí también el número de `VERSION` en `sw.js` (por ejemplo `bv-v1.0.1`) para que los celulares descarguen la versión nueva.

## Paso 7 · Logo e íconos

1. Reemplazar `logo.png` por el logo real del cuartel, con el mismo nombre. El que viene es provisorio.
2. Abrir `generar-iconos.html` en el navegador (doble clic), elegir el logo y descargar los 5 íconos.
3. Guardarlos en la carpeta `icons/`, reemplazando los existentes.
4. Publicar los cambios (Paso 6).

## Paso 8 · Instalar la app en el celular o en la PC

- **Android (Chrome):** abrir la dirección → menú ⋮ → **Instalar aplicación** (o *Agregar a la pantalla principal*).
- **iPhone (Safari):** botón Compartir → **Agregar a inicio**.
- **PC (Chrome o Edge):** el ícono de instalar ⊕ en la barra de direcciones.

La sesión queda iniciada en cada dispositivo hasta que se toque **Salir**.

---

## Roles y permisos

| Rol | Qué puede hacer |
|---|---|
| **Tesorería** | Todo: carga, edita, borra, aprueba gastos, gestiona usuarios y configuración |
| **Comisión directiva** | Solo lectura de todo lo contable: resumen, movimientos, comprobantes, subsidios, socios, presupuesto, informes, informes semanales, notas y auditoría |
| **Extintores** | Solo el módulo Extintores: órdenes, cobros, retiros y comprobantes. No ve saldos ni contaduría |
| **Encargado de semana** | Solo el Informe semanal (con sus gastos y tickets) y Notas |

Los permisos se controlan **en la base de datos** (Row Level Security). Aunque alguien modifique la app en su navegador, la base le niega lo que no le corresponde.

**Usuarios** (Configuración → Usuarios):
- **Crear:** nombre, email, contraseña inicial y rol.
- **Cambiar el rol** o **desactivar:** se aplica al instante. Un usuario desactivado no puede ingresar.
- **Recuperar contraseña:** le llega un email con un enlace para crear una nueva. Para eso tiene que estar bien configurada la *Site URL* del Paso 3.
- Cada usuario puede cambiar su propia contraseña con el botón 🔑 del encabezado.
- Por seguridad, siempre tiene que quedar al menos un usuario de Tesorería activo.

> Los emails de recuperación de Supabase gratuito tienen un límite de pocos envíos por hora. Si hace falta, Tesorería también puede cambiar la contraseña desde el panel de Supabase: **Authentication → Users → ⋯ → Reset password**.

## Cómo funcionan los movimientos automáticos

- **Extintores:** al cobrar una orden se crea un ingreso en la categoría *Extintores*. Si se paga en efectivo va a **Caja**; con transferencia, débito u otro medio, va a **Banco**.
- **Socios:** al cobrar cuotas se crea un ingreso en *Cuotas sociales*.
- **Gastos del encargado:** al aprobarlos se crea un egreso con la foto del ticket adjunta.

Estos movimientos muestran su origen (⚙) y no se borran desde Movimientos: se anulan desde su módulo ("Anular cobro" o "Volver a pendiente").

## Respaldo

En **Configuración → Respaldo** se descarga un JSON con todos los datos, o cada tabla en CSV para Excel. Se recomienda hacerlo una vez por mes. Los archivos adjuntos quedan en **Supabase → Storage → comprobantes**.

## Problemas frecuentes

| Problema | Solución |
|---|---|
| "Falta la configuración" | Completar `config.js` (Paso 5) y volver a publicar |
| "Email o contraseña incorrectos" | Revisar los datos. Si el usuario se creó en el panel, verificar que tenga *Auto Confirm* |
| "Tu usuario todavía no tiene un rol" | Tesorería tiene que asignarle un rol en Configuración → Usuarios |
| "El email no está confirmado" | Desactivar *Confirm email* (Paso 3) |
| No se actualiza en tiempo real | En Supabase: **Database → Publications → supabase_realtime**, verificar que estén las tablas. Si no, volver a ejecutar `supabase.sql` |
| El celular muestra una versión vieja | Cambiar `VERSION` en `sw.js`, publicar y cerrar y abrir la app |
| "Sin conexión" | Revisar internet. Sin conexión no se pueden guardar cambios |
