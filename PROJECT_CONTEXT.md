# Contexto del proyecto — Portal de Viáticos CKL

Documento de contexto para Claude. Complementa a `CLAUDE.md` (arquitectura técnica y comandos); aquí está el **dominio, las reglas de negocio y las decisiones ya tomadas**. Léelo antes de preguntar al usuario: la mayoría de las dudas comunes están respondidas abajo.

## 1. Qué es

Portal web (en español de México) para que empleados de Grupo Cklass **soliciten viáticos**, un jefe/Finanzas los **autoricen**, y el empleado los **compruebe** con facturas (XML CFDI / PDF). Es un **prototipo frontend sin backend**: todo vive en `localStorage` con datos demo sembrados. Proyecto originado en Lovable; se itera en local con Claude Code.

- Stack: TanStack Start + Router (rutas por archivo), React 19, Tailwind v4, shadcn/ui, Bun. Destino de despliegue: Cloudflare Workers (nitro).
- **Todo texto visible al usuario va en español (MX)**: labels, toasts, errores, placeholders. Fechas `dd/mm/yyyy`, montos con `fmtMoney` (`$1,234`, sin decimales).
- Fuente: Jost. Color de marca primario `#E30613` (rojo CKL). Clases propias `ckl-btn-primary`, `ckl-btn-outline`, `ckl-btn-ghost`, `ckl-input`, `ckl-label`, `ckl-card`, `ckl-badge`: reutilízalas.
- No hay tests ni backend. Validación = `bun run lint`, `bun run build` y probar en navegador (`bun run dev`).

## 2. Mapa de archivos relevantes

| Archivo | Qué contiene |
|---|---|
| `src/lib/store.ts` | **Fuente de verdad**: tipos (`User`, `Role`, `Solicitud`, `Autorizacion`, `ComprobanteGasto`, `Sociedad`, `Hotel`…), `KEYS` de localStorage, datos semilla, `lsGet/lsSet`, `nextFolio`, `fmtMoney`, reset de contraseña, filtros de visibilidad por rol/fecha |
| `src/lib/auth.tsx` | `AuthProvider`, `useAuth()` (`user`, `role`, `cargando`, `login`, `logout`, `hasPerm`), `useLocalStorage<T>` |
| `src/components/portal/Layout.tsx` | Sidebar/topbar y filtrado del menú por permisos; botón “Nueva solicitud” (fondo blanco, borde/texto rojo) con la validación de folios pendientes |
| `src/components/portal/UserMenu.tsx` | Menú de usuario del encabezado (nombre + rol → Cerrar sesión / Cambiar contraseña) y el diálogo “Configuración de seguridad” |
| `src/components/ErrorDialog.tsx` | `showErrorDialog(msg)`: diálogo centrado bloqueante para **errores y validaciones** (se reemplazó el toast de error). Los éxitos siguen usando `toast.success` (sonner) |
| `src/routes/login.tsx` | Login (por correo **o RFC**), Pre-Registro, recuperación de contraseña |
| `src/routes/_portal.dashboard.tsx` | Dashboard (gráfica mensual, atajo a comprobaciones atrasadas) |
| `src/routes/_portal.solicitar.tsx` | Alta/edición de solicitud (destinos, hoteles, transportes, otros) |
| `src/routes/_portal.estatus.tsx` | Lista de solicitudes, autorizar/rechazar, detalle, revertir (admin) |
| `src/routes/_portal.comprobacion.tsx` | Carga de XML/PDF por concepto, validación, no deducibles, depósito sobrante |
| `src/routes/_portal.reportes.tsx` | Reportes/exportación |
| `src/routes/_portal.usuarios.tsx` | CRUD de usuarios (solo admin) y Pre-Registros |
| `src/routes/_portal.permisos.tsx` | Matriz de permisos por rol |
| `src/routes/_portal.configuracion.tsx` | Montos, umbrales, sociedades, hoteles, roles, automatizaciones (SMTP/email) |
| `src/routeTree.gen.ts` | Autogenerado: **no editar** |
| `src/components/ui/*` | shadcn vendorizado: no reescribir |

Archivos sin trackear en git que **no son parte del proyecto** (ignorar, no commitear): `package-lock.json` (se usa Bun, `bun.lock`), `src/_NO_imagen-inicio.png`.

## 3. Datos y persistencia

Claves en `localStorage` (`KEYS` en `store.ts`): `ckl_user`, `ckl_users`, `ckl_roles`, `ckl_solicitudes`, `ckl_destinos`, `ckl_autorizaciones`, `ckl_comprobantes_gasto`, `ckl_facturas_xml`, `ckl_sociedades`, `ckl_hoteles`, `ckl_origenes`, `ckl_config`, `ckl_prealtas`, `ckl_reset_codes`, `ckl_session` (+ `ckl_gastos`, `ckl_notas`, `ckl_comprobantes_viaje` reservadas).

