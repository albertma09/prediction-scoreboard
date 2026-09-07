# PREDICTION SCOREBOARD — contexto del proyecto

> Documento de arranque. Contiene todo lo necesario para continuar sin historial de conversación.
> Creado: 7 de septiembre de 2026. Estado: **diseño aprobado, nada construido todavía.**

---

## 1. QUÉ ES

Un sistema que **emite predicciones sobre mercados financieros y mide honestamente si acierta o no**.

**No opera. No mueve dinero. No da consejos de inversión.** Solo predice, registra y se evalúa a sí mismo.

Idea original del usuario: *"un bot que me diga si algo va a subir o bajar, y que vaya guardando la info de lo que acierta y lo que no"*.

## 2. POR QUÉ ESTE PROYECTO Y NO UN BOT DE TRADING

Los productos que "predicen el mercado" se venden indefinidamente porque **nadie los mide**: cuando aciertan lo publican, cuando fallan lo borran.

Por eso el valor de este proyecto **no está en la predicción, está en el sistema de medición**. Es el instrumento de medida que falta en ese mercado. Consecuencia estratégica: *vender el análisis, nunca el riesgo*.

**Ventaja secundaria:** si el bot no tiene habilidad, lo descubrimos gastando ~0 € en lugar de descubrirlo con capital real dentro.

## 3. PRINCIPIOS NO NEGOCIABLES

Estos seis puntos son el proyecto. Si se rompe alguno, el resultado es ruido bonito sin valor.

### 3.1 Las predicciones son probabilísticas, nunca puntuales

❌ `"El bitcoin subirá un 5% este mes"` — no es puntuable. Si sube un 4,9%, ¿falló?

✅ `P(BTCUSD cierre ≥ +5% el 2026-09-30 | t0=2026-09-01) = 0,35`

Solo así se puede aplicar una **regla de puntuación propia** (*strictly proper scoring rule*), que penaliza exagerar la confianza y hace imposible hacer trampas sin querer.

### 3.2 Toda predicción se puntúa contra un BASELINE. Sin excepción

**La trampa del acierto:** si BTC sube el 55% de los meses, un bot que diga siempre "sube" acierta el 55% y tiene **habilidad exactamente cero**.

Métrica principal: **Brier Skill Score** (normaliza el Brier score contra la climatología / tasa base). Positivo = mejor que el baseline. Negativo = peor.

Baselines obligatorios en el sistema:
1. **Tasa base histórica** del activo y horizonte.
2. **Random walk / martingala** (probabilidad 0,5).
3. **Precio de los mercados de predicción** (ver 3.4).

> **Regla dura: un modelo que no bate al baseline tonto se descarta. No se "mejora": se descarta.**

### 3.3 El registro es inmutable

Log **append-only**, con timestamp y hash del contenido calculados **antes** de que el evento ocurra. Nunca editable, nunca borrable.

Si el histórico se puede tocar, no vale nada — ni para vender, ni para uno mismo, porque el sesgo de "ajustar un poco" es inevitable. **Esta es la pieza central de ingeniería del proyecto, no el modelo.**

### 3.4 Benchmark externo desde el día 1: mercados de predicción

**Polymarket** y **Kalshi** cotizan probabilidades reales sobre precio de BTC y tienen API (Kalshi: REST, regulada por la CFTC · Polymarket: CLOB en Polygon; en 2026 adquirió Dome, la API cross-plataforma). Volumen combinado en junio de 2026: **44.800 M$**.

Esto da una probabilidad de mercado contra la que comparar **cada predicción, el mismo día**. Si el bot no bate el precio de Polymarket, no tiene habilidad — y se sabe en semanas en lugar de en años.

### 3.5 Horizonte corto y muchos activos en paralelo

Predicciones mensuales = 12 observaciones al año. Para distinguir estadísticamente un 55% de un 60% de acierto hacen falta **cientos de observaciones** → décadas.

**Consecuencia obligatoria de diseño:** horizonte **diario o semanal**, y **muchos activos a la vez**. Una predicción mensual sobre un solo activo es un producto que tarda 20 años en dar una respuesta.

### 3.6 Predecir MAGNITUD y VOLATILIDAD antes que DIRECCIÓN

Hallazgo de la investigación: la **agrupación de volatilidad** (*volatility clustering*, base de los modelos GARCH) es una de las regularidades empíricas más robustas de las finanzas. La **dirección** de los retornos en activos líquidos es prácticamente impredecible. La predictibilidad de retornos además **depende del estado del mercado** (mayor en recesiones, mercados bear y sentimiento bajo).

| Tipo de predicción | Probabilidad de habilidad medible |
|---|---|
| "BTC subirá esta semana" | Muy baja — moneda al aire |
| **"BTC se moverá más de un 5% esta semana"** | **Notablemente mayor** |
| "La volatilidad de la próxima semana superará a la de esta" | Alta |

**Por tanto: el catálogo de predicciones arranca con magnitud y volatilidad, y la dirección es secundaria.**

## 4. STACK Y ARQUITECTURA

Stack del usuario, sin tecnologías nuevas:

