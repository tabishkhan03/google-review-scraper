import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import ReviewScraper from './scrape.js';

const app = express();
const port = process.env.PORT || 8080;
const cacheTtlHours = parseInt(process.env.CACHE_TTL_HOURS || '6', 10);
const cache = new Map();

// Parse proxies from environment variable
const proxies = process.env.PROXIES ? process.env.PROXIES.split(',').map(p => p.trim()) : [];
const scraper = new ReviewScraper(proxies);

app.use(cors());

// Cleanup on exit
process.on('SIGINT', async () => {
  await scraper.close();
  process.exit(0);
});

// GET /reviews
app.get('/reviews', async (req, res) => {
  const { place_id, force } = req.query;

  if (!place_id) {
    return res.status(400).json({ error: 'place_id is required' });
  }

  try {
    // Use cache if available
    if (force !== 'true') {
      const cached = cache.get(place_id);
      if (cached) {
        const age = Date.now() - cached.timestamp;
        const maxAge = cacheTtlHours * 60 * 60 * 1000;
        if (age < maxAge) {
          console.log(`Serving from cache: ${place_id}`);
          return res.json(cached.data);
        }
      }
    }

    console.log(`Scraping reviews for: ${place_id}`);
    const data = await scraper.scrapeReviews(place_id);
    cache.set(place_id, { data, timestamp: Date.now() });
    res.json(data);

  } catch (error) {
    console.error('Error scraping reviews:', error);
    res.status(500).json({ error: 'Failed to scrape reviews' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});