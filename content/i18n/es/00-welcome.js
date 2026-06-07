registerLessonI18nSrc("00-how-this-course-works", "es", function () {/*
---
id: 00-how-this-course-works
title: Cómo Funciona Este Curso
minutes: 10
level: beginner
objectives:
  - Comprender la estructura que te lleva de cero a ingeniero principal
  - Saber cómo ejecutar código directamente en tu navegador
  - Aprender a sacar el máximo provecho de cada lección
---

# Cómo Funciona Este Curso

## Por qué importa

Estás a punto de aprender Node.js de la manera en que un gran mentor lo enseñaría: con la lentitud suficiente para que nada resulte confuso, pero con la profundidad necesaria para que al final puedas diseñar sistemas que sirvan a millones de usuarios. Antes de escribir una sola línea de Node, dediquemos diez minutos a asegurarnos de que sabes cómo *usar* este curso. Una pequeña inversión ahora te ahorrará horas más adelante.

## Objetivos de aprendizaje

- Comprender el recorrido desde principiante absoluto hasta **ingeniero principal distinguido (Nivel 7+)**.
- Ejecutar JavaScript directamente en esta página — sin necesidad de instalar nada para empezar.
- Saber exactamente para qué sirve cada parte de una lección.

## La forma del recorrido

Este curso está organizado en **seis niveles**. Cada nivel se construye sobre el anterior, como los pisos de un edificio. No debes saltarte pisos — el material avanzado literalmente no tiene sentido sin los fundamentos.

| Nivel | En qué te conviertes |
|-------|----------------------|
| **Nivel 0 — Orientación** | Configurar y ejecutar Node como un profesional |
| **Nivel 1 — Fundamentos** | Fluido en JavaScript y el entorno de ejecución de Node |
| **Nivel 2 — APIs Principales** | Capaz de usar cada módulo principal de Node |
| **Nivel 3 — Construyendo Cosas Reales** | Publicando CLIs, APIs y aplicaciones con base de datos |
| **Nivel 4 — Calidad de Ingeniería** | TypeScript, pruebas, herramientas, monorepos |
| **Nivel 5 — Avanzado y Principal** | Sistemas distribuidos, rendimiento, arquitectura |

> [!NOTE] Siempre puedes ver dónde estás
> La barra lateral de la izquierda es tu mapa. Tu progreso se guarda automáticamente en este navegador, y la barra en la parte superior muestra cuánto has avanzado. Usa los botones **Siguiente →** y **← Anterior** al final de cada lección, o simplemente presiona las teclas de flecha.

## Ejecuta código sin instalar nada

La mayoría de los bloques de código en este curso son **interactivos**. Cuando veas un botón verde **▶ Ejecutar**, puedes editar el código y ejecutarlo al instante — se ejecuta de forma segura dentro de tu navegador. Pruébalo ahora:

~~~js run
// ¡Edítame! Luego presiona ▶ Ejecutar.
const name = "future principal engineer";
console.log("Hello, " + name + "!");

// JavaScript también puede hacer trabajo real:
const numbers = [1, 2, 3, 4, 5];
const total = numbers.reduce((sum, n) => sum + n, 0);
console.log("The sum is:", total);
~~~

Adelante — cambia el nombre, cambia los números y ejecútalo de nuevo. Experimentar es como se aprende. No puedes romper nada.

> [!PITFALL] "Interactivo" significa JavaScript del navegador
> Los bloques con **▶ Ejecutar** ejecutan *JavaScript puro* en tu navegador. Algunas lecciones muestran código que usa características específicas de Node — leer archivos, iniciar servidores web, conectarse a bases de datos — que un navegador no puede hacer. Esos ejemplos son **de solo lectura** y vienen con un panel de **Salida esperada** para que puedas ver exactamente qué pasaría al ejecutarlos en Node real. Instalarás Node real en las próximas dos lecciones.

## Anatomía de una lección

Cada lección sigue el mismo ritmo, para que siempre sepas qué esperar:

1. **Por qué importa** — la razón del mundo real para preocuparse.
2. **Objetivos de aprendizaje** — lo que podrás hacer.
3. **Concepto** — explicación en lenguaje simple, construida desde la base.
4. **Recorrido narrado** — código anotado que lees línea por línea.
5. **Inténtalo tú mismo** — un entorno de práctica ejecutable para experimentar.
6. **Ejercicios** — pequeños desafíos con pistas y soluciones revelables.
7. **Proyecto** — algo real que construyes con lo que aprendiste.
8. **Errores comunes** — los errores que cometen incluso los desarrolladores experimentados.
9. **Lo que aprendiste** + **Próximos pasos**.

## Cómo mejorar de verdad

> [!PRINCIPAL] El único hábito que crea ingenieros principales
> Leer código te enseña a *reconocer* soluciones. **Escribir** código te enseña a *producirlas*. La diferencia entre un ingeniero de nivel medio y un ingeniero principal son principalmente miles de horas de práctica deliberada. Así que para cada concepto: escríbelo, ejecútalo, rómpelo a propósito y arréglalo. Haz cada ejercicio. Construye cada proyecto. No te limites a leer.

Aquí tienes un pequeño ejercicio para demostrar que estás listo.

### Ejercicio: hazlo tuyo

Edita el código a continuación para que imprima una cuenta regresiva del 5 al 1, y luego imprima "Lift off!".

~~~js run
// Tu turno. Pista: un bucle que cuenta hacia atrás.
for (let i = 5; i >= 1; i--) {
  console.log(i);
}
console.log("Lift off!");
~~~

<details>
<summary>Mostrar una posible solución</summary>

El código anterior ya funciona — pero intenta escribirlo de una manera diferente, usando `while` en lugar de `for`:

~~~js run
let i = 5;
while (i >= 1) {
  console.log(i);
  i = i - 1;
}
console.log("Lift off!");
~~~

Rara vez hay una sola respuesta correcta en programación. Sentirte cómodo con *múltiples* formas de expresar la misma idea es una señal de que estás creciendo.
</details>

## Lo que aprendiste

- Este curso sube seis niveles desde principiante hasta ingeniero principal — recórrelos en orden.
- Los bloques verdes con **▶ Ejecutar** se ejecutan en vivo; los bloques de solo lectura muestran código exclusivo de Node con la salida esperada.
- Tu progreso se guarda automáticamente; navega con los botones o las teclas de flecha.
- La manera de mejorar es **escribir** código, no solo leerlo.

## Próximos pasos

A continuación, instalaremos Node.js de la manera en que lo hacen los profesionales — con un gestor de versiones — para que puedas ejecutar todo en este curso en tu propia máquina.
*/});

