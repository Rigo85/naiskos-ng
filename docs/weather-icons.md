# Iconos del clima

El visor y el reloj de reposo usan el mismo componente `WeatherIcon`:
SVG embebidos con trazos locales, color heredado y tamaño relativo al texto.
No requieren fuentes de símbolos/emojis, Internet, una biblioteca de iconos
ni instalar paquetes en el sistema operativo. Los trazos llevan una sombra
estática para conservar contraste sobre las fotos; no hay animación.

Se incluyen sol, luna, parcialmente nublado, nube, lluvia, nieve, tormenta
y estado pendiente. La correspondencia con los códigos meteorológicos está
en `core/weather-icons.ts`. Códigos desconocidos o no válidos usan pendiente.
Se mantiene la agrupación anterior: niebla usa nube y parcialmente nublado
de noche usa nube. No cambian los textos, consulta del clima o configuración.

El SVG es decorativo (`aria-hidden`, no enfocable). La información accesible
la aporta el contenedor: descripción y temperatura en el visor, y texto visible
en reposo. La temperatura sigue siendo texto y respeta Celsius/Fahrenheit.

Se conserva el comportamiento previo sin datos frescos: el visor muestra el
icono pendiente cuando el estado no es `ready`; reposo puede mostrar el último
estado conocido mientras exista `current`. Sin datos, muestra pendiente y
temperatura no disponible. Esta corrección no cambia esa política ni los plazos
de actualización.

Las pruebas cubren todos los códigos admitidos, variantes nocturnas, valores
desconocidos, SVG sin texto/recursos externos y la integración de lluvia en
visor y reposo, incluyendo datos caducados y ausentes. Al añadir un estado,
incorporar sus trazos y pruebas; no volver a introducir un emoji como icono.
