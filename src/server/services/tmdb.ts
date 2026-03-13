const BASE = 'https://api.themoviedb.org/3';

export interface TmdbShow {
  id: number;
  name: string;
  poster_path: string | null;
  first_air_date: string;
  overview: string;
  popularity: number;
}

interface TmdbPage {
  results: TmdbShow[];
  total_pages: number;
  page: number;
}

const DECADE_RANGES: Record<string, [string, string]> = {
  '50s': ['1950-01-01', '1959-12-31'],
  '60s': ['1960-01-01', '1969-12-31'],
  '70s': ['1970-01-01', '1979-12-31'],
  '80s': ['1980-01-01', '1989-12-31'],
  '90s': ['1990-01-01', '1999-12-31'],
  '00s': ['2000-01-01', '2009-12-31'],
  '10s': ['2010-01-01', '2019-12-31'],
};

export async function fetchShowsByDecades(decades: string[]): Promise<TmdbShow[]> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error('TMDB_API_KEY not set');

  const validDecades = decades.filter(d => DECADE_RANGES[d]);
  if (validDecades.length === 0) throw new Error('No valid decades provided');

  const dates = validDecades.map(d => DECADE_RANGES[d]);
  const minDate = dates.map(d => d[0]).sort()[0];
  const maxDate = dates.map(d => d[1]).sort().at(-1)!;

  const all: TmdbShow[] = [];
  let page = 1;
  const maxPages = 3; // ~60 results

  while (page <= maxPages) {
    const params = new URLSearchParams({
      api_key: apiKey,
      language: 'en-US',
      sort_by: 'popularity.desc',
      'first_air_date.gte': minDate,
      'first_air_date.lte': maxDate,
      page: String(page),
    });

    const res = await fetch(`${BASE}/discover/tv?${params}`);
    if (!res.ok) throw new Error(`TMDB error: ${res.status}`);
    const data: TmdbPage = await res.json();
    all.push(...data.results);

    if (page >= data.total_pages) break;
    page++;
  }

  // Filter to only shows that actually fall in the requested decades
  return all.filter(show => {
    if (!show.first_air_date) return false;
    return validDecades.some(d => {
      const [gte, lte] = DECADE_RANGES[d];
      return show.first_air_date >= gte && show.first_air_date <= lte;
    });
  });
}

export function posterUrl(path: string | null): string {
  if (!path) return '';
  return `https://image.tmdb.org/t/p/w342${path}`;
}
