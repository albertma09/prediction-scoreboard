import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DataService } from '../data.service';
import type {
  CalibrationBin,
  EmissionsResponse,
  LiveSlice,
  ScoreboardResponse,
  Slice,
} from '../api.types';

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
          <label for="event">Filtrar por tipo de evento</label>
          <select id="event" [ngModel]="eventFilter()" (ngModelChange)="eventFilter.set($event)">
            <option value="">Todos</option>
            <option value="MAG">MAG · magnitud</option>
            <option value="VOL">VOL · volatilidad</option>
            <option value="DIR">DIR · dirección</option>
          </select>
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
                </tr>
              }
            </tbody>
          </table>
        </div>

        <h2 style="margin-top: 2rem;">Curva de calibración</h2>
        <div class="card">
          <label for="model">Modelo</label>
          <select id="model" [ngModel]="modelKey()" (ngModelChange)="onModel($event)">
            <option value="ewmaVol">ewmaVol</option>
            <option value="climatology">climatology</option>
            <option value="coinflip">coinflip</option>
          </select>

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
                <polyline
                  [attr.points]="polyline()"
                  fill="none"
                  stroke="#4a9eff"
                  stroke-width="2"
                />
                @for (bin of nonEmptyBins(); track bin.lowerBound) {
                  <circle
                    [attr.cx]="40 + bin.meanForecast * 360"
                    [attr.cy]="380 - bin.observedFrequency * 360"
                    [attr.r]="radius(bin)"
                    fill="#4a9eff"
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
              observaciones del bin.
            </p>

            <div class="scroll-x">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Bin</th>
                    <th scope="col" class="num">N</th>
                    <th scope="col" class="num">Predicho</th>
                    <th scope="col" class="num">Observado</th>
                    <th scope="col" class="num">Desvío</th>
                  </tr>
                </thead>
                <tbody>
                  @for (bin of nonEmptyBins(); track bin.lowerBound) {
                    <tr>
                      <td class="mono">
                        {{ bin.lowerBound.toFixed(1) }}–{{ bin.upperBound.toFixed(1) }}
                      </td>
                      <td class="num">{{ bin.count }}</td>
                      <td class="num mono">{{ bin.meanForecast.toFixed(4) }}</td>
                      <td class="num mono">{{ bin.observedFrequency.toFixed(4) }}</td>
                      <td
                        class="num mono"
                        [class.bad]="bin.observedFrequency - bin.meanForecast < -0.05"
                      >
                        {{ (bin.observedFrequency - bin.meanForecast).toFixed(4) }}
                      </td>
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
  readonly bins = signal<CalibrationBin[]>([]);
  readonly modelKey = signal('ewmaVol');
  readonly eventFilter = signal('');

  readonly filtered = computed(() => {
    const slices = this.board()?.slices ?? [];
    const filter = this.eventFilter();
    return filter === '' ? slices : slices.filter((slice) => slice.eventType === filter);
  });

  readonly nonEmptyBins = computed(() => this.bins().filter((bin) => bin.count > 0));

  readonly polyline = computed(() =>
    this.nonEmptyBins()
      .map((bin) => `${40 + bin.meanForecast * 360},${380 - bin.observedFrequency * 360}`)
      .join(' '),
  );

  readonly calibrationSummary = computed(() => {
    const bins = this.nonEmptyBins();
    if (bins.length === 0) {
      return 'Curva de calibración sin datos';
    }
    const worst = bins.reduce((accumulator, bin) =>
      bin.observedFrequency - bin.meanForecast < accumulator.observedFrequency - accumulator.meanForecast
        ? bin
        : accumulator,
    );
    return (
      `Curva de calibración de ${this.modelKey()} con ${bins.length} bins. ` +
      `El mayor desvío está en el bin ${worst.lowerBound.toFixed(1)} a ${worst.upperBound.toFixed(1)}: ` +
      `predice ${worst.meanForecast.toFixed(2)} y se observa ${worst.observedFrequency.toFixed(2)}.`
    );
  });

  constructor() {
    this.data.scoreboard().subscribe({
      next: (response) => this.board.set(response),
      error: () => this.board.set({ source: 'backtest', available: false, slices: [] }),
    });

    this.data.liveScoreboard().subscribe({
      next: (response) =>
        this.live.set({ available: response.available, slices: response.slices }),
      error: () => this.live.set({ available: false, slices: [] }),
    });

    this.loadCalibration('ewmaVol');
  }

  onModel(value: string): void {
    this.modelKey.set(value);
    this.loadCalibration(value);
  }

  private loadCalibration(modelKey: string): void {
    this.data.calibration(modelKey).subscribe({
      next: (response) => this.bins.set(response.bins),
      error: () => this.bins.set([]),
    });
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
    const maxCount = Math.max(...this.nonEmptyBins().map((item) => item.count), 1);
    return 3 + 7 * Math.sqrt(bin.count / maxCount);
  }
}
