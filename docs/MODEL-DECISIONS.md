# DECISIONES DE MODELO

Registro de qué modelos se han probado, qué midieron y por qué se conservaron o se
descartaron. Cada entrada es definitiva: los modelos no se editan, se sustituyen por
una versión nueva (lo impide el guard de deriva de `registry.ts`).

---

## 2026-09-08 — Recalibración de volatilidad

### Punto de partida

El backtest (run 2) mostró un sesgo sistemático de **exceso de confianza** en `ewmaVol`:
cuanto más se mojaba, más se equivocaba en la misma dirección.

| Cuando `ewmaVol` decía... | Ocurría |
|---|---|
| 55% | 43% |
| 65% | 52% |
| 75% | 66% |
| 85% | 76% |

Ese desvío no era aleatorio, así que era corregible sin cambiar el modelo de volatilidad.

### Hipótesis probadas

Tres cambios, medidos por separado para saber cuál aportaba qué:

1. **Recalibración**: corregir la probabilidad emitida con una sola palanca en el
   espacio de log-odds, `p_cal = sigmoide(pendiente · logit(p_cruda))`, ajustando la
   pendiente por minimización de Brier sobre el propio historial del modelo.
2. **Colas gruesas**: sustituir la distribución normal por una t de Student
   estandarizada (5 grados de libertad) al convertir volatilidad en probabilidad de
   magnitud.
3. Las dos cosas a la vez.

Modelos emitidos para medirlo: `ewmaVolCal@1.0.0` (1) y `tVolCal@1.0.0` (3).

### Resultados (run 3, BSS contra la tasa base)

| Evento | `ewmaVol` | `ewmaVolCal` | `tVolCal` |
|---|---|---|---|
| VOL 7d (b=5) | 0,1464 | **0,1892** | 0,1892 |
| VOL 7d (b=7) | 0,1760 | **0,1967** | 0,1967 |
| VOL 1d (b=1) | 0,3082 | 0,3090 | 0,3090 |
| MAG 1d k=1,0 | 0,0351 | 0,0433 | 0,0429 |
| MAG 1d k=1,5 | 0,0489 | 0,0472 | 0,0475 |
| MAG 7d k=1,0 | 0,0206 | 0,0162 | 0,0108 |
| MAG 7d k=1,5 | 0,0366 | 0,0235 | 0,0170 |

Error de calibración agregado (fiabilidad, menor es mejor): `ewmaVol` 0,002308 ·
`ewmaVolCal` 0,001372 · `tVolCal` 0,001287.

### Interpretación

La recalibración **mejora la calibración en todos los eventos** pero **solo mejora la
puntuación en volatilidad**. La descomposición del Brier por bins dice exactamente por
qué, y la razón no es la que parecía a primera vista:

| Evento | Modelo | Fiabilidad | Resolución |
|---|---|---|---|
| 1d VOL b=1 | `ewmaVol` | 0,003154 | 0,07909 |
| 1d VOL b=1 | `volCal` | **0,002702** | 0,07909 |
| 7d VOL b=5 | `ewmaVol` | 0,015611 | 0,04832 |
| 7d VOL b=5 | `volCal` | **0,008196** | **0,05119** |
| 7d VOL b=7 | `ewmaVol` | 0,011275 | 0,05179 |
| 7d VOL b=7 | `volCal` | **0,005864** | **0,05206** |
| 1d MAG k=1,0 | `ewmaVol` | 0,002212 | 0,00210 |
| 7d MAG k=1,0 | `ewmaVol` | 0,000698 | 0,00222 |
| 7d MAG k=1,5 | `ewmaVol` | 0,000168 | 0,00095 |

Dos correcciones a lo que se supuso al principio:

1. **La recalibración no cuesta resolución.** Se esperaba que acercar las probabilidades
   al centro sacrificara atrevimiento. No ocurre: a 1 día la resolución es idéntica hasta
   el quinto decimal, y a 7 días **sube ligeramente**. `volCal` gana en las dos mitades
   del Brier a la vez, y de ahí que el BSS suba tanto.

2. **Magnitud no empeoró por el tamaño de muestra, sino porque ya estaba calibrada.** Su
   fiabilidad es de 0,0002 a 0,002, entre 5 y 50 veces menor que la de volatilidad. No
   había nada que corregir, así que cualquier ajuste solo podía añadir ruido —agravado,
   eso sí, porque las ventanas de 7 días se solapan y los ~670 pares equivalen a ~95
   observaciones independientes por activo.

Corolario para el futuro: **antes de recalibrar un evento, mirar su fiabilidad.** Si ya es
del orden de 1e-4, no hay margen y el ajuste solo puede perjudicar.

