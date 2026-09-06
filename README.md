# Naiskos Angular

Interfaz táctil del marco digital Naiskos, construida con Angular 22 para
Chromium en modo kiosco. Presenta fotografías y videos, funciona con el último
estado disponible sin Internet y se comunica exclusivamente con
`naiskos-agent` por el mismo origen.

La aplicación no contiene tokens centrales, no descarga directamente desde
Telegram y no usa el almacenamiento del navegador como repositorio de medios.

## Funciones actuales

- Presentación automática de fotografías y reproducción completa de videos.
- Crossfade, orden configurable y encuadre global o individual
  `contain`/`cover`.
- Navegación por tap/clic, doble tap, deslizamiento horizontal y menú mediante
  deslizamiento descendente.
- Zoom fotográfico volátil de 1× a 4× mediante pellizco y desplazamiento de la
  imagen ampliada.
- Controles permanentes de reproducción, posición, volumen y mute para videos.
- Reloj, fecha y clima opcionales.
- Galería táctil con arrastre, miniaturas dedicadas con fallback, pintura
  diferida fuera de pantalla, métricas de almacenamiento, rotación y
  eliminación.
- Configuración local, estado de alta, QR de vinculación, campana con contador,
  centro de notificaciones, salida del kiosco y apagado del equipo.

Las preferencias se guardan mediante el agente. Cambiar el manifiesto
multimedia no debe sobrescribir duración, transición, encuadre, orden, volumen,
mute ni visibilidad de metadatos.

## Requisitos

- Node.js 24.
- npm 11.
- Para una experiencia completa, `naiskos-agent` en
  `http://127.0.0.1:8080`.

## Instalación y comprobación

```bash
npm ci
npm test -- --watch=false
npm run build
```

El artefacto de producción queda en `dist/naiskos-ng/browser/` y utiliza
nombres con hash. Las fuentes Manrope necesarias para el reloj y el clima se
incluyen localmente junto con su licencia; el visor no depende de una CDN.

Comandos:

| Comando | Función |
| --- | --- |
| `npm start` | Servidor Angular con proxy local hacia el agente |
| `npm run build` | Compilado optimizado de producción |
| `npm run watch` | Compilado de desarrollo en observación |
| `npm test -- --watch=false` | Pruebas unitarias en una sola ejecución |

## Desarrollo con el agente

En una primera terminal:

```bash
cd ../naiskos-agent
npm ci
npm run build
NAISKOS_DATA_ROOT=./data npm start
```

En otra:

```bash
cd ../naiskos-ng
npm ci
npm start
```

Abre la URL que muestre Angular. `proxy.conf.json` redirige `/api` y `/media`
al agente local; no debe contener credenciales ni direcciones de producción.

Para probar exactamente el mismo origen que se utiliza en el marco:

```bash
npm run build
cd ../naiskos-agent
npm run build
NAISKOS_DATA_ROOT=./data \
NAISKOS_WEB_ROOT=../naiskos-ng/dist/naiskos-ng/browser \
npm start
```

Después abre `http://127.0.0.1:8080/`.

## Arquitectura de la interfaz

- `src/app/core/models.ts`: contrato de manifiesto, ajustes, medios, clima y
  aprovisionamiento.
- `src/app/core/agent-api.ts`: único acceso HTTP; todas las rutas son relativas.
- `pointer-gestures.ts`: clasificación de tap, swipe y gesto descendente.
- `photo-zoom.ts`: matemáticas puras del pellizco y desplazamiento acotado.
- `slideshow-policy.ts`: tiempos y avance de fotografías/videos.
- `media-readiness.ts`: precarga y disponibilidad antes del crossfade.
- `app.ts`, `app.html` y `app.scss`: estado y presentación del kiosco.

Las pruebas cubren navegación, temporizadores, cambios de manifiesto, video,
gestos, zoom y acciones administrativas.

## Contrato con el agente

`AgentApi` usa rutas relativas bajo `/api/v1` para:

- manifiesto, clima y aprovisionamiento;
- consulta, lectura y ocultación de notificaciones;
- actualización o restauración de ajustes;
- encuadre, rotación y eliminación de medios;
- salida de Naiskos y apagado del equipo.

Los archivos se cargan desde `/media`. En producción, Angular y estos endpoints
deben ser servidos por el mismo agente en loopback; no se requiere CORS.

## Despliegue en el marco

1. Ejecuta pruebas y build con la versión de Node indicada.
2. Empaqueta `dist/naiskos-ng/browser` junto con el release compatible del
   agente.
3. Activa ambos de forma atómica; no publiques únicamente el frontend si el
   contrato local cambió.
4. Reinicia el agente después de cambiar el enlace del directorio web.
5. Comprueba en la pantalla real tap, swipe, pellizco, video, audio, modo
   offline y recuperación tras reinicio.

En Wayland/labwc el touchscreen debe usar `mouseEmulation="no"`. Chromium debe
recibir contactos con `pointerType="touch"` e identificadores distintos; si el
compositor los convierte en un único mouse, ninguna biblioteca JavaScript
puede reconstruir correctamente el pellizco.

## Seguridad y privacidad

- No añadas `.env`, tokens, claves, manifiestos reales ni medios a este repo.
- No conviertas URLs del servicio central en llamadas directas del navegador.
- El texto de remitente es una preferencia global y no debe revelar más datos
  que los ya incluidos deliberadamente en el manifiesto local.
- La salida y el apagado requieren que el agente valide el origen local y que
  el sistema limite la autorización mediante PolicyKit.

## Licencia

Naiskos Angular se distribuye bajo la
[GNU Affero General Public License v3.0](LICENSE), exclusivamente en su versión
3 (`AGPL-3.0-only`).
