import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <a class="skip" href="#main">Ir al contenido</a>

    <header class="topbar">
      <div class="wrap topbar-inner">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">◈</span>
          <span>Prediction Scoreboard</span>
        </div>
        <nav aria-label="Secciones">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
            Buscar
          </a>
          <a routerLink="/catalogo" routerLinkActive="active">Catálogo</a>
          <a routerLink="/scoreboard" routerLinkActive="active">Scoreboard</a>
          <a routerLink="/ledger" routerLinkActive="active">Registro</a>
        </nav>
      </div>
    </header>

    <main id="main" class="wrap">
      <router-outlet />
    </main>

    <footer class="wrap footer">
      <p>
        Herramienta de <strong>medición</strong>. No ejecuta operaciones, no mueve dinero y no
        constituye asesoramiento de inversión. Las probabilidades publicadas son estimaciones de
        modelos y se puntúan contra baselines explícitos.
      </p>
      <p class="dim">
        Rendimiento pasado o medido no implica rendimiento futuro. Un backtest no es un historial.
      </p>
    </footer>
  `,
  styles: [
    `
      .skip {
        position: absolute;
        left: -9999px;
        top: 0;
        background: var(--accent);
        color: #08131f;
        padding: 0.5rem 0.9rem;
        z-index: 10;
        font-weight: 600;
      }

      .skip:focus {
        left: 0.5rem;
        top: 0.5rem;
      }

      .wrap {
        max-width: 1180px;
        margin: 0 auto;
        padding: 0 1rem;
      }

      .topbar {
        border-bottom: 1px solid var(--border);
        background: var(--panel);
        position: sticky;
        top: 0;
        z-index: 5;
      }

      .topbar-inner {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem 1.5rem;
        align-items: center;
        justify-content: space-between;
        padding-top: 0.7rem;
        padding-bottom: 0.7rem;
      }

      .brand {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      .brand-mark {
        color: var(--accent);
        font-size: 1.15rem;
      }

      nav {
        display: flex;
        gap: 0.35rem;
        flex-wrap: wrap;
      }

      nav a {
        padding: 0.35rem 0.7rem;
        border-radius: var(--radius);
        color: var(--muted);
        font-size: 0.9rem;
        font-weight: 550;
      }

      nav a:hover {
        color: var(--text);
        background: var(--panel-2);
        text-decoration: none;
      }

      nav a.active {
        color: var(--text);
        background: var(--panel-2);
        box-shadow: inset 0 0 0 1px var(--border);
      }

      main {
        padding-top: 1.5rem;
        padding-bottom: 2rem;
        min-height: 60vh;
      }

      .footer {
        border-top: 1px solid var(--border);
        padding-top: 1.25rem;
        padding-bottom: 2rem;
        font-size: 0.82rem;
        color: var(--muted);
      }
    `,
  ],
})
export class AppComponent {}