Las colas de Student hicieron lo previsto en su banda —el bin 0,0-0,1 pasó de un desvío
de −0,0230 a −0,0058— pero eso no llegó al marcador: `tVolCal` es idéntico a
`ewmaVolCal` en volatilidad (las colas solo afectan a magnitud) y peor en magnitud a
7 días.

### Decisión

- ✅ **Conservado: `volCal@1.0.0`** — recalibración aplicada **solo a volatilidad**.
  Comparte la función de probabilidad cruda con `ewmaVol` (importa
  `volatilityProbability`), de modo que la única diferencia entre ambos modelos es la
  calibración. Eso es lo que hace válida la comparación.
- ❌ **Descartado: `tVolCal@1.0.0`** — no mejora la puntuación en ningún evento y la
  empeora en magnitud a 7 días. Aplica el principio 3.2: no se mejora, se descarta.
- ❌ **Descartado: `ewmaVolCal@1.0.0`** — su parte útil es exactamente `volCal`; su
  parte de magnitud perjudica.
- ⏸️ **Magnitud se queda sin recalibrar.** `ewmaVol` sigue siendo el modelo de magnitud.

Ambos modelos descartados **permanecen registrados en `model_version` y sus
puntuaciones siguen en `backtest_score` del run 3**, con ids 4 y 5.

⚠️ **Pero su código nunca se commiteó.** Se escribieron, se midieron y se borraron
dentro de la misma sesión, así que no existen en el histórico de git. Consecuencia: el
`code_hash` que guardan sus filas de `model_version` **no se puede recalcular contra
ningún código**, y por tanto el run 3 no es reproducible. Las puntuaciones son
auditables; los modelos que las produjeron, no.

Esto contradice el espíritu del principio 3.3. **Procedimiento correcto para la próxima
vez: commitear todo modelo que llegue a emitir, incluidos los que se van a descartar, y
retirarlo del catálogo en un commit posterior.** El borrado va después de la medición,
nunca antes. Lo que se descarta es la participación del modelo en el catálogo, no la
evidencia de que se probó.

### Confirmación (run 4)

| Evento | `ewmaVol` | `volCal` |
|---|---|---|
| VOL 1d (b=1) | 0,3082 | 0,3090 |
| VOL 7d (b=5) | 0,1464 | 0,1892 |
| VOL 7d (b=7) | 0,1760 | 0,1967 |

Restringido a volatilidad (N=8912): Brier 0,191735 → 0,188172 · error de calibración
0,006142 → **0,003776 (−38,5%)**.

Las dos colas quedan casi corregidas:

| bin | desvío `ewmaVol` | desvío `volCal` |
|---|---|---|
| 0,0-0,1 | −0,0592 | −0,0111 |
| 0,1-0,2 | −0,0520 | −0,0172 |
| 0,8-0,9 | +0,0880 | +0,0137 |
| 0,9-1,0 | +0,0452 | +0,0083 |

### Quien consume cada modelo

La preferencia de modelo por tipo de evento vive en `src/consult/preference.ts` y la fija
`MODEL_PREFERENCE_BY_EVENT`:

| Evento | Modelo preferido | Por que |
|---|---|---|
| VOL | `volCal` | Es el unico con mejora medida |
| MAG | `ewmaVol` | La recalibracion perjudica a 7 dias |
| DIR | `climatology` | Ningun modelo tiene habilidad medida |

`coinflip` no es preferido nunca: existe solo como baseline. Esa tabla esta fijada por
`preference.test.ts`, para que no se pueda cambiar en silencio.

El desplegable de la curva de calibracion del panel ya no lleva la lista de modelos
escrita a mano: la deriva de los `slices` del scoreboard, asi que cualquier modelo nuevo
aparece solo. El snapshot ya exportaba `calibration/<modelo>.json` para todo
`allModels()`.

### La calibración se mide dentro de un mismo tipo de evento

Regla de medición, no de presentación. El error de calibración de un modelo **no se puede
promediar entre tipos de evento distintos**, por dos razones:

1. No todos los modelos emiten sobre los mismos eventos. `ewmaVol` cubre magnitud y
   volatilidad; `volCal`, solo volatilidad. Promediar compara conjuntos distintos.
2. Unos eventos son intrínsecamente más fáciles de calibrar que otros. Magnitud sale
   0,0007 y volatilidad 0,006, un factor de 9 que no dice nada sobre el modelo.

Juntando ambas cosas, la media agrupada de `ewmaVol` (0,002308) sale *mejor* que la de
`volCal` (0,003776) solo porque la de `ewmaVol` está diluida con magnitud. Restringido a
volatilidad, `volCal` gana por un 38,5%. **La comparación agrupada invierte la
conclusión**, así que el panel ya no permite hacerla: obliga a elegir un tipo de evento.