- `initSeed()` siembra **solo claves vacías**. Si cambias la semilla en `store.ts`, un navegador que ya tenga datos **no la verá** hasta limpiar localStorage (DevTools → Application → Clear, o borrar las claves `ckl_*`). Recuérdalo al depurar “no aparece mi dato nuevo”.
- Escribe siempre con `lsSet` (dispara el evento `ckl:storage` que re-sincroniza hooks). Evita `localStorage.setItem` directo.
- Si cambias la forma de un dato guardado, **tolera el esquema viejo** (ver `normalizeDestino` en `solicitar`) porque el usuario tiene datos persistidos.
- Las facturas guardan el archivo como data URL base64 en localStorage (límite ~5 MB del navegador). Para abrirlas se convierte a Blob URL (Chrome bloquea `window.open` a `data:`).
- Sin backend real: no hay correo real (el código de recuperación se muestra en pantalla como “correo simulado”), ni validación SAT real (el total de la factura se simula con un número aleatorio 200–999; el XML solo se revisa por nodo `Emisor` y RFC del `Receptor`).

### Modelo principal
- `Solicitud`: `folio` (`#0041`…, lo asigna `nextFolio()` **al guardar**, no al abrir el formulario), `jefe_status` (`Pendiente|Autorizado|Rechazado`), `finanzas_status` (`Pendiente|Autorizado|Rechazado|N/A`), `estatus` (`Abierto|Cerrado|Rechazado`), `monto_total`, `empresa` (nombre de sociedad), `created_at` ISO.
- Destinos (`ckl_destinos`, ligados por `solicitud_id`): `estado`, fechas, `hoteles[]` (estancias con `monto` = **tarifa por noche**, `manual`, `hotel_id`), `foraneo[]`, `local[]`, `otros[]`.
- `ComprobanteGasto`: un renglón por concepto de cada solicitud (`monto_solicitado`, `monto_comprobado`, `status_renglon`).
- `Factura` (tipo local en `comprobacion.tsx`): archivo cargado, ligado a un `concepto_id` y `monto_aplicado` (permite revertir exacto al eliminar).

## 4. Roles, permisos y usuarios demo

Seis roles base (más los que el admin cree en Configuración; `Role.nombre` es `string`). Permisos como mapa plano `permisos: Record<string, boolean>`; usa `hasPerm("clave")` o `role.permisos.clave`, **no inventes otro esquema de autorización**.

| Rol | Rasgos clave |
|---|---|
| `usuario` | Solicita y comprueba lo propio |
| `jefe_inmediato` | Autoriza paso “jefe” (`autorizar_lte5000`), ve a su equipo (`jefe_id`), rechaza, ve reportes |
| `gestor_vuelos` | `ver_todo`; en Comprobación **solo ve/comprueba el concepto “Avión”**; sube comprobantes de viaje |
| `finanzas` | Autoriza montos > umbral (`autorizar_gt5000`), `ver_todo`, reportes y exportación |
| `compras_corporativas` | Mismos permisos que finanzas |
| `administrador` | Todo; **no solicita ni comprueba** sus propios viáticos (oculto en menú); puede revertir autorizaciones |

Reglas de UI ya decididas:
- **Usuarios** solo visible con `gestionar_usuarios` (admin). Permisos → `configurar_permisos`; Configuración → `configurar_montos`.
- Alcance de datos (`filterSolicitudesByOwnership`): `ver_todo` ve todo; `ver_equipo` ve a los usuarios con `jefe_id === user.id` **más sus propios folios**; el resto, solo lo propio.
- Ventana de visibilidad (`filterSolicitudesByDateCutoff`): admin/finanzas/compras/jefe ven **4 meses** atrás; los demás **2 meses**.
- **Estatus aplica ese alcance** (y el contador del menú lateral también): el `usuario` ve solo sus folios; el `jefe_inmediato` ve los de quienes lo tienen como jefe **y los suyos** (los suyos los autoriza su propio jefe, no él); `ver_todo` (admin, finanzas, compras, gestor) ve todo. Orden: más reciente primero (`created_at` desc, empate por folio desc). Filtros: Buscar, **Usuario** (solo aparece si el alcance incluye a más de una persona; lista a quienes tienen folios visibles) y Estatus.
- **Sesión única por usuario**: iniciar sesión en otra pestaña/dispositivo cierra la anterior (token en `ckl_session`).
- **Recarga (F5) / URL directa**: la sesión se lee en un `useEffect` (no en el inicializador de `useState`: leerla síncronamente rompe la hidratación SSR). `AuthProvider` expone `cargando` (true hasta leerla) y `PortalLayout` no redirige a `/login` mientras `cargando`. No cambies esto a inicialización lazy.

