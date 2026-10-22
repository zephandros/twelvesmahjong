# Configurar el multijugador (Firebase + Kovalt)

Todo lo que hay que hacer **a mano** para que el multijugador funcione. Son
cosas que no se despliegan solas: viven en la consola de Firebase, en el panel
de Cloudflare o en la terminal.

> **Nada de esto afecta al juego de un jugador.** Sin configurar, el botón
> MULTIJUGADOR abre la pantalla y dice "no disponible"; todo lo demás sigue
> igual y 100 % offline.

## Cómo funciona (en dos párrafos)

No hay servidor de juego. **El árbitro es el cliente de quien crea la sala**
(`src/net/host.ts`): valida cada jugada con el mismo núcleo que el modo de un
jugador y escribe el log autoritativo en **Firebase Realtime Database**; los
demás clientes lo reproducen. Si el anfitrión cierra la pestaña, la mesa se
queda esperando; al volver, reconstruye la partida del log y sigue.

**Crear una sala exige una cuenta de Kovalt en la lista blanca** (la de
`admin.kovalt.mx/usuarios`, la misma que Notes, Roller…). Unirse solo pide el
código y un nombre. Las sesiones de Firebase las emite **nuestro Worker**
(`/api/sesion` para cuentas, `/api/invitado` para invitados) como custom
tokens: la cuenta pasa por `auth-refresh` de Kovalt API —ahí está la lista
blanca— y el invitado recibe un token que **solo vale para esa sala**. Las
Security Rules (`firebase/database.rules.json`) exigen una de esas sesiones
para leer o escribir cualquier cosa.

---

## 1. Proyecto de Firebase

- [ ] [Consola de Firebase](https://console.firebase.google.com) → **Añadir
      proyecto** (p. ej. `twelves-mahjong`). Google Analytics no hace falta.
- [ ] **Build → Realtime Database → Crear base de datos**. Región la que sea;
      empieza en **modo bloqueado** (las reglas de abajo lo abren lo justo).
- [ ] **Build → Authentication → Comenzar**. En *Método de acceso* **no
      actives ningún proveedor** (ni Correo/Contraseña ni Anónimo): las
      sesiones son custom tokens y no dependen de ninguno. Si alguno estuviera
      activo, desactívalo.
- [ ] **Configuración del proyecto → General → Tus apps → Añadir app → Web**
      (sin Hosting). Copia la configuración del SDK: `apiKey`, `authDomain`,
      `databaseURL`, `projectId`, `appId`.
- [ ] Crear `.env` en la raíz del repo (plantilla en `.env.example`) con esos
      valores como `VITE_FIREBASE_*`. Son **públicos** (van en el bundle).
- [ ] **Configuración del proyecto → Cuentas de servicio → Generar nueva clave
      privada**. Se descarga un JSON. **Nunca al repo.**

### Publicar las reglas

- [ ] **Realtime Database → Reglas** → pegar el contenido de
      `firebase/database.rules.json` → **Publicar**.

Hay que repetirlo **cada vez que cambie ese archivo** (el repo no las despliega
solo). Alternativa con CLI: `npx firebase deploy --only database --project
<id>` tras `npx firebase login`.

---

## 2. El Worker (Cloudflare)

- [ ] En `wrangler.jsonc`, rellenar `vars.FIREBASE_PROJECT_ID` con el id del
      proyecto (el mismo de `VITE_FIREBASE_PROJECT_ID`) y
      `vars.FIREBASE_DATABASE_URL` con la URL de la Realtime Database (la misma
      de `VITE_FIREBASE_DATABASE_URL`; la usa la limpieza de salas, ver §5).
- [ ] Cargar la cuenta de servicio como secreto (pega el JSON completo, en una
      línea, cuando lo pida):

```bash
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
```

- [ ] Desplegar:

```bash
npm run deploy
```

El primer despliegue tras la migración borra el Durable Object `GameRoom` de la
versión anterior (migración `v2` de `wrangler.jsonc`): es lo esperado.

> **Sin el secreto el multijugador está apagado**: el Worker responde 503, la
> UI dice "no disponible" y el cron de limpieza no hace nada. Es también el
> **interruptor de urgencia**: `npx wrangler secret delete FIREBASE_SERVICE_ACCOUNT`.

El despliegue también da de alta el **Cron Trigger** de `triggers.crons`
(limpieza diaria de salas, §5): se ve en *Workers & Pages → twelvesmahjong →
Settings → Triggers → Cron Triggers*. No hay que crearlo a mano.

---

## 3. Kovalt API (lista blanca)

No hay nada que cambiar en el servidor de Kovalt: el Worker usa
`POST /api/collections/auth_users/auth-refresh`, que ya aplica la lista blanca
en cada llamada. Solo hay que asegurarse de que:

- [ ] Los correos de quienes vayan a **crear** salas están en la lista
      (`admin.kovalt.mx/usuarios`). Los invitados no necesitan cuenta.
- [ ] Google: la pantalla de inicio de sesión del juego usa el flujo
      *all-in-one* de PocketBase (`authWithOAuth2({ provider: 'google' })`), cuyo
      redirect `https://api.kovalt.mx/api/oauth2-redirect` ya está registrado.
      No hay que dar de alta ningún origen nuevo.

El juego **no** usa la cookie compartida de la suite (`kv_suite_auth`): vive
en `twelvesmahjong.com`, que no es un subdominio de `kovalt.mx`, así que tiene
su propio inicio de sesión (código al correo o Google) y guarda el token en
`localStorage`. Si algún día se sirviera desde `*.kovalt.mx`, se podría copiar
`suiteAuth.ts` de Roller y entrar con la sesión común.

---

## 4. Comprobación final

Con dos navegadores (o uno normal y otro en ventana privada):

- [ ] En el primero: **MULTIJUGADOR → INICIAR SESIÓN** (correo de la lista →
      código de 8 dígitos, o Google). Vuelve a la pantalla con "Sesión: …".
      **CREAR SALA** → sale un código de 6 letras.
- [ ] En el segundo: **MULTIJUGADOR**, nombre, código, **UNIRSE**.
- [ ] Cada uno elige un personaje. El que coge uno se le bloquea al otro.
- [ ] El primero pulsa **EMPEZAR**. Los dos asientos que sobran los ocupa la IA.
- [ ] Jugar unos turnos y comprobar que ambos ven lo mismo.
- [ ] Cerrar el segundo navegador a mitad de partida: pasados unos segundos la
      IA juega por él y la partida no se atasca. Volver a abrirlo y entrar con
      el mismo código: recupera su asiento y la partida en curso.
- [ ] Dejar el segundo abierto pero sin tocar nada tres plazos seguidos: la IA
      pasa a llevar su asiento y en su pantalla sale "La IA juega por ti. Toca
      para retomar el control". Un toque (o tecla) y el árbitro le devuelve el
      mando en su siguiente turno, sin salir de la sala.
- [ ] Solo el anfitrión con 3 bots: en su turno **no hay cuenta atrás** y la
      mesa le espera indefinidamente (los plazos solo protegen a otros humanos).
- [ ] Con dos humanos, uno deja de tocar tres plazos: le sale "La IA juega por
      ti", la IA decide por él **solo cuando le toca** (el otro sigue marcando el
      ritmo), y un toque le devuelve el mando en su siguiente decisión.
