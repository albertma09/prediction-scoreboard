import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../data.service';
import type {
  CalibrationBin,
  CalibrationResponse,
  EmissionsResponse,
  LiveSlice,
  ScoreboardResponse,
  Slice,
} from '../api.types';

const DEFAULT_MODEL_ORDER: readonly string[] = ['volCal', 'ewmaVol', 'climatology', 'coinflip'];
const DEFAULT_COMPARE_ORDER: readonly string[] = ['ewmaVol', 'climatology', 'coinflip'];
const NO_COMPARE = '';
const SERIES_COLOR = '#4a9eff';
const COMPARE_COLOR = '#b083f0';
const CALIBRATION_EVENT_ORDER: readonly string[] = ['VOL', 'MAG', 'DIR'];
const EVENT_LABELS: Record<string, string> = {
  VOL: 'VOL · volatilidad',
  MAG: 'MAG · magnitud',
  DIR: 'DIR · dirección',
};

function binsFor(
  response: CalibrationResponse | null,
  eventType: string,
): CalibrationBin[] {
  if (response === null) {
    return [];
  }
  return response.byEvent?.[eventType] ?? [];
}

function pointsOf(bins: readonly CalibrationBin[]): string {
  return bins
    .map((bin) => `${40 + bin.meanForecast * 360},${380 - bin.observedFrequency * 360}`)
    .join(' ');
}

function reliabilityOf(bins: readonly CalibrationBin[]): number | null {
  let weighted = 0;
  let total = 0;

  for (const bin of bins) {
    const drift = bin.meanForecast - bin.observedFrequency;
    weighted += bin.count * drift * drift;
    total += bin.count;
  }

  return total === 0 ? null : weighted / total;
}

function radiusOf(bin: CalibrationBin, bins: readonly CalibrationBin[]): number {
  const maxCount = Math.max(...bins.map((item) => item.count), 1);
  return 3 + 7 * Math.sqrt(bin.count / maxCount);
}