| Capa | Tecnología |
|---|---|
| Backend / motor | **Node.js + TypeScript** |
| BD | **PostgreSQL** |
| Programación de tareas | cron |
| Frontend / panel | **Angular** |
| Datos de precio | API pública de exchange (Binance/Coinbase públicas, sin clave) |
| Benchmark | API de Polymarket y/o Kalshi |

Módulos:

1. **Ingesta** — precios OHLCV, idempotente y reproducible.
2. **Motor de predicción** — modelos versionados. Cada predicción registra **qué versión del modelo** la emitió.
3. **Registrador inmutable** — append-only + hash. La pieza crítica.
4. **Resolvedor** — al vencer el horizonte, determina el resultado real de forma automática y determinista.
5. **Evaluador** — Brier score, Brier Skill Score, curva de calibración, comparación contra los 3 baselines.
6. **Panel (Angular)** — scoreboard público: calibración, skill por activo/horizonte/modelo, histórico completo con los fallos a la vista.

## 5. ALCANCE DEL MVP

**Dentro:**
- 3-5 activos líquidos (cripto para empezar: datos gratis, 24/7, más observaciones por semana).
- Horizonte diario y semanal.
- Predicciones de magnitud/volatilidad + dirección como secundaria.
- Baselines 1 y 2 (tasa base y 0,5).
- Registro inmutable y resolución automática.
- Panel con curva de calibración y Brier Skill Score.

**Fuera del MVP (explícitamente):**
- Ejecutar operaciones. Nunca, en ninguna versión.
- Modelos complejos o deep learning. Primero baselines honestos y GARCH.
- Benchmark de Polymarket/Kalshi (fase 2, en cuanto el núcleo funcione).
- Autenticación, multiusuario, cobros.

**Tiempo estimado:** MVP funcional 2-3 días · versión publicable con panel 5-7 días · coste ~0 € (APIs públicas + free tier).

## 6. MONETIZACIÓN (decidida a nivel de estrategia, no de implementación)

Por orden de preferencia:

1. ✅ **El scoreboard como producto** — auditar predictores de terceros (canales de señales, cuentas de "IA que predice el mercado") con Brier score, calibración y comparación contra tasa base y mercados de predicción. **Vender la vara de medir.** Es la vía elegida.
2. ⚠️ **Numerai / CrunchDAO** — pagan por predicciones con medición rigurosa. En Numerai se stakea NMR: hasta 25% del stake como recompensa, pero **se quema hasta el 25% si no se bate el benchmark**. **No es ingreso pasivo: es riesgo financiero.** Solo si el modelo demuestra habilidad antes.
3. Si el bot resultara calibrado de verdad, el propio track record verificable es el activo.

## 7. REGLAS DE TRABAJO

- 🚫 **Sin comentarios en el código.** Preferencia global del usuario. Las explicaciones van en la respuesta o en un `.md`.
- **Nunca presentar nada como forma garantizada de ganar dinero.** Ni en el código, ni en la UI, ni en los textos.
- **No prometer rentabilidad en ningún texto de producto.** Es una herramienta de medición.
- **El usuario compila y ejecuta.** Claude no tiene acceso a las cuentas ni a los datos en vivo.
- No aplican los agentes especializados del framework hotelero (ver `../CLAUDE.md`).

## 8. GLOSARIO

| Término | Qué es |
|---|---|
| **Brier score** | Error cuadrático medio entre la probabilidad predicha y el resultado (0 = perfecto, 1 = máximo error). *Strictly proper*: castiga exagerar la confianza. |
| **Brier Skill Score (BSS)** | Brier normalizado contra un baseline. **La métrica principal del proyecto.** >0 = hay habilidad; ≤0 = no la hay. |
| **Calibración** | Que cuando dices 70%, ocurra ~70 veces de cada 100. Se visualiza con la curva de calibración (*reliability diagram*). |
| **Resolución / sharpness** | Capacidad de alejarse de la tasa base y seguir acertando. Un bot que siempre dice 50% está calibrado pero es inútil. |
| **Tasa base** (*base rate*) | Frecuencia histórica del evento. El listón mínimo. |
| **Volatility clustering** | Los periodos de alta volatilidad se agrupan. Base de GARCH y la razón de 3.6. |
| **Sesgo de supervivencia** | Los rankings solo muestran a quien sobrevivió; el que se arruinó no aparece. |

## 9. DECISIONES PENDIENTES (para la siguiente sesión)

1. **Nombre del proyecto/producto.**
2. **Qué activos exactamente** en el MVP (propuesta: BTC, ETH, SOL + 1-2 índices o pares FX).
3. **Fuente de precio definitiva** y política de resolución (¿qué precio de cierre cuenta y en qué huso horario? Debe ser determinista y estar fijado por escrito **antes** de la primera predicción).
4. **Catálogo inicial de tipos de predicción** (umbrales de magnitud, ventanas, definición exacta de cada evento).
5. Si el panel es público desde el principio o privado hasta tener N predicciones puntuadas.

## 10. SIGUIENTE PASO INMEDIATO

Cerrar los puntos 1-4 de la sección 9 y producir el **listado de objetivos** del MVP (esquema de BD, formato canónico de predicción, contrato del registrador inmutable, métricas y fuentes de datos).

**Frase de arranque sugerida tras el `/clear`:**
> *"Lee prediction-scoreboard/CLAUDE.md y hazme el listado de objetivos del MVP."*
