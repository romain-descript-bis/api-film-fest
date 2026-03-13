import { Router } from 'express';
import { fetchShowsByDecades, posterUrl } from '../services/tmdb.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const decadesParam = req.query.decades as string;
    if (!decadesParam) {
      res.status(400).json({ error: 'decades query param required' });
      return;
    }
    const decades = decadesParam.split(',').map(d => d.trim());
    console.log(`[shows] fetching TMDB for decades: ${decades.join(', ')}`);
    const shows = await fetchShowsByDecades(decades);
    console.log(`[shows] got ${shows.length} results`);

    res.json(shows.map(s => ({
      id: s.id,
      name: s.name,
      posterUrl: posterUrl(s.poster_path),
      firstAirDate: s.first_air_date,
      overview: s.overview,
    })));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