@Component({
  selector: 'app-scoreboard',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h1>Scoreboard</h1>

    <div class="notice notice-strong">
      <strong>El track record real está vacío.</strong> Todavía no se ha emitido ninguna
      predicción al registro inmutable. Lo que ves abajo es un <strong>backtest</strong>: el mismo
      pipeline aplicado a datos históricos. Sirve para descartar modelos, no como historial.
    </div>

    <h2 style="margin-top: 1.5rem;">Track record del registro</h2>
    @if (live() && !live()!.available) {
      <div class="empty">
        Sin predicciones registradas. El scoreboard real empezará a llenarse cuando el cron de
        emisión arranque, y tardará semanas en ser estadísticamente interpretable.
      </div>
    }
    @if (live()?.available) {
      <div class="card scroll-x">
        <table>
          <thead>
            <tr>
              <th scope="col">Horizonte</th>
              <th scope="col">Evento</th>
              <th scope="col">Modelo</th>
              <th scope="col" class="num">Emitidas</th>
              <th scope="col" class="num">Puntuadas</th>
              <th scope="col" class="num">Nulas</th>
            </tr>
          </thead>
          <tbody>
            @for (row of live()!.slices; track row.eventKey + row.modelKey + row.horizon) {
              <tr>
                <td class="mono">{{ row.horizon }}</td>
                <td class="mono">{{ row.eventKey }}</td>
                <td>{{ row.modelKey }}</td>
                <td class="num">{{ row.emitted }}</td>
                <td class="num">{{ row.scored }}</td>
                <td class="num muted">{{ row.voided }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <h2 style="margin-top: 2rem;">
      Backtest <span class="badge badge-backtest">no es historial</span>
    </h2>

    @if (board(); as data) {
      @if (!data.available) {
        <div class="empty">No hay ningún backtest ejecutado.</div>
      } @else {
        <p class="muted">
          {{ data.observations }} observaciones puntuadas · {{ data.label }}
        </p>

        <div class="card">
          <div class="field-row">
            <span class="field">
              <label for="event">Filtrar por tipo de evento</label>
              <select id="event" [ngModel]="eventFilter()" (ngModelChange)="eventFilter.set($event)">
                <option value="">Todos</option>
                <option value="MAG">MAG · magnitud</option>
                <option value="VOL">VOL · volatilidad</option>
                <option value="DIR">DIR · dirección</option>
              </select>
            </span>

            <span class="field">
              <label for="decomposition">Descomposición del Brier</label>
              <button
                id="decomposition"
                type="button"
                class="toggle"
                [attr.aria-pressed]="showDecomposition()"
                (click)="showDecomposition.set(!showDecomposition())"
              >
                {{ showDecomposition() ? 'Ocultar ▾' : 'Mostrar ▸' }}
              </button>
            </span>
          </div>

          @if (showDecomposition()) {
            <p class="muted" style="font-size: 0.82rem;">
              <strong>Brier = fiabilidad − resolución + incertidumbre + residuo.</strong>
              La <strong>fiabilidad</strong> mide si el modelo es honesto: cuánto se desvía lo que
              promete de lo que ocurre, y cuanto más baja, mejor. La <strong>resolución</strong>
              mide si se atreve: cuánto se aleja de la tasa base sin dejar de acertar, y cuanto más
              alta, mejor. La <strong>incertidumbre</strong> no depende del modelo, solo del evento:
              es el listón que impone la propia tasa base, y es idéntica para todos los modelos de
              la misma fila.
            </p>
            <p class="muted" style="font-size: 0.82rem; margin-bottom: 0;">
              Un modelo puede bajar su Brier de dos maneras distintas —siendo más honesto o siendo
              más atrevido— y estas columnas dicen cuál de las dos hizo. El
              <strong>residuo</strong> es la parte que no captura el agrupamiento en
              {{ 10 }} bins; está para que puedas comprobar la identidad tú mismo, y si es grande
              significa que dentro de un mismo bin hay pronósticos muy dispares.
            </p>
          }
        </div>

        <div class="card scroll-x">
          <table>
            <caption class="dim" style="text-align: left; padding-bottom: 0.6rem;">
              <strong>BSS vs climatología</strong> es la columna que mide habilidad real. El BSS
              contra 0,5 puede ser enorme solo por conocer la tasa base.
            </caption>
            <thead>
              <tr>
                <th scope="col">Horiz.</th>
                <th scope="col">Evento</th>
                <th scope="col">Modelo</th>
                <th scope="col" class="num">N</th>
                <th scope="col" class="num">N efectiva</th>
                <th scope="col" class="num">Tasa base</th>
                <th scope="col" class="num">Brier</th>
                <th scope="col" class="num">BSS vs clim.</th>
                <th scope="col" class="num">BSS vs 0,5</th>
                <th scope="col">IC 95% (vs 0,5)</th>
                @if (showDecomposition()) {
                  <th scope="col" class="num">Fiabilidad</th>
                  <th scope="col" class="num">Resolución</th>
                  <th scope="col" class="num">Incertid.</th>
                  <th scope="col" class="num">Residuo</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (slice of filtered(); track sliceId(slice)) {
                <tr>
                  <td class="mono">{{ slice.horizon }}</td>
                  <td class="mono">{{ slice.eventKey }}</td>
                  <td>{{ slice.modelKey }}</td>
                  <td class="num">{{ slice.count }}</td>
                  <td class="num" [class.warn]="slice.effectiveObservations < 100">
                    {{ slice.effectiveObservations }}
                  </td>
                  <td class="num muted">{{ pct(slice.baseRate) }}</td>
                  <td class="num mono">{{ slice.modelBrier.toFixed(4) }}</td>
                  <td class="num mono" [class]="skillClass(slice.bssVsClimatology)">
                    {{ slice.bssVsClimatology === null ? '—' : slice.bssVsClimatology.toFixed(4) }}
                  </td>
                  <td class="num mono muted">{{ slice.bssVsCoinflip.toFixed(4) }}</td>
                  <td class="mono muted">
                    [{{ slice.bssVsCoinflipLower.toFixed(3) }},
                    {{ slice.bssVsCoinflipUpper.toFixed(3) }}]
                    @if (slice.crossesZero) {
                      <span class="badge badge-empty" style="margin-left: 0.3rem;">cruza 0</span>
                    }
                  </td>
                  @if (showDecomposition()) {
                    <td class="num mono">{{ slice.reliability.toFixed(6) }}</td>
                    <td class="num mono">{{ slice.resolution.toFixed(5) }}</td>
                    <td class="num mono muted">{{ slice.uncertainty.toFixed(5) }}</td>
                    <td class="num mono dim">{{ signed(slice.withinBinResidual) }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>

        <h2 style="margin-top: 2rem;">Curva de calibración</h2>
        <div class="card">
          <div class="field-row">
            <span class="field">
              <label for="cal-event">Tipo de evento</label>
              <select
                id="cal-event"
                [ngModel]="calibrationEvent()"
                (ngModelChange)="onCalibrationEvent($event)"
              >
                @for (key of calibrationEvents(); track key) {
                  <option [value]="key">{{ eventLabel(key) }}</option>
                }
              </select>
            </span>

            <span class="field">
              <label for="model">Modelo</label>
              <select id="model" [ngModel]="modelKey()" (ngModelChange)="onModel($event)">
                @for (key of availableModels(); track key) {
                  <option [value]="key">{{ key }}</option>
                }
              </select>
            </span>

            <span class="field">
              <label for="compare">Comparar con</label>
              <select id="compare" [ngModel]="compareKey()" (ngModelChange)="onCompare($event)">
                <option value="">Ninguno</option>
                @for (key of compareOptions(); track key) {
                  <option [value]="key">{{ key }}</option>
                }
              </select>
            </span>
          </div>

          <p class="notice" style="margin-top: 0.9rem;">
            La calibración se mide <strong>siempre dentro de un mismo tipo de evento</strong>.
            Mezclar magnitud con volatilidad da una media que no significa nada: no todos los
            modelos emiten sobre los mismos eventos, y unos eventos son intrínsecamente más
            difíciles de calibrar que otros. Comparar entre tipos distintos sería comparar peras
            con manzanas.
          </p>

          @if (reliability() !== null) {
            <div class="metric-row">
              <span class="metric">
                <span class="metric-label">
                  <span class="swatch" [style.background]="seriesColor"></span>
                  Error de calibración · {{ modelKey() }} · {{ calibrationEvent() }}
                </span>
                <strong class="mono">{{ reliability()!.toFixed(6) }}</strong>
              </span>

              @if (compareReliability() !== null) {
                <span class="metric">
                  <span class="metric-label">
                    <span class="swatch swatch-compare" [style.background]="compareColor"></span>
                    {{ compareKey() }}
                  </span>
                  <strong class="mono muted">{{ compareReliability()!.toFixed(6) }}</strong>
                </span>

                @if (reliabilityDelta(); as delta) {
                  <span class="metric">
                    <span class="metric-label">Diferencia</span>
                    <strong class="mono" [class]="delta < 0 ? 'good' : 'bad'">
                      {{ delta > 0 ? '+' : '' }}{{ (delta * 100).toFixed(1) }}%
                    </strong>
                  </span>
                }
              }
            </div>

            <p class="muted" style="font-size: 0.82rem;">
              El error de calibración es la media del desvío al cuadrado de cada bin, ponderada por
              su número de observaciones. Cuanto más bajo, más se parece lo que el modelo promete a
              lo que ocurre. No mide si acierta: mide si es honesto.
            </p>
          }

          @if (bins().length === 0) {
            <p class="muted" style="margin-top: 1rem;">Sin datos de calibración.</p>
          } @else {
            <div class="scroll-x" style="margin-top: 1rem;">
              <svg
                viewBox="0 0 420 420"
                width="420"
                height="420"
                role="img"
                [attr.aria-label]="calibrationSummary()"
              >
                <rect x="40" y="20" width="360" height="360" fill="#0e1116" stroke="#2d3542" />
                <line x1="40" y1="380" x2="400" y2="20" stroke="#6e7d8c" stroke-dasharray="4 4" />
                @for (tick of ticks; track tick) {
                  <line
                    [attr.x1]="40 + tick * 360"
                    y1="380"
                    [attr.x2]="40 + tick * 360"
                    y2="376"
                    stroke="#6e7d8c"
                  />
                  <text
                    [attr.x]="40 + tick * 360"
                    y="398"
                    fill="#9aa7b4"
                    font-size="10"
                    text-anchor="middle"
                  >
                    {{ tick.toFixed(1) }}
                  </text>
                  <line
                    x1="36"
                    [attr.y1]="380 - tick * 360"
                    x2="40"
                    [attr.y2]="380 - tick * 360"
                    stroke="#6e7d8c"
                  />
                  <text
                    x="32"
                    [attr.y]="384 - tick * 360"
                    fill="#9aa7b4"
                    font-size="10"
                    text-anchor="end"
                  >
                    {{ tick.toFixed(1) }}
                  </text>
                }
                @if (comparePolyline() !== '') {
                  <polyline
                    [attr.points]="comparePolyline()"
                    fill="none"
                    [attr.stroke]="compareColor"
                    stroke-width="2"
                    stroke-dasharray="6 4"
                  />
                  @for (bin of nonEmptyCompareBins(); track bin.lowerBound) {
                    <rect
                      [attr.x]="40 + bin.meanForecast * 360 - compareRadius(bin)"
                      [attr.y]="380 - bin.observedFrequency * 360 - compareRadius(bin)"
                      [attr.width]="compareRadius(bin) * 2"
                      [attr.height]="compareRadius(bin) * 2"
                      [attr.fill]="compareColor"
                      fill-opacity="0.6"
                    />
                  }
                }

                <polyline
                  [attr.points]="polyline()"
                  fill="none"
                  [attr.stroke]="seriesColor"
                  stroke-width="2"
                />
                @for (bin of nonEmptyBins(); track bin.lowerBound) {
                  <circle
                    [attr.cx]="40 + bin.meanForecast * 360"
                    [attr.cy]="380 - bin.observedFrequency * 360"
                    [attr.r]="radius(bin)"
                    [attr.fill]="seriesColor"
                    fill-opacity="0.75"
                  />
                }
                <text x="220" y="415" fill="#9aa7b4" font-size="11" text-anchor="middle">
                  probabilidad predicha
                </text>
              </svg>
            </div>

            <p class="muted" style="font-size: 0.82rem;">
              La diagonal es la calibración perfecta. Un punto por debajo significa que el modelo
              promete más de lo que ocurre. El tamaño del punto es proporcional al número de
              observaciones del bin. En la tabla, el <strong>desvío</strong> es lo que promete
              menos lo que ocurre: <strong>positivo significa exceso de confianza</strong>, el
              mismo signo que usa el informe de <code>npm run backtest</code>.
              @if (compareKey() !== '') {
                <span>
                  {{ modelKey() }} son los <strong>círculos de línea continua</strong>;
                  {{ compareKey() }}, los <strong>cuadrados de línea discontinua</strong>.
                </span>
              }
            </p>

            <div class="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Bin</th>
                    <th scope="col" class="num">N</th>
                    <th scope="col" class="num">Promete</th>
                    <th scope="col" class="num">Ocurre</th>
                    <th scope="col" class="num">Desvío</th>
                    @if (compareKey() !== '') {
                      <th scope="col" class="num">Desvío · {{ compareKey() }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of binRows(); track row.bin.lowerBound) {
                    <tr>
                      <td class="mono">
                        {{ row.bin.lowerBound.toFixed(1) }}–{{ row.bin.upperBound.toFixed(1) }}
                      </td>
                      <td class="num">{{ row.bin.count }}</td>
                      <td class="num mono">{{ row.bin.meanForecast.toFixed(4) }}</td>
                      <td class="num mono">{{ row.bin.observedFrequency.toFixed(4) }}</td>
                      <td class="num" [class]="driftClass(row.drift)">
                        {{ signed(row.drift) }}
                      </td>
                      @if (compareKey() !== '') {
                        <td class="num muted mono">
                          {{ row.compareDrift === null ? '—' : signed(row.compareDrift) }}
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      }
    } @else {
      <p class="muted">Cargando…</p>
    }
  `,
})
export class ScoreboardComponent {
  private readonly data = inject(DataService);

  readonly ticks = [0, 0.2, 0.4, 0.6, 0.8, 1];
  readonly board = signal<ScoreboardResponse | null>(null);
  readonly live = signal<{ available: boolean; slices: LiveSlice[] } | null>(null);
  readonly calibrationData = signal<CalibrationResponse | null>(null);
  readonly compareData = signal<CalibrationResponse | null>(null);
  readonly calibrationEvent = signal('VOL');
  readonly modelKey = signal('volCal');
  readonly compareKey = signal(NO_COMPARE);
  readonly eventFilter = signal('');
  readonly showDecomposition = signal(false);
  readonly seriesColor = SERIES_COLOR;
  readonly compareColor = COMPARE_COLOR;

  readonly filtered = computed(() => {
    const slices = this.board()?.slices ?? [];
    const filter = this.eventFilter();
    return filter === '' ? slices : slices.filter((slice) => slice.eventType === filter);
  });

  readonly availableModels = computed(() => {
    const keys = new Set((this.board()?.slices ?? []).map((slice) => slice.modelKey));
    return keys.size === 0 ? [this.modelKey()] : [...keys].sort();
  });

  readonly bins = computed(() => binsFor(this.calibrationData(), this.calibrationEvent()));

  readonly compareBins = computed(() =>
    binsFor(this.compareData(), this.calibrationEvent()),
  );

  readonly calibrationEvents = computed(() => {
    const available = Object.keys(this.calibrationData()?.byEvent ?? {});
    return CALIBRATION_EVENT_ORDER.filter((key) => available.includes(key));
  });

  readonly nonEmptyBins = computed(() => this.bins().filter((bin) => bin.count > 0));

  readonly nonEmptyCompareBins = computed(() =>
    this.compareBins().filter((bin) => bin.count > 0),
  );

  readonly compareOptions = computed(() => {
    const eventType = this.calibrationEvent();
    const keys = new Set(
      (this.board()?.slices ?? [])
        .filter((slice) => slice.eventType === eventType)
        .map((slice) => slice.modelKey),
    );
    return [...keys].filter((key) => key !== this.modelKey()).sort();
  });

  readonly reliability = computed(() => reliabilityOf(this.nonEmptyBins()));

  readonly compareReliability = computed(() => reliabilityOf(this.nonEmptyCompareBins()));

  readonly reliabilityDelta = computed(() => {
    const own = this.reliability();
    const other = this.compareReliability();
    if (own === null || other === null || other === 0) {
      return null;
    }
    return (own - other) / other;
  });

  readonly binRows = computed(() => {
    const compare = new Map(this.compareBins().map((bin) => [bin.lowerBound, bin]));
    return this.nonEmptyBins().map((bin) => {
      const other = compare.get(bin.lowerBound);
      return {
        bin,
        drift: bin.meanForecast - bin.observedFrequency,
        compareDrift:
          other === undefined || other.count === 0
            ? null
            : other.meanForecast - other.observedFrequency,
      };
    });
  });

  readonly polyline = computed(() => pointsOf(this.nonEmptyBins()));

  readonly comparePolyline = computed(() => pointsOf(this.nonEmptyCompareBins()));

  readonly calibrationSummary = computed(() => {
    const bins = this.nonEmptyBins();
    if (bins.length === 0) {
      return 'Curva de calibración sin datos';
    }
    const worst = bins.reduce((accumulator, bin) =>
      Math.abs(bin.meanForecast - bin.observedFrequency) >
      Math.abs(accumulator.meanForecast - accumulator.observedFrequency)
        ? bin
        : accumulator,
    );
    const own = this.reliability();
    const other = this.compareReliability();
    const comparison =
      this.compareKey() === NO_COMPARE || other === null || own === null
        ? ''
        : ` Comparado con ${this.compareKey()}, cuyo error de calibración es ${other.toFixed(6)} ` +
          `frente a ${own.toFixed(6)}.`;

    return (
      `Curva de calibración de ${this.modelKey()} en eventos ${this.calibrationEvent()}, ` +
      `con ${bins.length} bins. ` +
      `El mayor desvío está en el bin ${worst.lowerBound.toFixed(1)} a ${worst.upperBound.toFixed(1)}: ` +
      `predice ${worst.meanForecast.toFixed(2)} y se observa ${worst.observedFrequency.toFixed(2)}.` +
      comparison
    );
  });

  constructor() {
    this.data.scoreboard().subscribe({
      next: (response) => {
        this.board.set(response);
        this.selectInitialModel();
      },
      error: () => {
        this.board.set({ source: 'backtest', available: false, slices: [] });
        this.loadCalibration(this.modelKey());
      },
    });

    this.data.liveScoreboard().subscribe({
      next: (response) =>
        this.live.set({ available: response.available, slices: response.slices }),
      error: () => this.live.set({ available: false, slices: [] }),
    });

  }

  private selectInitialModel(): void {
    const available = this.availableModels();
    const chosen =
      DEFAULT_MODEL_ORDER.find((key) => available.includes(key)) ??
      available[0] ??
      this.modelKey();
    this.modelKey.set(chosen);
    this.loadCalibration(chosen);

  }

  onModel(value: string): void {
    this.modelKey.set(value);
    this.loadCalibration(value);
  }

  onCalibrationEvent(value: string): void {
    this.calibrationEvent.set(value);
    this.syncCompare();
  }

  onCompare(value: string): void {
    this.compareKey.set(value);

    if (value === NO_COMPARE) {
      this.compareData.set(null);
      return;
    }

    this.data.calibration(value).subscribe({
      next: (response) => this.compareData.set(response),
      error: () => this.compareData.set(null),
    });
  }

  eventLabel(key: string): string {
    return EVENT_LABELS[key] ?? key;
  }

  private loadCalibration(modelKey: string): void {
    this.data.calibration(modelKey).subscribe({
      next: (response) => {
        this.calibrationData.set(response);

        const available = Object.keys(response.byEvent ?? {});
        if (!available.includes(this.calibrationEvent())) {
          const preferred = CALIBRATION_EVENT_ORDER.find((key) => available.includes(key));
          if (preferred !== undefined) {
            this.calibrationEvent.set(preferred);
          }
        }

        this.syncCompare();
      },
      error: () => this.calibrationData.set(null),
    });
  }

  private syncCompare(): void {
    const options = this.compareOptions();
    const current = this.compareKey();

    if (current !== NO_COMPARE && options.includes(current)) {
      return;
    }

    const preferred = DEFAULT_COMPARE_ORDER.find((key) => options.includes(key));
    this.onCompare(preferred ?? NO_COMPARE);
  }

  sliceId(slice: Slice): string {
    return `${slice.horizon}|${slice.eventKey}|${slice.modelKey}`;
  }

  pct(value: number): string {
    return `${(value * 100).toFixed(2)}%`;
  }

  skillClass(value: number | null): string {
    if (value === null) {
      return 'muted';
    }
    if (value > 0.02) {
      return 'good';
    }
    if (value < -0.02) {
      return 'bad';
    }
    return 'muted';
  }

  radius(bin: CalibrationBin): number {
    return radiusOf(bin, this.nonEmptyBins());
  }

  compareRadius(bin: CalibrationBin): number {
    return radiusOf(bin, this.nonEmptyCompareBins());
  }

  signed(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(4)}`;
  }

  driftClass(value: number): string {
    return Math.abs(value) > 0.05 ? 'bad' : 'mono';
  }
}
