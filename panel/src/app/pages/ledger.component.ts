import { Component, inject, signal } from '@angular/core';
import { DataService } from '../data.service';
import type { LedgerVerifyResponse } from '../api.types';

@Component({
  selector: 'app-ledger',
  standalone: true,
  template: `
    <h1>Registro inmutable</h1>
    <p class="muted">
      Cada predicción se sella con <span class="mono">sha256(payload)</span> y se encadena con
      <span class="mono">sha256(hash_anterior + hash_contenido)</span> antes de que el evento
      ocurra. Cualquier modificación posterior rompe la cadena y se detecta.
    </p>

    @if (report(); as data) {
      <div class="card">
        <h2>Estado de la cadena</h2>

        <p aria-live="polite">
          @if (data.ok) {
            <span class="badge badge-tracked">CADENA INTACTA</span>
          } @else {
            <span class="badge" style="color: var(--bad); border-color: var(--bad);">
              CADENA ROTA · {{ data.breaks.length }} incidencias
            </span>
          }
        </p>

        <dl class="grid">
          <dt>Predicciones encadenadas</dt>
          <dd class="mono">{{ data.checked }}</dd>

          <dt>Cabecera declarada</dt>
          <dd class="mono break">{{ data.declaredHead }}</dd>

          <dt>Cabecera recalculada</dt>
          <dd class="mono break">{{ data.recomputedHead }}</dd>
        </dl>

        @if (data.checked === 0) {
          <div class="notice">
            La cadena está en su hash génesis: 64 ceros. Todavía no se ha registrado ninguna
            predicción, así que no hay nada que verificar más allá de que la cabecera es correcta.
          </div>
        }
      </div>

      @if (data.breaks.length > 0) {
        <div class="card scroll-x">
          <h2>Incidencias detectadas</h2>
          <table>
            <thead>
              <tr>
                <th scope="col">Tipo</th>
                <th scope="col">Predicción</th>
                <th scope="col">Campo</th>
                <th scope="col">Detalle</th>
              </tr>
            </thead>
            <tbody>
              @for (issue of data.breaks; track issue.kind + issue.predictionId + issue.field) {
                <tr>
                  <td class="mono bad">{{ issue.kind }}</td>
                  <td class="mono">{{ issue.predictionId ?? 'cabecera' }}</td>
                  <td class="mono">{{ issue.field ?? '—' }}</td>
                  <td>{{ issue.detail }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <div class="card">
        <h2>Qué detecta y qué no</h2>
        <div class="scroll-x">
          <table>
            <thead>
              <tr>
                <th scope="col">Manipulación</th>
                <th scope="col">Se detecta como</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Payload alterado</td>
                <td class="mono">content_hash_mismatch</td>
              </tr>
              <tr>
                <td>Payload y su hash recalculados</td>
                <td class="mono">chain_hash_mismatch</td>
              </tr>
              <tr>
                <td>Fila entera recalculada</td>
                <td class="mono">prev_hash_mismatch</td>
              </tr>
              <tr>
                <td>Fila eliminada o reordenada</td>
                <td class="mono">prev_hash_mismatch</td>
              </tr>
              <tr>
                <td>Fila borrada del final</td>
                <td class="mono">head_mismatch · count_mismatch</td>
              </tr>
              <tr>
                <td>Columna reescrita sin tocar el payload</td>
                <td class="mono">column_mismatch</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="notice" style="margin-top: 1rem;">
          <strong>Límite conocido.</strong> Los triggers de base de datos frenan a la aplicación,
          no a un superusuario de PostgreSQL. Frente a un superusuario la cadena garantiza
          <strong>detección</strong>, no prevención. Para que sea demostrable ante un tercero hace
          falta anclar el hash de cabecera en un servicio de fecha externo, y eso todavía no está
          hecho.
        </div>
      </div>
    } @else if (error()) {
      <div class="notice notice-strong">{{ error() }}</div>
    } @else {
      <p class="muted">Verificando la cadena…</p>
    }
  `,
  styles: [
    `
      .grid {
        display: grid;
        grid-template-columns: minmax(11rem, auto) 1fr;
        gap: 0.4rem 1rem;
        margin: 0.75rem 0 0;
        font-size: 0.9rem;
      }

      dt {
        color: var(--muted);
      }

      dd {
        margin: 0;
      }

      .break {
        overflow-wrap: anywhere;
      }

      @media (max-width: 30rem) {
        .grid {
          grid-template-columns: 1fr;
          gap: 0.1rem 0;
        }

        dd {
          margin-bottom: 0.5rem;
        }
      }
    `,
  ],
})
export class LedgerComponent {
  private readonly data = inject(DataService);

  readonly report = signal<LedgerVerifyResponse | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    this.data.verifyLedger().subscribe({
      next: (response) => this.report.set(response),
      error: () => this.error.set('No se pudo verificar la cadena. ¿Está arrancada la API?'),
    });
  }
}
