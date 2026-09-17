# Collage básico

En **Configuración → Presentación** se puede elegir:

- **Individual** (predeterminado): comportamiento previo.
- **Columnas verticales**: dos o tres medios verticales, sin filas. Los medios
  horizontales y cuadrados se muestran individualmente.
- **Mosaico adaptable**: plantillas de dos o tres columnas, algunas divididas
  en dos filas; hasta cuatro medios en esta primera versión. Las proporciones
  orientan la elección, pero no prohíben colocar horizontales en columnas altas.

La biblioteca se agrupa después de aplicar el orden configurado. El siguiente
material pendiente inicia cada escena y se buscan acompañantes entre los seis
primeros pendientes. Los no elegidos conservan su prioridad. Cada elemento se
usa una vez por vuelta. La agrupación permanece estable hasta que cambia la
biblioteca o la configuración; no se sortea nuevamente en cada transición.

Cada celda respeta `contain`/`cover` y `inherit`. No hay reconocimiento de sujetos.
Mientras se selecciona un modo collage se ocultan leyendas y remitentes, sin
modificar sus preferencias globales. Reloj y clima siguen en su lugar.

Los toques izquierda/derecha cambian la escena completa. El botón **Menú**
permite acceder a opciones; no hay navegación por arrastre ni zoom. La galería
mantiene sus controles y gestos habituales.

## Reproducción y preparación

Las fotos comparten la duración configurada. Puede haber un único video y sus
controles siguen visibles. Su final, pausa con temporizador, reproducción y
recuperación gobiernan el avance de toda la escena. Reposo cancela la preparación
pendiente y suspende el ciclo visible usando el mecanismo existente.

Sólo se renderizan la escena visible y la candidata. Todos sus archivos deben
cargar antes del crossfade. Un archivo fallido se identifica, se notifica al
agente y se retira temporalmente; se intenta preparar el resto de esa escena.
Si no queda ninguno, continúa la búsqueda existente, con sus límites y reintentos.

## Contrato y compatibilidad

- `settings.collageMode`: `off`, `columns` o `adaptive`; ausencia equivale a `off`.
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
`app.spec.ts` verifica integración con preparación, video, reposo y preferencias.
No se requiere una biblioteca nueva ni generar collages como archivos de imagen.

Estado inicial: pruebas locales; aceptación visual y rendimiento sobre el
dispositivo pendientes. Instalar mediante el mecanismo normal de releases.