registerLessonI18nSrc("00-installing-node", "es", function () {/*
---
id: 00-installing-node
title: Instalando Node a la Manera Profesional
minutes: 16
level: beginner
objectives:
  - Instalar Node.js usando un gestor de versiones en lugar del instalador directo
  - Comprender LTS vs Current y cuál elegir
  - Verificar tu instalación y cambiar entre versiones
---

# Instalando Node a la Manera Profesional (nvm / fnm / Volta)

## Por qué importa

*Podrías* descargar Node desde nodejs.org y hacer doble clic en un instalador. Los principiantes hacen eso. Los profesionales no — y aquí está la razón: los proyectos reales fijan diferentes versiones de Node. La aplicación de un cliente necesita Node 20, otra necesita Node 24. Una única instalación global significa un dolor constante. Un **gestor de versiones** te permite instalar muchas versiones de Node una al lado de la otra y cambiar con un solo comando. Configurar esto ahora es la diferencia entre una carrera fluida y años de dolores de cabeza con el "funciona en mi máquina".

## Objetivos de aprendizaje

- Instalar un gestor de versiones de Node apropiado para tu sistema operativo.
- Comprender las líneas de lanzamiento **LTS** vs **Current**.
- Confirmar que Node y npm funcionan y cambiar de versión bajo demanda.

## LTS vs Current: ¿qué versión?

Node lanza dos líneas de versiones:

- **LTS (Soporte a Largo Plazo)** — números de versión mayor pares (20, 22, **24**...). Estable, con soporte por ~3 años, y lo que deberías usar en producción. A mediados de 2026, **Node 24 es el LTS activo**.
- **Current** — las características más recientes, pero con soporte más corto. Ideal para experimentar con APIs de vanguardia.

> [!NOTE] Nuestra regla general
> Usa el último **LTS** para todo en este curso. Obtienes características modernas (`fetch` nativo, el ejecutor de pruebas integrado, soporte nativo para `.env`, el modelo de permisos) *y* estabilidad.

## Elige un gestor de versiones

Hay tres excelentes opciones. Cualquiera está bien — elige una.

| Herramienta | Ideal para | Notas |
|-------------|------------|-------|
| **fnm** | La mayoría de las personas | Extremadamente rápido, multiplataforma, escrito en Rust |
| **nvm** | Tradicionalistas de macOS / Linux | El original; enorme comunidad |
| **Volta** | Equipos que quieren herramientas fijadas | Fija Node *y* gestores de paquetes por proyecto |

### Opción A — fnm (recomendado)

En macOS o Linux:

~~~bash
# Instalar fnm
curl -fsSL https://fnm.vercel.app/install | bash

# Reinicia tu terminal, luego instala y usa el último LTS
fnm install --lts
fnm use --lts
fnm default lts-latest
~~~

En Windows (PowerShell, con winget):

~~~bash
winget install Schniz.fnm
fnm install --lts
fnm use --lts
~~~

### Opción B — nvm (macOS / Linux)

~~~bash
# Instalar nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Reinicia tu terminal, luego:
nvm install --lts
nvm use --lts
nvm alias default 'lts/*'
~~~

### Opción C — Volta (multiplataforma, fija por proyecto)

~~~bash
curl https://get.volta.sh | bash
volta install node@lts
~~~

## Verifica que funcionó

Abre una terminal **nueva** y ejecuta estos dos comandos. (Estos son comandos reales de terminal — ejecútalos en tu propia máquina, no en el navegador.)

~~~bash
node --version
npm --version
~~~

Deberías ver algo como esto:

> [!OUTPUT]
> v24.2.0
> 11.3.0

Si ves números de versión, has terminado — Node *y* npm (que viene incluido con Node) están instalados. 🎉

## Cambiar de versión ahora es trivial

Este es el beneficio. ¿Quieres probar tu código en una versión más antigua de Node?

~~~bash
# Instalar y cambiar a Node 20 por un momento
fnm install 20
fnm use 20
node --version   # v20.x.x

# Volver al último LTS
fnm use --lts
~~~

> [!PRINCIPAL] Fija Node por proyecto
> Añade un archivo llamado `.nvmrc` (o `.node-version`) a cada proyecto que contenga solo la versión, por ejemplo `24`. Entonces `fnm use` o `nvm use` (sin argumento) lee ese archivo y cambia automáticamente. Mejor aún, Volta registra la versión exacta dentro de `package.json` para que *cada* miembro del equipo ejecute el mismo Node sin tener que pensar en ello. La reproducibilidad es un valor de ingeniero principal — y empieza aquí.

## Errores comunes

> [!PITFALL] "Comando no encontrado" después de instalar
> Casi siempre significa que tu shell aún no ha cargado el gestor de versiones. **Cierra y vuelve a abrir tu terminal** (o ejecuta `source ~/.bashrc` / `source ~/.zshrc`). El instalador imprime la línea exacta que debes añadir a la configuración de tu shell — lee esa salida.

> [!WARNING] No mezcles una instalación manual con un gestor de versiones
> Si instalaste Node anteriormente desde el sitio web, desinstálalo primero. Dos instalaciones de Node luchando por tu `PATH` causa errores desconcertantes. Deja que el gestor de versiones sea el dueño de Node por completo.

## Lo que aprendiste

- Los profesionales gestionan Node con **fnm / nvm / Volta**, nunca con una única instalación global.
- Usa el último **LTS** (Node 24 en 2026) para la mejor combinación de características y estabilidad.
- `node --version` y `npm --version` confirman tu configuración.
- Fijar una versión por proyecto mantiene a todo tu equipo sincronizado.

## Próximos pasos

Tienes Node instalado. A continuación, escribirás y ejecutarás tu primer programa — de tres maneras diferentes — y conocerás el REPL, tu nuevo mejor amigo para experimentos rápidos.
*/});