### La descomposición del Brier estaba degenerada

`murphyDecomposition` agrupaba por probabilidad exacta (`probability.toFixed(10)`). Con un
modelo continuo cada predicción caía en su propio grupo, y entonces la fiabilidad tendía
al Brier y la resolución a la incertidumbre: para `ewmaVol` en VOL a 1 día daba una
fiabilidad de 0,1695 cuando la real, agrupando en bins, es 0,0032. Un factor de 54.

La identidad aritmética se cumplía, así que nada fallaba de forma visible; los números
simplemente no significaban nada. Ahora agrupa en los mismos 10 bins que la curva de
calibración, lo que además hace que las dos vistas del panel coincidan. Al binar aparece
un término residual, expuesto como `withinBinResidual`, de modo que la identidad sigue
siendo exacta y comprobable:

```
Brier = fiabilidad − resolución + incertidumbre + residuo
```

`brier.test.ts` fija esa identidad con pronósticos continuos y comprueba que la fiabilidad
coincide con la que se obtiene de los bins de la curva.

### Limitaciones conocidas

1. **Queda un bache en la banda 0,3-0,6**, con desvíos de +0,07 a +0,11. La corrección
   es una sola palanca que gira la curva completa: no puede arreglar un bulto local en
   el medio, y de hecho el bin 0,3-0,4 empeora (+0,0355 → +0,0665) al girar. Corregirlo
   exigiría una regresión isotónica o un ajuste por tramos, con el riesgo de sobreajuste
   que ya se ha visto en magnitud a 7 días.

2. ⚠️ **Sesgo de selección en los números de arriba.** La decisión de aplicar la
   recalibración *solo* a volatilidad se tomó **después** de ver estos resultados. Por
   tanto 0,1892 y 0,1967 son optimistas en una cantidad no medible: parte de esa mejora
   puede ser la elección del ganador sobre el propio examen. **La medición limpia de
   `volCal` son las predicciones emitidas a partir del 8 de septiembre de 2026, no este
   backtest.** Si se publican estas cifras, este párrafo va al lado.

3. **`computeCodeHash` no cubre las funciones auxiliares importadas.** Fichea
   `predict.toString()` más `key`, `version` y `params`. Un cambio en
   `calibration.ts`, `volPairs.ts` o `stats.ts` alteraría las probabilidades emitidas
   **sin** disparar el guard de deriva. Mitigación parcial actual: los parámetros
   ajustables (`lambda`, `minPairs`, `slopeLow`, `slopeHigh`, `slopeIterations`) sí
   están en `params` y por tanto sí entran en el hash. Pendiente: incluir el hash del
   código de los módulos auxiliares.

4. **Coste**: el backtest pasó de 11,0 s (98.032 observaciones) a 18,6 s (106.944
   observaciones). El ajuste de la pendiente se recalcula
   en cada emisión a partir del historial disponible en ese instante, que es lo que
   garantiza que no mire al futuro.

5. **La ventana de ajuste no reproduce las semanas con festivo.** Los pares de
   entrenamiento usan siempre exactamente `windowBars` retornos consecutivos, pero el
   resolvedor acepta ventanas de hasta `ceil(0.6 · windowBars)` barras
   (`minimumVolBars`). En renta variable, ETF e índices a 7 días, una semana con
   festivo se puntúa con una volatilidad realizada calculada sobre 3-4 barras, un caso
   que nunca aparece en el conjunto de ajuste. En cripto no ocurre (24/7). Los tests
   solo cubren cripto.

6. **Por debajo de 120 pares, `volCal` es idéntico a `ewmaVol`.** La pendiente cae al
   valor neutro y ambos emiten el mismo número bit a bit. Eso son unas 193 barras, y la
   emisión solo exige 67: un activo con poco historial produciría meses de predicciones
   duplicadas bajo dos `model_version`, que en el scoreboard se leen como dos modelos
   coincidiendo. En la práctica `promote` hace backfill de 3 años, así que el caso es
   raro.

7. **La t de Student sigue en `stats.ts`** (`studentTCdf`, `unitVarianceTScale`,
   `regularizedBetaI`) aunque ningún modelo activo la use, con sus tests. Está ahí para
   cuando se retome magnitud con más muestra. Si molesta, se borra sin afectar a nada.

### Garantía de no-fuga

El ajuste se alimenta solo de pares (probabilidad, desenlace) enteramente contenidos en
el historial anterior al slot: para un prefijo de `m` barras, el desenlace usa hasta la
barra `m + ventana - 1`, y el bucle se corta en `m ≤ n - ventana`. El test
*"los pares de un historial corto son prefijo de los del historial largo"* en
`volCal.test.ts` es la comprobación de esa propiedad.
