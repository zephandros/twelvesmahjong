# Configurar el multijugador en Cloudflare

Todo lo que hay que hacer **a mano** para que el multijugador funcione en
producción. Son cosas que no se despliegan solas: viven en el panel de
Cloudflare o en la terminal.

Sigue las secciones **en orden**. Cada `[ ]` es un paso; ninguno tarda más de
un par de minutos.

> **Nada de esto afecta al juego de un jugador.** Si algo sale mal a mitad,
> `twelvesmahjong.com` sigue funcionando como hasta ahora.

---

## 0. Antes de empezar

- [ ] Tener el dominio `twelvesmahjong.com` ya en tu cuenta de Cloudflare (lo está).
- [ ] Saber en qué **plan** estás. Con el **plan gratuito llega**: los Durable
      Objects con backend SQLite y los WebSockets hibernados están incluidos, y una
      sala dormida no consume tiempo de cómputo.
- [ ] Tener wrangler listo y la sesión iniciada:

```bash
npx wrangler login
```

Se abre el navegador y pide autorizar. Una vez hecho, no hay que repetirlo.

---

## 1. Primer despliegue de prueba (sin tocar el dominio)

La idea es probarlo todo en la URL temporal `*.workers.dev` **antes** de mover
`twelvesmahjong.com`. Si algo falla, el sitio en producción ni se entera.

- [ ] Compilar y desplegar:

```bash
npm run deploy
```

- [ ] Apuntar la URL que imprime al final. Tendrá esta pinta:

```
https://twelvesmahjong.<tu-cuenta>.workers.dev
```

- [ ] Abrirla y comprobar que **todo lo de siempre sigue igual**:
  - [ ] Carga la portada.
  - [ ] Se puede jugar una partida de un jugador entera.
  - [ ] `https://…workers.dev/una-ruta-inventada` muestra la página de error
        (y devuelve un 404 de verdad, no la portada).
  - [ ] La app se puede instalar (icono de instalar en la barra del navegador).

> **Si una URL inventada te lleva a la portada**, es el service worker de una
> visita anterior, que aún sirve la versión vieja. Recarga una vez para que se
> releve y vuelve a probar. Para comprobarlo sin depender de la caché:
>
> ```bash
> curl -I https://twelvesmahjong.iscalexsoto.workers.dev/una-ruta-inventada
> ```
>
> Debe responder `HTTP/2 404`.

Si algo de esto falla, **para aquí**: es un problema del despliegue, no de la
configuración, y el dominio todavía no se ha tocado.

> El multijugador **aún no funcionará**: le falta Turnstile, que es lo siguiente.

---

## 2. Turnstile (la prueba «soy humano»)

Es lo que impide que un bot cree salas en bucle. Es **gratis y sin límite de uso**.

### 2.1 Crear el widget

- [ ] En el panel de Cloudflare: **Turnstile** → **Add widget**.
- [ ] Rellenar así:

| Campo | Valor |
|---|---|
| Widget name | `twelvesmahjong` |
| Hostnames | `twelvesmahjong.com` · `localhost` · **tu URL `*.workers.dev`** (la del paso 1) |
| Widget Mode | **Managed** |

> **No te dejes el hostname `*.workers.dev`.** El paso 1 manda probar ahí antes de
> mover el dominio, y Turnstile rechaza cualquier hostname que no esté en esta
> lista con el error **110200** ("domain mismatch") — en consola sale como
> `TurnstileError` y en pantalla como "no se pudo cargar la comprobación", que
> parece un bloqueador pero no lo es. Puedes quitar ese hostname más adelante,
> una vez el dominio esté migrado y ya no lo uses para probar.

- [ ] Al guardar te da **dos claves**. Ojo con no confundirlas:

| Clave | Qué es | Dónde va |
|---|---|---|
| **Site Key** | Pública | En el código (paso 2.2) |
| **Secret Key** | Privada | Como secreto del Worker (paso 2.3) |

### 2.2 La Site Key (pública)

- [ ] Crear un archivo `.env` en la raíz del proyecto con la Site Key:

```
VITE_TURNSTILE_SITEKEY=0x4AAAAAAA...tu-site-key
```

Es pública y va dentro del bundle: no pasa nada porque se vea. Si no pones
ninguna, se usa la clave de pruebas de Cloudflare, que **acepta a cualquiera** —
sirve para desarrollo, no para producción.

### 2.3 La Secret Key (privada)

- [ ] Cargarla como secreto del Worker:

```bash
npx wrangler secret put TURNSTILE_SECRET
```

Pega la Secret Key cuando la pida. **Nunca** la escribas en el repositorio ni en
`wrangler.jsonc`.

- [ ] Volver a desplegar para que el bundle recoja la Site Key:

```bash
npm run deploy
```

- [ ] En la URL `*.workers.dev`, entrar en **MULTIJUGADOR → CREAR SALA** y
      comprobar que aparece un código de 6 letras.

> **Si el multijugador da error de "no disponible"**, es que falta este secreto.
> Es a propósito: sin `TURNSTILE_SECRET` no se puede crear ninguna sala.

---

## 3. Mover el dominio de Pages al Worker

Este es el único paso con algo de riesgo, y por eso va el último de la parte
técnica. Hay una ventana de unos minutos mientras se propaga el cambio.

- [ ] **Primero** añadir el dominio al Worker: panel → **Workers & Pages** →
      `twelvesmahjong` → **Settings** → **Domains & Routes** → **Add** →
      **Custom domain** → `twelvesmahjong.com`.