- [ ] Abrir la sala del anfitrión en una **segunda pestaña** del mismo navegador
      (o la PWA): solo la última arbitra; la partida sigue consistente en los
      tres clientes y cerrar la pestaña vieja no cierra la sala.
- [ ] Cerrar el **primero** (el anfitrión): el otro ve "El anfitrión se ha
      desconectado. Esperando…" y nada se mueve. Reabrirlo, **MULTIJUGADOR →
      UNIRSE** con el código de su propia sala: como su sesión sigue en el
      navegador y la sala es suya, vuelve **como árbitro** (no como invitado),
      reconstruye la partida del log y la mesa sigue.

---

## 5. Mantenimiento

### Dónde mirar

- **Firebase → Realtime Database → Datos**: `rooms/{código}`. Una sala
  terminada la borra el anfitrión al salir; si una pestaña murió sin más, queda
  ahí hasta que pase el **cron de limpieza** (abajo). Desde la consola se borra
  lo que sea.
- **Workers & Pages → `twelvesmahjong` → Logs** (observabilidad activada): cada
  pasada del cron escribe una línea `cleanup(17 4 * * *): N salas, M miradas,
  K borradas (…)`, o `cleanup(...) falló` con el error.
- **Firebase → Realtime Database → Uso**: conexiones simultáneas y descargas.
  El plan gratuito (Spark) da 100 conexiones y 10 GB/mes; una partida mueve
  unos pocos cientos de KB.
- **Workers & Pages → `twelvesmahjong` → Metrics**: peticiones a `/api/*`.

### Limpieza de salas (Cron Trigger)

