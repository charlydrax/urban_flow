'use client';

import type {
  SourceDiagnostics,
  SourceDiagnosticsPlace,
  SourceDiagnosticsResponse,
} from '@urbanflow/shared';
import { useState } from 'react';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardTitle } from '../../components/ui/card';
import { InputField } from '../../components/ui/input-field';
import { apiClient, ApiError } from '../../lib/api-client';
import { useSession } from '../auth/session-provider';
import { useSearchHistory } from '../planner/use-search-history';

/**
 * Scénario nominal des diagrammes UML — le trajet de référence du projet.
 * Pré-rempli pour qu'une vérification tienne en un clic : le geste attendu ici
 * est « est-ce que ça répond ? », pas une saisie.
 */
const NOMINAL_TRIP = {
  from: { label: 'Gare Part-Dieu', lat: '45.760515', lng: '4.859057' },
  to: { label: 'Bellecour', lat: '45.757813', lng: '4.832011' },
};

/** Les trois sources, dans l'ordre du flux de référence. */
const SOURCE_LABELS = {
  transit: 'Transports en commun — GTFS / OpenTripPlanner',
  sharedMobility: 'Libre-service — GBFS',
  cyclePaths: 'Tronçons cyclables — PostGIS',
} as const;

/** Une extrémité en cours de saisie : les coordonnées restent du texte tant qu'on tape. */
interface DraftPlace {
  label: string;
  lat: string;
  lng: string;
}

/**
 * Convertit une extrémité saisie en extrémité envoyable.
 * Rend `null` si une coordonnée n'est pas un nombre : l'API refuserait de toute
 * façon en `400`, autant ne pas faire l'aller-retour (C5).
 */
function toPlace(draft: DraftPlace): SourceDiagnosticsPlace | null {
  const lat = Number(draft.lat);
  const lng = Number(draft.lng);
  if (!draft.label.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { label: draft.label.trim(), lat, lng };
}

/**
 * Résumé lisible d'une source, pour ne pas avoir à lire le JSON dans le cas
 * courant. Volontairement court : le détail exhaustif est un cran plus loin,
 * dans le bloc dépliable.
 */
function digest(response: SourceDiagnosticsResponse, source: keyof typeof SOURCE_LABELS): string {
  if (source === 'transit') {
    const data = response.sources.transit.data;
    if (!data) return 'aucune donnée';
    return `${data.journeys.length} trajet(s) — journée d'exploitation ${data.serviceDate}${
      data.dateAdjusted ? ' (recalée)' : ''
    }`;
  }

  if (source === 'sharedMobility') {
    const data = response.sources.sharedMobility.data;
    if (!data) return 'aucune donnée';
    return `${data.origin.stations.length} station(s) au départ, ${data.destination.stations.length} à l'arrivée`;
  }

  const data = response.sources.cyclePaths.data;
  if (!data) return 'aucune donnée';
  return `${data.origin.segments.length} tronçon(s) au départ, ${data.destination.segments.length} à l'arrivée`;
}

/**
 * Écran de diagnostic des sources (UF-306) — `/dev/sources`.
 *
 * ## Ce qu'il est, et ce qu'il n'est pas
 *
 * C'est un **outil de développement**, pas un écran produit : il rend visible
 * ce que les trois connecteurs ont réellement répondu, avant que la fusion du
 * Sprint 4 ne le transforme en itinéraires. Le ticket demande explicitement de
 * ne pas y investir de temps de design — d'où la réutilisation stricte des
 * composants du design system (UF-007), sans maquette dédiée.
 *
 * ## Pourquoi un résumé *puis* le JSON
 *
 * La charge brute d'une collecte lyonnaise pèse plusieurs centaines de
 * kilo-octets (les tracés des tronçons cyclables surtout). L'afficher d'emblée
 * rendrait la page illisible et coûteuse à peindre. Chaque source montre donc
 * une ligne de synthèse, et son détail complet dans un `<details>` replié :
 * l'information reste accessible, mais on ne la paie qu'en la demandant (C5).
 *
 * ## Accessibilité (C7)
 *
 * Le résultat arrive après un appel réseau, hors du flux de lecture : la zone
 * de résultats est donc une région `aria-live="polite"`, pour qu'un lecteur
 * d'écran annonce l'arrivée du diagnostic sans interrompre la saisie en cours.
 */
export function SourceTester() {
  const { status } = useSession();
  const { entries } = useSearchHistory(status === 'authenticated');

  const [from, setFrom] = useState<DraftPlace>(NOMINAL_TRIP.from);
  const [to, setTo] = useState<DraftPlace>(NOMINAL_TRIP.to);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SourceDiagnosticsResponse | null>(null);

  /**
   * Lance un diagnostic.
   *
   * `searchHistoryId` et les extrémités saisies sont exclusifs : rejouer une
   * recherche enregistrée sonde exactement le trajet demandé par l'usager, ce
   * qu'une re-saisie approchée ne reproduirait pas.
   */
  async function run(searchHistoryId?: string) {
    setPending(true);
    setError(null);

    try {
      if (searchHistoryId) {
        setResult(await apiClient.testRouteSources({ searchHistoryId }));
        return;
      }

      const payload = { from: toPlace(from), to: toPlace(to) };
      if (!payload.from || !payload.to) {
        setError('Chaque extrémité a besoin d’un libellé et de coordonnées numériques.');
        return;
      }
      setResult(await apiClient.testRouteSources({ from: payload.from, to: payload.to }));
    } catch (caught) {
      // Le 404 mérite son propre message : ici, il ne veut presque jamais dire
      // « introuvable », mais « endpoint fermé sur cet environnement ».
      if (caught instanceof ApiError && caught.status === 404) {
        setError(
          'Endpoint indisponible (404) : il est désactivé hors développement, ou la recherche rejouée n’est pas dans votre historique.',
        );
      } else {
        setError(caught instanceof Error ? caught.message : 'Le diagnostic a échoué.');
      }
      setResult(null);
    } finally {
      setPending(false);
    }
  }

  /** Trois champs pour une extrémité — label, latitude, longitude. */
  function endpointFields(legend: string, draft: DraftPlace, setDraft: (next: DraftPlace) => void) {
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-bold text-ink">{legend}</legend>
        <InputField
          label="Libellé"
          value={draft.label}
          onChange={(event) => setDraft({ ...draft, label: event.target.value })}
        />
        <div className="flex gap-2">
          <InputField
            className="flex-1"
            label="Latitude"
            inputMode="decimal"
            value={draft.lat}
            onChange={(event) => setDraft({ ...draft, lat: event.target.value })}
          />
          <InputField
            className="flex-1"
            label="Longitude"
            inputMode="decimal"
            value={draft.lng}
            onChange={(event) => setDraft({ ...draft, lng: event.target.value })}
          />
        </div>
      </fieldset>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <CardTitle as="h2">Trajet à sonder</CardTitle>

        <div className="grid gap-4 sm:grid-cols-2">
          {endpointFields('Départ', from, setFrom)}
          {endpointFields('Arrivée', to, setTo)}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void run()} disabled={pending}>
            {pending ? 'Collecte en cours…' : 'Interroger les trois sources'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFrom(NOMINAL_TRIP.from);
              setTo(NOMINAL_TRIP.to);
            }}
          >
            Rétablir Part-Dieu → Bellecour
          </Button>
        </div>

        {entries.length > 0 && (
          <section aria-labelledby="replay-title" className="flex flex-col gap-1.5">
            <h3 id="replay-title" className="text-xs font-semibold text-ink-500">
              Rejouer une recherche enregistrée (UF-204)
            </h3>
            <ul className="flex flex-col gap-1">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void run(entry.id)}
                    aria-label={`Sonder les sources pour le trajet ${entry.from.label} vers ${entry.to.label}`}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2.5 text-left text-[13px] text-ink hover:bg-tint-blue focus-visible:bg-tint-blue disabled:text-ink-500"
                  >
                    <span aria-hidden="true" className="shrink-0 text-ink-500">
                      ↩
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {entry.from.label} → {entry.to.label}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </Card>

      <div aria-live="polite" className="flex flex-col gap-4">
        {error && (
          <Card className="border-error bg-tint-red">
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          </Card>
        )}

        {result && <DiagnosticsReport result={result} />}
      </div>
    </div>
  );
}

