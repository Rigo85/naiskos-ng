# Collage básico

En **Configuración → Presentación** se puede elegir:

- **Individual** (predeterminado): comportamiento previo.
- **Columnas verticales**: dos o tres medios verticales, sin filas. Los medios
  horizontales y cuadrados se muestran individualmente.
- **Mosaico adaptable**: plantillas de dos o tres columnas, algunas divididas
  en dos filas; hasta cuatro medios en esta primera versión. Las proporciones
  orientan la elección, pero no prohíben colocar horizontales en columnas altas.
  Además, aproximadamente el 25% de las decisiones de escena elige una foto o
  video individual. No es una cuota exacta: las escenas individuales necesarias
  por falta de acompañantes o dimensiones pueden aumentar esa proporción.

La biblioteca se agrupa después de aplicar el orden configurado. El siguiente
material pendiente inicia cada escena y se buscan acompañantes entre los seis
primeros pendientes. Los no elegidos conservan su prioridad. Cada elemento se
usa una vez por vuelta normal. Desde la versión de mosaicos dinámicos la siguiente
mezcla se calcula anticipadamente y se adopta al completar el recorrido, no por
un temporizador ni por cada transición. Ambos modos renuevan sus acompañantes;
sólo el adaptable sortea además escenas individuales.

En orden **aleatorio** se baraja de nuevo al cambiar de vuelta. En **más/menos
reciente** se conserva la prioridad del primer pendiente y se varían acompañantes
dentro de la misma ventana de seis. Se comparan la selección original y una
alternativa sembrada, aceptando hasta 0,025 adicionales del coste geométrico del
mejor candidato; no se busca una combinación arbitraria en toda la biblioteca.
Una biblioteca pequeña o poco compatible puede repetir distribuciones.

## Distribuciones y bandas

El catálogo incluye columnas completas iguales o de ancho diferente, una columna
completa junto a otra dividida en dos filas (a cualquiera de los lados), cuadrícula
2×2 y dos columnas completas junto a una dividida. Las posiciones se comparan por
aprovechamiento geométrico, penalizando también la peor celda. La prioridad del
primer material no obliga a que ocupe la celda izquierda. No se generan divisiones
recursivas ni se fuerzan cuatro materiales si dos o tres encajan mejor.

**Fondo de bandas del collage** permite `Tonos del material` (valor inicial) o `Negro`.
El servidor entrega dos colores suaves de la foto completa o del póster de video.
El visor sólo dibuja un gradiente estático, sin análisis, desenfoque ni dependencias
nuevas. La presentación individual conserva el fondo negro. Los colores ausentes
o inválidos también se sustituyen por negro, sin rechazar el material.
**Ambos modos collage comparten los fondos en tonos y los bordes finos entre
celdas**. Columnas verticales conserva su agrupación sin filas; sólo el adaptable
añade el sorteo de escenas individuales. Las escenas de una sola celda no llevan
divisores y mantienen las mismas reglas de duración y reproducción.

Dentro de una vuelta, añadir colores, miniaturas u otros metadatos no vuelve a
sortear la biblioteca. Una publicación
exclusivamente decorativa conserva la escena, preparación, temporizadores y
reproducción actuales; sus colores entran en una transición natural. Cambiar el
fondo o el volumen no vuelve a ejecutar la búsqueda de distribuciones.

### Ajuste de encuadre con recorte limitado

En ambos modos, una vez elegidos los materiales y la distribución, se ajustan
los anchos hasta ±8 puntos porcentuales (columnas del 22–78 % de la pantalla)
y las filas divididas al 35–65 %. No cambia la selección, el orden ni el número
de columnas/filas; no hay subdivisiones recursivas.

Una **foto con `inherit`** puede rellenar su celda con un recorte centrado de
hasta el 8 % del área, incluso si el marco tiene `contain` como valor global.
Si requiere más, conserva bandas. **`contain` explícito en la foto siempre
impide el recorte**; `cover` explícito o heredado conserva su comportamiento.
Los videos no reciben recorte automático. Fotos y videos individuales tampoco
cambian. No se modifica ninguna preferencia persistida.

Se evalúan geometría y recorte juntos: se descartan propuestas que aumenten
las bandas totales. Dentro de un punto porcentual de pantalla del mínimo de
bandas, se prefiere mejorar la peor celda; después, menor recorte medio,
menor recorte máximo y menor movimiento de divisiones. Sin reducción real de
bandas se conserva la distribución inicial. Son constantes internas, no nuevas
opciones. No hay reconocimiento de sujetos: el área recortada no mide la
importancia de lo que aparece junto a los bordes.