El Worker corre **una vez al día** (`triggers.crons: ["17 4 * * *"]`, hora
UTC, en `wrangler.jsonc`) y borra de la RTDB las salas caducadas
(`worker/cleanup.ts`):

- creadas hace **más de 24 h** (`meta/createdAt`, en la fase que estén);
- **terminadas** hace más de **1 h** (`meta/phase = 'done'` y `meta/endedAt`,
  que el árbitro escribe al acabar la partida);
- sin `meta` o sin `createdAt` numérico (basura).

Usa la cuenta de servicio (`FIREBASE_SERVICE_ACCOUNT`) para pedir a Google un
access token OAuth2 con el scope `firebase.database` y hablar con la REST API
de la base (`FIREBASE_DATABASE_URL`): un `GET rooms.json?shallow=true` para
los códigos, un `GET rooms/{code}/meta.json` por sala (como mucho 40 por
pasada, el tope de subpeticiones del plan gratuito; el resto cae en la
siguiente) y **un solo `PATCH rooms.json`** con `null` en cada caducada. La
cuenta de servicio no pasa por las Security Rules, así que no hace falta
tocarlas. Si la red falla, la pasada lanza, queda en los logs y se reintenta
al día siguiente.

**Lanzarlo a mano en local** (con `.dev.vars` que tenga
`FIREBASE_SERVICE_ACCOUNT`; actúa sobre la base REAL del `wrangler.jsonc`):

```bash
npx wrangler dev --test-scheduled
```

y, en otra terminal:

```bash
curl "http://localhost:8787/__scheduled?cron=17+4+*+*+*"
```

La respuesta es `Ran scheduled event`; el resultado real sale en la consola
de `wrangler dev`. En producción no hay disparo manual: cambiar el horario
es editar `triggers.crons` y volver a desplegar (y quitar la clave `triggers`
elimina el cron en el siguiente despliegue).

### Límites conocidos

- **El anfitrión tiene que estar.** Sin su pestaña abierta nadie reparte: la
  mesa se para y los demás ven el aviso. Es la contrapartida de no tener
  servidor de juego.
- **Pestaña en segundo plano**: los navegadores frenan los timers de las
  pestañas ocultas (hasta una vez por minuto tras cinco minutos). Si el
  anfitrión se va a otra pestaña un buen rato, los plazos de los demás se
  resuelven con retraso. Mantener el juego visible lo evita.
- **La semilla de la partida viaja a todos los clientes** (igual que antes con
  el Durable Object): quien abra la consola del navegador puede deducir el
  muro. Es un juego entre amigos; no hay anti-trampas más allá de la
  atribución de jugadas (`authorize`).
- **Sesión de invitado**: dura 24 h. Si caduca a media partida, el cliente
  pide volver a entrar con el código (recupera el asiento si el uid de
  Firebase sigue en el navegador).

### Desarrollo en local

`npm run dev` usa el proyecto real de Firebase del `.env` (o `.env.local`,
que Vite prioriza). Para que `/api/sesion` y `/api/invitado` respondan en
local hay que levantar el Worker aparte:

```bash
npm run dev:worker
```

con un `.dev.vars` (plantilla en `.dev.vars.example`) que tenga
`FIREBASE_SERVICE_ACCOUNT`. Vite no proxya `/api` al Worker: lo más cómodo es
probar el multijugador **desplegado** (`npm run deploy`), o abrir la build
servida por `wrangler dev` (`npm run build && npm run dev:worker`, en
`http://localhost:8787`).

Las reglas se pueden probar con los emuladores de Firebase igual que en
Roller (`firebase/tests` de ese repo es la referencia); este repo no los trae.

## Resumen de secretos y variables

| Nombre | Qué es | Dónde se pone | ¿Público? |
|---|---|---|---|
| `VITE_FIREBASE_*` | Configuración web del proyecto de Firebase | `.env` del proyecto | Sí, va en el bundle |
| `VITE_KOVALT_API_URL` | URL de Kovalt API (por defecto `https://api.kovalt.mx`) | `.env` (opcional) | Sí |
| `FIREBASE_PROJECT_ID` | Id del proyecto | `wrangler.jsonc` (`vars`) | Sí |
| `FIREBASE_DATABASE_URL` | URL de la Realtime Database (para la limpieza de salas) | `wrangler.jsonc` (`vars`) | Sí |
| `PB_URL` | URL de Kovalt API para el Worker | `wrangler.jsonc` (`vars`) | Sí |
| `FIREBASE_SERVICE_ACCOUNT` | JSON de la cuenta de servicio | `wrangler secret put` / `.dev.vars` | **No, nunca** |
