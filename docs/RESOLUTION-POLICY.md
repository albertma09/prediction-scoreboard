# POLÍTICA DE RESOLUCIÓN — v1

**Estado: congelada.** Fijada el 7 de septiembre de 2026, antes de la primera predicción registrada.

Este documento define, de forma determinista y sin margen de interpretación, cómo se emite y cómo se resuelve cada predicción. Cambiar cualquier regla de aquí invalida la comparabilidad del histórico: **una modificación exige una versión nueva del documento y una versión nueva de la política (`resolver_version`), y el histórico anterior se sigue evaluando con la versión con la que se emitió.**

---

## 1. Precio de referencia

Se usa **siempre `adj_close`**, el cierre ajustado por splits y dividendos.

Motivo: sin ajustar, un split 4:1 produce un retorno de -75% que no corresponde a ningún movimiento de mercado, y contaría como acierto de una predicción de magnitud. En cripto `adj_close` coincide con `close`, así que la regla es uniforme.

`adj_close` es el único campo de `ohlcv_bar` que puede refrescarse a posteriori, porque el ajuste cambia cuando hay un nuevo dividendo o split. Todo refresco se registra en `resolution_anomaly`. **Una resolución ya escrita nunca se recalcula por un refresco posterior** (ver sección 6).

## 2. Slot de emisión

- `t0` es **siempre medianoche UTC exacta** del día de emisión. Es un slot canónico, no un instante de reloj.
- El cron de emisión se ejecuta a las **00:05 UTC**.
- `append()` rechaza cualquier emisión **más de 30 minutos** después de abrirse el slot. Emitir con retraso permitiría ver parte del movimiento que se pretende predecir.
- El instante real de registro se guarda aparte, en `created_at`. `t0` es el slot; `created_at` es el reloj.

## 3. Ventana

```
window_end_utc = t0 + calendarDays(horizonte)
```

| Horizonte | Días de calendario |
|---|---|
| `1d` | 1 |
| `7d` | 7 |

**Barras de la ventana** — las barras con:

```
bar_date >= fecha(t0)  y  bar_date < fecha(window_end_utc)
```

**Barra base** — la última barra con `bar_date < fecha(t0)`. Es el punto de partida del retorno y está completamente cerrada en el momento de emitir.

**Barra final** — la última barra de la ventana.

```
R = adj_close(barra final) / adj_close(barra base) - 1
```

## 4. Asimetría entre cripto y bolsa: declarada, no oculta

Un solo slot de emisión a medianoche UTC produce dos horizontes que **no son idénticos**, y conviene tenerlo delante:

| | Cripto | Bolsa / ETF |
|---|---|---|
| Barra base a las 00:00 UTC del día D | Cierre de D-1 a las 00:00 UTC | Cierre de la última sesión (≈20:00-21:00 UTC de D-1) |
| Ventana `1d` | D 00:00 → D+1 00:00 UTC, 24 h exactas | La sesión de D, que cierra ≈20:00 UTC de D |
| Barras en una ventana `7d` | 7 | ≈5 |

Consecuencia práctica: una predicción `1d` sobre SPY emitida el lunes a las 00:05 UTC se resuelve con el cierre del lunes, unas 20 horas después, no 24. Es coherente y sin fuga de información — el emisor no ve nada de la sesión de D —, pero **el horizonte efectivo de bolsa es algo más corto que el de cripto**.

Se acepta para el MVP a cambio de tener un único cron. La alternativa (un slot propio para bolsa tras su cierre) queda para una v2 de esta política.

Para escalar la volatilidad al horizonte se usa el número de barras esperado por ventana, no los días de calendario:

| Clase de activo | `1d` | `7d` |
|---|---|---|
| crypto | 1 | 7 |
| equity, etf, index | 1 | 5 |

## 5. Catálogo de eventos

Los tres tipos de evento comparten la misma definición para todos los modelos. Esto no es un detalle: **si cada modelo predijera un evento ligeramente distinto, sus Brier scores no serían comparables** y todo el sistema de medición se cae.