El ajuste fino se hace en un Web Worker para una ventana de hasta cinco escenas,
no para toda la biblioteca. Dos pasadas acotadas retienen un único resultado; una
caché de hasta 64 geometrías reutiliza proporciones, sin guardar imágenes ni
referencias a medios. Una escena ya ajustada no vuelve a ajustarse al pasar
por reposo o reintentos. Si falla un material, se recompone el grupo restante
desde una plantilla base, aplicando los mismos límites. Los cambios de encuadre
explícito se respetan inmediatamente; la geometría se recalcula al preparar
la siguiente escena, sin interrumpir el video visible.

Mientras se selecciona un modo collage se ocultan leyendas y remitentes, sin
modificar sus preferencias globales. Reloj y clima siguen en su lugar.

Los toques izquierda/derecha cambian la escena completa. El deslizamiento de
arriba hacia abajo abre el menú, igual que en modo individual; no hay un botón
adicional. No hay navegación por arrastre horizontal ni zoom en collage. La
galería mantiene sus controles y gestos habituales.

## Reproducción y preparación

Las fotos comparten la duración configurada. Puede haber un único video y sus
controles siguen visibles. Su final, pausa con temporizador, reproducción y
recuperación gobiernan el avance de toda la escena. Reposo cancela la preparación
pendiente y suspende el ciclo visible usando el mecanismo existente.

Sólo se renderizan la escena visible y la candidata. Una reserva auxiliar fuera
del DOM conserva hasta cuatro fotos/pósteres decodificados, con un presupuesto
estimado de 32 MiB RGBA; no abre reproductores de video. Las dimensiones reales
se comprueban después de decodificar; esto limita la reserva, no toda la memoria
de Chromium ni una asignación transitoria de su decodificador. Todos los archivos de la candidata deben
cargar antes del crossfade. Un archivo fallido se identifica, se notifica al
agente y se retira temporalmente; se intenta preparar el resto de esa escena.
Si no queda ninguno, continúa la búsqueda existente, con sus límites y reintentos.
La recomposición de supervivientes usa el mismo selector de disposición y modo,
sin añadir acompañantes ni eliminar supervivientes sanos. Si falla el video y
quedan fotos, éstas utilizan el temporizador fotográfico.

## Contrato y compatibilidad

- `settings.collageMode`: `off`, `columns` o `adaptive`; ausencia equivale a `off`.
- `settings.collageBackground`: `black` o `material`; ausencia equivale a `material`.
  Se conserva una elección explícita de `black`. Sin colores válidos se muestra negro.
- `media[].bandColors`: pareja opcional de colores hexadecimales `#rrggbb`, o null.
  No interviene en la identidad/hash del archivo ni en el orden o agrupación.
- `media[].width` y `height`: dimensiones positivas opcionales del material
  procesado. Sirven para proporciones, no para reconstruir archivos originales.
  Las miniaturas están recortadas y no sirven para obtener esas proporciones.
  La central completa los metadatos antiguos leyendo el archivo de visualización,
  sin convertirlo ni cambiar su hash. No volver a aplicar `rotationDegrees`: la variante
  entregada ya está rotada.
- Sin dimensiones válidas, el elemento se muestra individualmente.
- Persistencia, sincronización y respaldo de configuración siguen el circuito
  normal del agente. La galería conserva todos los materiales, no sólo los
  elementos que gobiernan cada escena.

`core/collage-policy.ts` concentra agrupación y adaptación de navegación.
`core/collage-fit.ts` contiene el ajuste geométrico y de recorte acotado.
`app.spec.ts` verifica integración con preparación, video, reposo y preferencias.
No se requiere una biblioteca nueva ni generar collages como archivos de imagen.

La aceptación visual de cada nueva versión se realiza sobre el dispositivo.
Instalar mediante el mecanismo normal de releases firmadas.

## Renovación anticipada y recuperación

- Un único worker recibe metadatos mínimos, sin URLs, nombres, leyendas ni píxeles.
  Calcula la próxima vuelta tras una escena estable. Mantiene un plan activo y
  uno preparado, no un historial ilimitado de planes.
- La reconciliación inicial y por cambios de biblioteca también usa el worker,
  con un máximo de dos segundos. Si no responde, se conserva capacidad de mostrar
  medios individuales mediante un fallback lineal; no se calcula geometría en la
  interfaz. Los resultados cancelados por reposo/cambio de biblioteca no se adoptan.
- Se ajustan primero hasta cinco destinos reales pendientes o del historial,
  excluyendo medios en cuarentena, antes de calcular la próxima vuelta. Una caché
  acotada de 32 escenas refinadas evita repetir ajustes tras saltos/retrocesos.
- La preparación tiene un límite de 15 segundos, cancela realmente el worker y
  reintenta con espera creciente de 5–60 segundos. Un salto que necesita ajuste
  fino tiene un límite de 2 segundos; si el worker está ocupado/no disponible se
  usa la plantilla base, respetando el encuadre. No se fuerza el optimizador en
  el hilo de la interfaz.
