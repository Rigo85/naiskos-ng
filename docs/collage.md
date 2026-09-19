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
usa una vez por vuelta. La agrupación permanece estable hasta que cambia la
biblioteca o la configuración; no se sortea nuevamente en cada transición.
El sorteo de escenas individuales del adaptable usa una semilla por sesión del
visor: no cambia por reposo, colores ni versión del manifiesto. Reiniciar el visor
puede cambiar qué elementos se presentan solos. No modifica el orden configurado,
no duplica elementos ni cambia la agrupación de **Columnas verticales**.

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

El orden aleatorio es estable por identidad, no por versión de manifiesto. Al
migrar desde la versión inicial puede cambiar una vez; después, añadir colores,
miniaturas u otros metadatos no vuelve a sortear la biblioteca. Una publicación
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

El cálculo se hace sólo para la escena que va a prepararse, no para toda la
biblioteca al arrancar. Dos pasadas acotadas retienen un único resultado; una
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

Sólo se renderizan la escena visible y la candidata. Todos sus archivos deben
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