Los umbrales se calculan **en el momento de emitir** y se **congelan en `event_params`**. El resolvedor no recalcula nada: lee el umbral que ya está registrado. Sin esto, la resolución dependería de datos posteriores a la emisión.

### 5.1 MAG — magnitud

```
σ_diaria  = desviación típica de los últimos 30 log-retornos diarios
σ_ventana = σ_diaria × √(barras por ventana)
umbral    = k × σ_ventana          con k ∈ {1,0 · 1,5}
```

`thresholdAbs = umbral` queda congelado en `event_params`.

```
resultado = |R| >= thresholdAbs  →  1     (umbral inclusivo)
```

### 5.2 VOL — volatilidad

Estimador de volatilidad realizada sobre n log-retornos:

```
RV = √( Σ rᵢ² / n )
```

Con n = 1 se reduce a |r|, así que el estimador vale para los dos horizontes.

`rvPrevious` = RV de la ventana inmediatamente anterior a `t0`, congelado en `event_params`.

```
resultado = RV(ventana) > rvPrevious  →  1     (empate exacto = 0)
```

### 5.3 DIR — dirección

```
resultado = R > 0  →  1     (precio plano = 0)
```

Es la predicción secundaria. Se espera que no muestre habilidad; se mide precisamente para poder demostrarlo.

## 6. Resolución

- El resolvedor se ejecuta a las **02:00 UTC**.
- Resuelve toda predicción cuyo `window_end_utc` ya haya pasado y **cuyas barras necesarias estén presentes**. Si el dato aún no está, no resuelve: no existe resolución parcial.
- Usa la **misma función** `resolveEvent()` que valida el evento en emisión. La definición del evento vive en un solo sitio del código.
- Escribe en `resolution_inputs` las barras exactas usadas, con su hash en `inputs_hash`. Una resolución es auditable sin necesidad de confiar en nosotros.
- **Congelación:** una vez escrita, la resolución no se recalcula nunca. Si el proveedor revisa un precio después, la revisión se registra en `resolution_anomaly` y la resolución se mantiene.
- **No hay resolución manual.** No existe ningún endpoint ni comando que permita fijar un resultado a mano.

## 7. Predicciones nulas (`void`)

Una predicción se marca **nula** cuando la resolución es mecánicamente imposible. Una predicción nula **no se puntúa** y no entra en ninguna métrica; se cuenta y se muestra aparte.

| Motivo | Condición |
|---|---|
| `no_bars_in_window` | La ventana no contiene ninguna barra (festivo, cierre de mercado, hueco del proveedor) |
| `insufficient_vol_bars` | Evento VOL con menos barras que el mínimo exigido |
| `no_base_bar` | No existe barra base anterior a `t0` |

Mínimo de barras exigido:

| Tipo de evento | Mínimo |
|---|---|
| MAG, DIR | 1 barra en la ventana |
| VOL | `ceil(0,6 × barras por ventana)`, nunca menos de 1 |

El criterio es **mecánico y conocido de antemano**, así que anular no es seleccionar resultados favorables. Aun así, el número de nulas se publica junto a las métricas: una tasa de nulas alta en un activo es en sí misma un dato sobre la fiabilidad de su fuente.

## 8. Unicidad y corrección

`prediction_unique_emission` garantiza una única predicción por combinación de instrumento, versión de modelo, evento, horizonte y ventana.

**Una predicción emitida no se puede corregir.** No hay ruta de código, ni de base de datos, que lo permita. Si un modelo emitió mal, la respuesta correcta es publicar el fallo y sacar una versión nueva del modelo.

## 9. Versionado

| Elemento | Valor actual |
|---|---|
| Versión de esta política | `1` |
| `resolver_version` correspondiente | `1.0.0` |
| Versión del esquema del payload canónico | `1` |

Cualquier cambio en las secciones 1 a 7 obliga a incrementar la versión de la política y de `resolver_version`. Las predicciones ya emitidas se siguen resolviendo con la versión vigente en su emisión.