- Al estabilizarse una escena se empieza a cargar/decodificar la siguiente, sin
  esperar al final del temporizador o video. El actual sigue reproduciéndose.
  No hay tercer escenario ni tercer decodificador de video. Una vez lista, se
  anticipan las fotos de la segunda siguiente, o el destino anterior del historial
  tras un retroceso. Si incluye video, sólo se anticipa su póster: no se afirma que
  esté listo para reproducirse. El presupuesto o un archivo no disponible pueden
  dejar la reserva auxiliar incompleta; nunca se cambia el orden para ocultarlo.
- Avanzar al mismo destino que se prepara reutiliza la operación, su DOM y su
  deadline original. Repetir el toque no reinicia el timeout. Un destino distinto
  invalida la operación anterior; sus callbacks no pueden confirmar la navegación.
  Las fotos de reserva se revalidan en staging porque Chromium puede expulsar su
  caché interna. La precarga en background no se anuncia al watchdog como transición.
- Un fallo primario identifica/cuarentena el material y recompone o busca la
  siguiente escena inmediatamente, sin esperar el temporizador. La reserva no
  marca medios como vistos. Se mantiene la política de doble toque y de ignorar
  órdenes durante el fundido para no reintroducir avances dobles.
- Un plan listo no significa que sus archivos estén listos. Sólo el commit de una
  escena cargada, tras el crossfade, adopta la nueva vuelta y marca **todos** sus
  miembros como vistos. Cancelaciones, fallos y precargas no suman progreso.
- Al terminar, si no existe un plan válido, se repite el disponible durante una
  vuelta completa y se registra el fallback. Un resultado tardío nunca sustituye
  la mezcla a mitad de esa vuelta. No se espera al worker con la pantalla detenida.
- El final depende de una cohorte finita: los IDs existentes al comenzar la
  vuelta, menos los eliminados. Nuevas entradas pueden mostrarse, pero no amplían
  esa condición de cierre. Un hash nuevo deja de contar como visto; los medios
  temporalmente en cuarentena no impiden cerrar la vuelta.
- La galería continúa desde lo seleccionado; los elementos saltados siguen
  pendientes. Atrás/adelante recorre hasta 64 escenas realmente mostradas y puede
  repetirlas por petición del usuario. Ese historial es sólo de sesión.
- Se guardan semilla, variante del algoritmo, cohorte y vistos en un checkpoint
  local de metadatos (máximo 2 MB, 20.000 identidades por lista al restaurar).
  Se valida contra el marco, modo, orden y contenido actual. Un checkpoint corrupto
  se descarta sin impedir reproducción. No es caché de imágenes ni copia central.
- Cambiar contenido, hash, dimensiones, encuadre, modo, orden o aspecto invalida
  planes incompatibles. Volumen, clima, leyendas y colores no vuelven a mezclarlos.
- Reposo cancela cálculo inconcluso y precarga; conserva el plan ya terminado,
  progreso y escena visible. Al salir continúa con las reglas vigentes de video.
  No utiliza el tiempo dormido como avance de biblioteca.
- Los resultados se correlacionan por generación de planificación y operación
  de navegación. Los de un worker terminado o una preparación cancelada se ignoran.

## Trazas y pruebas

`viewer.collage` distingue `plan-requested`, `plan-ready`, `lookahead-ready`,
`preload-ready`, `preload-used`, `round-adopted`, `scene-committed`, selecciones
manuales, historial, cancelaciones, reposo, checkpoint y fallbacks. Cada evento
tiene UUID, sesión, build, hora y secuencia. Las decisiones de planificación
añaden vuelta, semilla, huella de entradas, versión, cantidades y duración;
los commits incluyen IDs de todos los medios, nunca leyendas ni remitentes.

El visor conserva hasta 128 eventos no confirmados y reintenta con el mismo UUID.
El agente confirma después de escribir su outbox y registra en su log estructurado;
el central los almacena idempotentemente en `device_events`. No se generan
notificaciones al usuario por cada traza. El detalle de entrega, límites y consultas
está en `naiskos-agent/docs/collage-events.md`.

Pruebas repetibles:

```bash
npm test -- --watch=false
npm run build
npm run test:collage-browser
```

La última requiere Node 24, FFmpeg y Chromium/Chrome (`CHROME_BIN` opcional). Usa perfil
temporal, agente sintético por loopback y el bundle de producción: varias vueltas
con fotos y un MP4 generado en memoria, precarga real, reposo, recuperación de HTTP
404 y benchmark de 2.300 elementos en
el worker. No conecta al marco ni a la central. Las pruebas unitarias cubren además
galería, historial, actualización de biblioteca, fallos, callbacks tardíos,
timeouts, checkpoint, límites de selección y entrega de trazas. Las mediciones
de escritorio no acreditan por sí solas el rendimiento de la Raspberry.