Usuarios demo (todos `@cklass.com`; contraseña visible en la pantalla de login):

| Correo | Rol | Sociedad | Contraseña |
|---|---|---|---|
| admin@ | administrador | WATA GROUP | Admin123! |
| jefe@ | jefe_inmediato | INTERMEDIARIA INTERMEX | Jefe123! |
| usuario@ | usuario (María Torres) | WATA GROUP | User123! |
| finanzas@ | finanzas | WATA GROUP | Fin123! |
| gestor@ | gestor_vuelos | INTERMEDIARIA INTERMEX | Gest123! |
| compras@ | compras_corporativas | WATA GROUP | Compras123! |
| usuario2@ | usuario (Carlos Mendoza) | INTERMEDIARIA INTERMEX | User223! |
| usuario3@ | usuario (Sofía Ramírez) | TRANSPORTES DE PERSONAL Y MERCANCIA | User323! |

El login también acepta el **RFC** del usuario. Jefe de usuario/usuario2/usuario3 = `jefe@` (u2), salvo que se cambie.

Sociedades: WATA GROUP, INTERMEDIARIA INTERMEX, TRANSPORTES DE PERSONAL Y MERCANCIA (cada una con RFC, régimen, CP, UsoCFDI —por defecto con prefijo `G03`— y `sociedad_sap`).

## 5. Reglas de negocio (ya implementadas; no re-preguntar)

### Solicitar viáticos
- Una solicitud tiene origen, tipo de viaje (Comercial, Auditoría, Visita a tiendas, Capacitación, Expos, Visita a proveedores, Otros), motivo, nº de personas (un input de nombre por viajero) y **uno o más destinos** (estados: Jalisco, CDMX, Guanajuato, Nuevo León, Querétaro, Colima, Zacatecas).
- **Total** = comida + hotel + transporte foráneo + local + otros.
  - Comida = `días totales × monto_comida_diario × personas` (config, default $450).
  - Hotel = tarifa por noche × noches de cada estancia. Noches = días del rango − 1. Tarifa viene del catálogo de hoteles o es **manual por noche**.
  - Foráneo: Avión, Autobús (antes “Camión”), Tren, Otro. Local: Uber, Taxi, Metro, Combi, Otro.