/** Rapport d'une collecte : l'en-tête, puis une carte par source. */
function DiagnosticsReport({ result }: { result: SourceDiagnosticsResponse }) {
  const slowest = Math.max(
    result.sources.transit.elapsedMs,
    result.sources.sharedMobility.elapsedMs,
    result.sources.cyclePaths.elapsedMs,
  );
  const sequential =
    result.sources.transit.elapsedMs +
    result.sources.sharedMobility.elapsedMs +
    result.sources.cyclePaths.elapsedMs;

  return (
    <>
      <Card className="flex flex-col gap-2">
        <CardTitle as="h2">
          Collecte en {result.elapsedMs} ms
          {result.allSourcesFailed && ' — aucune source disponible'}
        </CardTitle>

        {/*
          Le chiffre qui compte : la collecte doit durer à peu près la source la
          plus lente. Si elle approchait la somme des trois, les appels seraient
          en cascade — exactement ce que C10 interdit.
        */}
        <p className="text-[13px] text-ink-700">
          Source la plus lente : {slowest} ms — en cascade, il aurait fallu {sequential} ms.
        </p>
        <p className="text-[13px] text-ink-500">
          Trajet : {result.query.from.label} → {result.query.to.label}
          {result.query.replayedSearchHistoryId && ' (recherche rejouée)'} · accessibilité
          PMR&nbsp;: {result.preferences.reducedMobility ? 'activée' : 'désactivée'} ·{' '}
          {result.collectedAt}
        </p>
      </Card>

      {(Object.keys(SOURCE_LABELS) as (keyof typeof SOURCE_LABELS)[]).map((source) => (
        <SourceCard
          key={source}
          title={SOURCE_LABELS[source]}
          summary={digest(result, source)}
          diagnostics={result.sources[source]}
        />
      ))}
    </>
  );
}

/** Une source : son état, sa durée, son résumé, et son JSON brut sur demande. */
function SourceCard({
  title,
  summary,
  diagnostics,
}: {
  title: string;
  summary: string;
  diagnostics: SourceDiagnostics<unknown>;
}) {
  const ok = diagnostics.status === 'ok';

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle as="h3">{title}</CardTitle>
        <Badge tone={ok ? 'success' : 'alert'}>
          {ok ? '✓ Disponible' : '✕ Indisponible'} · {diagnostics.elapsedMs} ms
        </Badge>
      </div>

      <p className="text-[13px] text-ink-700">{ok ? summary : 'Aucune donnée collectée.'}</p>

      {diagnostics.failure && (
        <p className="text-[13px] text-error">
          Cause ({diagnostics.failure.kind}) : {diagnostics.failure.reason}
        </p>
      )}

      {diagnostics.data !== null && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-semibold text-action-dark">
            Données brutes
          </summary>
          {/* `overflow-auto` et non un retour à la ligne : un JSON replié sur
              lui-même est illisible, et la page ne doit pas défiler
              horizontalement sur mobile (C2). */}
          <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-surface-muted p-3 text-xs">
            {JSON.stringify(diagnostics.data, null, 2)}
          </pre>
        </details>
      )}
    </Card>
  );
}