- [ ] Esperar a que aparezca como *Active* (suele ser menos de un minuto).
- [ ] Abrir `https://twelvesmahjong.com` y comprobar la misma lista del paso 1.
- [ ] **Solo entonces**, quitar el dominio del proyecto de Pages antiguo:
      **Workers & Pages** → el proyecto de Pages → **Custom domains** → quitar
      `twelvesmahjong.com`.

**Si algo va mal:** vuelve a poner el dominio en Pages y quítalo del Worker. El
proyecto de Pages sigue ahí con su último despliegue hasta que tú lo borres, así
que la vuelta atrás es inmediata. No borres el proyecto de Pages hasta que
lleves unos días tranquilo.

---

## 4. Regla de límite de peticiones (WAF)

Impide que alguien martillee la creación de salas. El plan gratuito incluye
**una** regla de este tipo: esta es la que vamos a gastar.

- [ ] Panel → tu dominio → **Security** → **WAF** → pestaña
      **Rate limiting rules** → **Create rule**.
- [ ] Rellenar:

| Campo | Valor |
|---|---|
| Rule name | `crear sala` |
| Expresión (usa el editor de texto) | `http.request.uri.path eq "/api/room" and http.request.method eq "POST"` |
| Characteristics | *IP* |
| Period | 1 minuto |
| Requests | `5` |
| Action | **Block** |
| Duration | 1 minuto |

- [ ] Guardar y desplegar la regla.
- [ ] Comprobar que muerde: crear 6 salas seguidas y rápido desde la web. La
      última debería fallar. Al minuto vuelve a funcionar.

> Esta regla se evalúa **antes** de que se ejecute el Worker, así que el tráfico
> bloqueado no gasta nada de la cuota.

---

## 5. Comprobación final

Con dos navegadores (o uno normal y otro en ventana privada):

- [ ] En el primero: **MULTIJUGADOR → CREAR SALA**. Sale un código.
- [ ] En el segundo: **MULTIJUGADOR**, escribir el código, **UNIRSE**.
- [ ] Cada uno elige un personaje. El personaje que coge uno se le bloquea al otro.
- [ ] El primero pulsa **EMPEZAR**. Los dos asientos que sobran los ocupa la IA.
- [ ] Jugar unos turnos y comprobar que ambos ven lo mismo.
- [ ] Cerrar el segundo navegador a mitad de partida: pasados unos segundos la IA
      juega por él y la partida no se atasca.
- [ ] Volver a abrirlo, entrar con el mismo código: recupera su asiento y la
      partida en curso.

---

## 6. Mantenimiento

### Dónde mirar el consumo

- **Workers & Pages** → `twelvesmahjong` → **Metrics**: peticiones y errores.
- **Workers & Pages** → **Durable Objects**: salas activas y almacenamiento.
  Debería estar casi siempre a cero — las salas se borran solas a los 5 minutos
  si nadie entra, y a los 30 si se quedan quietas.
- **Turnstile** → tu widget: cuántas comprobaciones se resuelven y cuántas fallan.
  Un pico de fallos = alguien intentando entrar con un bot.

### Apagar el multijugador de urgencia

Si alguna vez hay abuso y quieres cerrar la puerta ya:

```bash
npx wrangler secret delete TURNSTILE_SECRET
```

Sin ese secreto **no se puede crear ninguna sala** (el servidor responde «no
disponible»). El juego de un jugador y la web siguen intactos. Para volver a
abrirlo, repite el paso 2.3.

### Cambiar de dominio

Si algún día cambias `twelvesmahjong.com` por otro, hay que tocarlo en cuatro
sitios del código: `index.html`, `public/robots.txt`, `public/sitemap.xml` y la
constante `ORIGIN` de `tests/seo-assets.test.ts`. Ese test falla si te dejas
alguno. Y en el panel: los hostnames del widget de Turnstile (paso 2.1).

---

## Resumen de secretos y variables

| Nombre | Qué es | Dónde se pone | ¿Público? |
|---|---|---|---|
| `VITE_TURNSTILE_SITEKEY` | Site Key de Turnstile | `.env` del proyecto | Sí, va en el bundle |
| `TURNSTILE_SECRET` | Secret Key de Turnstile | `wrangler secret put` | **No, nunca** |

### Desarrollo en local

Para `npx wrangler dev` hacen falta **las dos claves de pruebas** de Cloudflare,
y hay que usarlas juntas — mezclar una real con una de prueba hace que
`siteverify` rechace el token:

| Archivo | Contenido | Por qué |
|---|---|---|
| `.dev.vars` | `TURNSTILE_SECRET` de pruebas | Secreto del Worker en local |
| `.env.local` | `VITE_TURNSTILE_SITEKEY` de pruebas | **Vite lo prioriza sobre `.env`**, así que la sitekey real solo se usa al desplegar |

Los dos están en `.gitignore` y ninguno se despliega.

**Por qué `.env.local` es necesario:** la sitekey real solo autoriza los
hostnames de su widget, y el servidor de desarrollo sirve en `127.0.0.1`. Sin
este archivo, Turnstile responde **110200** ("domain mismatch") y en pantalla
aparece "no se pudo cargar la comprobación" — que parece un bloqueador de
anuncios pero no lo es. La sitekey de pruebas
(`1x00000000000000000000AA`) acepta cualquier hostname.