- **Pago directo por la empresa**: Hotel y Avión se pagan con la tarjeta corporativa y **no se depositan** al viajero. La barra de totales muestra “Pago directo empresa” (Hotel + todos los renglones de transporte foráneo tipo Avión) en verde forest (`#228B22`) antes de “Total a depositar” = total − pago directo. **Solo es de presentación**: `Solicitud.monto_total`, el umbral de Finanzas y los renglones de comprobación siguen usando el total completo (Hotel y Avión se siguen comprobando).
- **Bloqueo de solicitudes nuevas**: si el usuario tiene **2 o más** folios propios `Cerrado` (autorizados) sin comprobar por completo (`foliosSinComprobar` / `bloqueoNuevaSolicitud` en `store.ts`, tope `MAX_FOLIOS_SIN_COMPROBAR = 2`), “Nueva solicitud” muestra un diálogo con los folios pendientes y no navega. También se valida al entrar a `/solicitar` (menú lateral o URL; redirige a Comprobación) y al guardar. La edición de una solicitud existente (`editId`) está exenta. Al comprobar por completo uno de los folios (quedan <2) vuelve a permitirse. Los usuarios demo `usuario@` (#0040, #0045, #0060) quedan bloqueados de inicio.
- Validaciones (todas con `showErrorDialog`): motivo obligatorio; fechas de cada destino obligatorias, no anteriores a hoy, fin ≥ inicio, sin empalme con el destino previo; si el destino tiene ≥1 noche **debe haber hotel** y las estancias deben cubrir **exactamente** el rango del destino sin huecos ni empalmes, cada fila con hotel seleccionado.
- Edición: solo el dueño, solo si está `Abierto` y **sin autorizaciones/rechazos** registrados.
- Al guardar se generan renglones de comprobación: `Hotel`, **uno por cada tipo de transporte realmente usado** (Avión, Autobús, Uber…; “Otro” se distingue como `Otro (foráneo)` / `Otro (transporte local)`), `Comida`, `Otros`. Los montos de transporte iguales se suman por tipo (evitar filas duplicadas).
- Selector de fechas propio `dd/mm/yyyy` que se cierra al elegir; los días del viaje se muestran como día+número.

### Autorización (Estatus)
- Flujo: solicitud nace `Abierto` con `jefe_status: Pendiente`. Si `monto_total > umbral_finanzas` (default **$5,000**) → `finanzas_status: Pendiente`, si no `N/A`.
- **Nadie autoriza ni rechaza su propia solicitud** (`canAuth` excluye `s.user_id === user.id`): el jefe ve sus folios pero los autoriza su propio jefe (admin).
- Paso **jefe**: lo da quien tenga `autorizar_lte5000` y `jefe_status === Pendiente`, **sin importar el monto** (el umbral solo decide si hace falta además Finanzas; antes de corregirlo había un deadlock).
- Paso **finanzas**: `autorizar_gt5000`, monto > umbral, jefe ya autorizó, finanzas pendiente.
- La solicitud pasa a `Cerrado` cuando queda autorizada por todos los pasos requeridos. “Cerrado” significa **autorizada y lista para comprobar** (no “terminada”).
- **Etiqueta visible vs. valor guardado**: `Solicitud.estatus` en localStorage sigue siendo `Abierto|Cerrado|Rechazado` (retrocompatibilidad); la UI muestra `Pendiente` (Abierto), `Rechazado`, `Autorizado` (Cerrado sin comprobar por completo, badge azul) o `Comprobado` (Cerrado y comprobado, verde). Se deriva con `estatusVisible()` + `avanceComprobacion()` de `store.ts` y el componente `StatusBadge` (`comprobado` prop). El filtro de Estatus y el Excel de Reportes usan las etiquetas visibles. **Nunca escribas la etiqueta visible en localStorage.**
- El modal de detalle trae el botón **Comprobar gastos** (folio Cerrado, rol con `comprobar`, no admin) que navega a `/comprobacion?solicitudId=<id>`.
- Rechazo: exige nota; marca el paso correspondiente y `estatus: Rechazado`.
- Admin puede **revertir** autorizaciones (borra `ckl_autorizaciones` de ese folio y regresa a Abierto/Pendiente).
- Eliminar solo si no tiene autorizaciones. El modal de detalle muestra el desglose completo (hoteles, transportes, otros) para quien autoriza.

### Comprobación
- Solo aparecen solicitudes `Cerrado` **dentro del alcance del rol** (`filterSolicitudesByOwnership`: el rol `usuario` ve solo las suyas; un folio ajeno en la URL no se muestra). Selector = panel maestro-detalle con buscador y tarjetas con barra de avance y marca `[Pendiente]`/`[Comprobado]`; en móvil se colapsa con “Cambiar folio”. La ruta acepta `?solicitudId=` y sincroniza la URL al elegir. Cada renglón (concepto) tiene sus propios botones de adjuntar XML/PDF; el archivo se aplica **explícitamente a ese concepto**, hasta `monto_solicitado − monto_comprobado`.
- XML: debe contener `Emisor`; el `Rfc` del `Receptor` debe coincidir con el RFC de la **sociedad de la solicitud** (no el RFC personal del empleado). Archivos con el mismo nombre en la misma solicitud se rechazan como duplicados. PDF/JPG/PNG se aceptan sin validar contenido.
- Eliminar una factura revierte exactamente `monto_aplicado`.
- “Comprobado” = total comprobado === total solicitado (>0). Mismo criterio en Comprobación, Estatus y Dashboard.
- **Comprobación atrasada**: solicitud `Cerrado`, no comprobada por completo y con más de `dias_comprobacion_atrasada` (default 7) días desde `created_at`. El Dashboard cuenta con el alcance del rol del usuario y enlaza a Estatus con filtro `?atrasados`; la lista debe coincidir con el número (ya hubo un bug por eso).
- Secciones adicionales: No deducibles y Depósito sobrante (reintegro con comprobante bancario obligatorio). El gestor de vuelos no las ve.

### Configuración (admin)
`monto_comida_diario`, `umbral_finanzas`, `dia_deposito`, `email_compras`, `dias_comprobacion_atrasada` (7), `dias_autorizacion_pendiente` (3), `dias_recordatorio_viaje` (2), notificaciones por email/plataforma, SMTP (servidor/puerto/usuario/password/cifrado), revisión automática. CRUD de sociedades, hoteles, orígenes y roles (se pueden crear roles y borrar los que no se usan). **Las automatizaciones/SMTP son solo configuración guardada: no envían nada realmente.**

### Menú de usuario y cambio de contraseña
El encabezado muestra avatar + nombre + rol (`UserMenu`); al hacer clic: Cerrar sesión y Cambiar contraseña (el botón suelto de “Cerrar sesión” ya no existe). “Cambiar contraseña” pide actual, nueva y confirmación; reglas: ≥ 12 caracteres, no común/comprometida (lista corta, parte del correo, secuencias o caracteres repetidos), coincidir con la confirmación y distinta de la actual. `cambiarContrasena()` actualiza `ckl_users` y la copia en `ckl_user`. Las contraseñas demo de la sección 4 no cumplen los 12 caracteres: la regla solo aplica a las nuevas.

### Dashboard
El banner de comprobaciones atrasadas abre con saludo por hora (“Buenos días / Buenas tardes / Buenas noches {nombre}, tienes N comprobaciones atrasadas…”). Solo aparece si hay atrasadas.

### Pre-Registro y contraseñas
Desde el login, un empleado envía un Pre-Registro (`ckl_prealtas`) que el admin procesa en Usuarios. (Se llamaba “Pre-Alta”; la etiqueta correcta de UI es **Pre-Registro**.) Recuperación: código de 6 dígitos válido 10 min, mostrado en pantalla.

## 6. Convenciones de trabajo

- Prettier: 100 columnas, comillas dobles, comas finales, `;`. Alias `@/*` → `src/*`. Estilo del código existente: comentarios en español explicando el **porqué**.
- Errores/validaciones → `showErrorDialog`; confirmaciones de éxito → `toast.success`.
- No añadas dependencias sin avisar (`bunfig.toml` impone `minimumReleaseAge` de 24 h). Gestor de paquetes: Bun, no npm.
- No toques `routeTree.gen.ts`, `src/components/ui/*`, ni las capas de error SSR (`start.ts`, `server.ts`, `error-capture.ts`).
- Para nuevas pantallas: archivo `src/routes/_portal.<nombre>.tsx`, `createFileRoute("/_portal/<nombre>")`, título `"<Nombre> — CKL"`, agregar al arreglo `items` de `Layout.tsx` con su permiso.
- Diseño responsive: tablas con más de 6 columnas se muestran como **tarjetas apiladas por debajo de 768 px** (patrón: `<ul className="md:hidden">` con tarjetas + `<div className="hidden md:block overflow-x-auto">` con la tabla); ya aplicado en Estatus, Reportes, Usuarios y Facturas cargadas. En Estatus móvil cada tarjeta tiene botón de ojo “Ver” (el doble toque dispara zoom nativo, por eso no se usa en móvil). Verifica ancho ~400 px al tocar layouts.
- Validación: no hay tests. `tsc`/eslint (sin reglas de formato: el repo ya trae cientos de errores de Prettier) y pruebas con Playwright contra `bun run dev`. **`bun run build` falla en este entorno con “Could not resolve entry module index.html”, también en el commit original con instalación limpia** — no es atribuible a cambios de código; no lo des por validado sin confirmarlo en la máquina del usuario.
- Git: rama `main`; commits en inglés, descriptivos y en imperativo (ver `git log`). No hagas commit/push salvo que se pida.

## 7. Historial reciente (para entender el estado actual)

Últimas iteraciones: comprobación por concepto de transporte y alcance del gestor de vuelos; filas de transporte duplicadas corregidas; conteo/lista de “atrasadas” alineados; hotel manual por noche y folio diferido; detalle de autorización con desglose; Usuarios solo para admin; usuarios demo multi-sociedad; Automatizaciones (SMTP) en Configuración; sesión única por usuario; rediseño del Dashboard (gráfica mensual); fuente Jost; validación de cobertura de hoteles; diálogo bloqueante en lugar de toasts de error; etiquetas visibles Pendiente/Autorizado/Comprobado/Rechazado; vistas de tarjetas en móvil; Comprobación maestro-detalle con alcance por rol; arreglo de recarga con `cargando`; favicon vacío (evita 404); menú de usuario con cambio de contraseña; “Pago directo empresa” (Hotel + Avión) fuera del total a depositar; bloqueo de nuevas solicitudes con 2+ folios sin comprobar; saludo en el Dashboard.

## 8. Cómo pedirme cosas (preferencias para esta colaboración)

- Si una tarea es ambigua **en el dominio**, primero revisa este documento y el código (`store.ts` y la ruta relevante) antes de preguntar.
- Antes de modificar reglas de negocio de la sección 5, confirma con el usuario; son decisiones tomadas a propósito.
- Al cambiar semilla o forma de datos, indica si hay que limpiar `localStorage` para verlo.
- Reporta con honestidad qué probaste: no hay tests, así que di si solo corriste lint/build o si verificaste en el navegador.