registerLessonI18nSrc("00-your-first-program", "es", function () {/*
---
id: 00-your-first-program
title: Tu Primer Programa
minutes: 18
level: beginner
objectives:
  - Ejecutar JavaScript en el REPL de Node para experimentos instantáneos
  - Ejecutar un script desde un archivo como lo hacen los programas reales
  - Usar --eval y --print para comandos de una sola línea
  - Construir y ejecutar tu primer script real de tres maneras diferentes
---

# Tu Primer Programa: REPL, Archivos y --eval

## Por qué importa

Hay tres maneras de ejecutar código con Node, y cada una tiene un propósito. El **REPL** es para experimentos rápidos. Los **archivos** son la forma en que los programas reales se publican. **`--eval`** es para pequeñas líneas de comando y scripts de shell. Un profesional elige la correcta sin pensarlo. Al final de esta lección habrás ejecutado código de las tres maneras y construido tu primer script genuinamente útil.

## Objetivos de aprendizaje

- Usar el **REPL** para probar ideas al instante.
- Ejecutar un programa desde un **archivo `.js`**.
- Usar **`--eval`** y **`--print`** para comandos rápidos.
- Construir un pequeño script "saludador del sistema".

## Manera 1 — El REPL (tu campo de juego instantáneo)

REPL significa **Read-Eval-Print Loop** (Bucle Leer-Evaluar-Imprimir). Escribe `node` sin argumentos y obtendrás un indicador interactivo que lee lo que escribes, lo evalúa, imprime el resultado y repite:

~~~bash
node
~~~

Ahora estás dentro de Node. Escribe una expresión y presiona Enter:

> [!OUTPUT]
> > 2 + 2
> 4
> > const greeting = "hello"
> undefined
> > greeting.toUpperCase()
> 'HELLO'
> > .exit

Algunas cosas a notar:
- Node imprime el **resultado** de cada expresión automáticamente (esa es la parte "Print" en REPL).
- `const greeting = ...` imprime `undefined` porque una *declaración de asignación* no tiene valor — pero la variable ahora queda guardada.
- Escribe `.exit` (o presiona Ctrl+D) para salir.

> [!NOTE] El REPL es para *aprender*, no para *construir*
> Es perfecto para los momentos de "¿qué devuelve esta función de nuevo?". Pero no puedes guardarlo, así que los programas reales viven en archivos.

Puedes experimentar un bucle similar al REPL aquí mismo en tu navegador. Cada `console.log` es como presionar Enter en el REPL:

~~~js run
console.log(2 + 2);
const greeting = "hello";
console.log(greeting.toUpperCase());
console.log(typeof greeting);
~~~

## Manera 2 — Ejecutar un archivo (cómo se publican los programas reales)

Crea un archivo llamado `hello.js` con este contenido:

~~~js
console.log("Hello from a real file!");

const now = new Date();
console.log("The time is:", now.toLocaleTimeString());
~~~

Luego ejecútalo desde tu terminal:

~~~bash
node hello.js
~~~

> [!OUTPUT]
> Hello from a real file!
> The time is: 3:42:18 PM

Eso es todo — así es como empieza cada programa Node en el mundo. Un archivo, y `node` delante de él.

> [!PRINCIPAL] --watch: re-ejecución automática al guardar
> Node moderno tiene un modo de observación integrado. Ejecuta `node --watch hello.js` y Node vuelve a ejecutar el archivo cada vez que lo guardas. No se necesitan herramientas adicionales — esto solía requerir un paquete llamado *nodemon*. Usaremos `--watch` constantemente más adelante en el curso.

## Manera 3 — --eval y --print (líneas de comando)

A veces solo quieres una línea de JavaScript sin crear un archivo — práctico en scripts de shell:

~~~bash
# --eval (o -e) ejecuta el código pero no lo imprime automáticamente
node --eval "console.log(1 + 1)"

# --print (o -p) imprime automáticamente el resultado de la expresión
node -p "process.platform"
node -p "Math.max(3, 9, 2)"
~~~

> [!OUTPUT]
> 2
> linux
> 9

Nota `process.platform` — ese es tu primer vistazo al objeto **`process`** de Node, que conoce todo sobre el programa en ejecución y la máquina en la que está. Lo exploraremos a fondo en el Nivel 1.

## Proyecto: tu primer script real

Construyamos un **saludador del sistema** — un script que imprime un banner amigable y personalizado. Este usa el módulo integrado `os` de Node, por lo que es un ejemplo de solo lectura aquí (un navegador no tiene sistema operativo que inspeccionar), pero puedes copiarlo en un archivo y ejecutarlo de verdad.

~~~js
// greeter.js — ejecutar con: node greeter.js
import os from "node:os";

const user = os.userInfo().username;
const platform = os.platform();          // 'darwin', 'linux', 'win32'
const cpus = os.cpus().length;            // número de núcleos de CPU
const memGB = (os.totalmem() / 1e9).toFixed(1);

console.log("============================================");
console.log("  Welcome back, " + user + "!");
console.log("--------------------------------------------");
console.log("  Platform : " + platform);
console.log("  CPU cores: " + cpus);
console.log("  Memory   : " + memGB + " GB");
console.log("  Node     : " + process.version);
console.log("============================================");
~~~

Cuando lo ejecutes en tu propia máquina, verás algo como:

> [!OUTPUT]
> ============================================
>   Welcome back, ada!
> --------------------------------------------
>   Platform : linux
>   CPU cores: 8
>   Memory   : 16.6 GB
>   Node     : v24.2.0
> ============================================

### Hazlo de tres maneras

Demuestra que entiendes los tres métodos de ejecución:

1. **Archivo:** guárdalo como `greeter.js` y ejecuta `node greeter.js`.
2. **Watch:** ejecuta `node --watch greeter.js` y edita el banner — observa cómo se vuelve a ejecutar.
3. **Línea de comando:** ejecuta `node -p "require('node:os').userInfo().username"` para imprimir solo tu nombre de usuario.

### Ejercicio: la lógica, en el navegador

La lógica de construcción del banner es JavaScript puro. Practícala aquí sin el módulo `os` usando valores falsos:

~~~js run
// Construye el string del banner tú mismo.
const user = "ada";
const platform = "linux";
const cores = 8;

const line = "============================================";
console.log(line);
console.log("  Welcome back, " + user + "!");
console.log("  Platform: " + platform + " | Cores: " + cores);
console.log(line);
~~~

<details>
<summary>Desafío: usa un template literal en lugar de concatenación con +</summary>

~~~js run
const user = "ada";
const platform = "linux";
const cores = 8;

// Los template literals usan backticks y ${...} para la interpolación.
console.log(`  Welcome back, ${user}! Running ${platform} on ${cores} cores.`);
~~~

Los template literals son más limpios que pegar strings con `+`. Los usarás en todas partes.
</details>

## Errores comunes

> [!PITFALL] Olvidar la extensión del archivo o la palabra "node"
> Es `node hello.js`, no `hello.js` (eso le pediría a tu sistema operativo que ejecute el archivo directamente) y no `node hello` (Node no adivinará la extensión para una ruta de script simple). Escribe todo completo.

## Lo que aprendiste

- El **REPL** (`node`) es para experimentos instantáneos.
- Ejecutar un **archivo** (`node file.js`) es cómo se publican los programas reales — y `--watch` lo vuelve a ejecutar al guardar.
- **`--eval`** y **`--print`** manejan líneas de comando rápidas.
- Conociste los objetos **`process`** y **`os`**, tu ventana hacia la máquina en ejecución.

## Próximos pasos

Ahora puedes ejecutar Node de todas las maneras que importan. El Nivel 1 comienza con un repaso de JavaScript — el lenguaje en el que está construido Node. Incluso si ya conoces algo de JavaScript, no te lo saltes: nos enfocamos exactamente en las partes que hacen que Node tenga sentido.
*/});
