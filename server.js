import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import ReviewScraper from './scrape.js';
import Review from './models/Review.js';

const app = express();
const port = process.env.PORT || 8080;
const cacheTtlHours = parseInt(process.env.CACHE_TTL_HOURS || '6', 10);

// Parse proxies from environment variable
const proxies = process.env.PROXIES ? process.env.PROXIES.split(',').map(p => p.trim()) : [];
const scraper = new ReviewScraper(proxies);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/google-reviews')
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

app.use(cors());

// Cleanup on exit
process.on('SIGINT', async () => {
  await scraper.close();
  await mongoose.connection.close();
  process.exit(0);
});

// GET /reviews
app.get('/reviews', async (req, res) => {
  const { place_id, force } = req.query;

  if (!place_id) {
    return res.status(400).json({ error: 'place_id is required' });
  }

  try {
    // Check MongoDB for existing reviews if not forcing refresh
    if (force !== 'true') {
      const existingPlace = await Review.findOne({ placeId: place_id });
      
      if (existingPlace) {
        const age = Date.now() - existingPlace.lastScraped.getTime();
        const maxAge = cacheTtlHours * 60 * 60 * 1000;
        
        if (age < maxAge) {
          console.log(`Serving from MongoDB cache: ${place_id}`);
          
          // Sort reviews by newest first
          const sortedReviews = existingPlace.reviews.sort(
            (a, b) => new Date(b.dateIso) - new Date(a.dateIso)
          );
          
          return res.json({
            placeId: existingPlace.placeId,
            placeName: existingPlace.placeName,
            lastScraped: existingPlace.lastScraped,
            reviews: sortedReviews
          });
        }
      }
    }

    console.log(`Scraping reviews for: ${place_id}`);
    const data = await scraper.scrapeReviews(place_id);
    
    // Store/Update reviews in MongoDB as single document
    if (data.reviews && data.reviews.length > 0) {
      // Sort reviews by newest first before storing
      const sortedReviews = data.reviews.sort(
        (a, b) => new Date(b.dateIso) - new Date(a.dateIso)
      );

      await Review.findOneAndUpdate(
        { placeId: place_id },
        {
          $set: {
            placeId: place_id,
            placeName: data.place_name,
            reviews: sortedReviews,
            lastScraped: new Date(data.lastScraped)
          }
        },
        { 
          upsert: true, 
          new: true,
          runValidators: true
        }
      );

      console.log(`Stored ${sortedReviews.length} reviews in MongoDB for place: ${data.place_name}`);
    }

    // Return the scraped data
    res.json({
      placeId: data.place_id,
      placeName: data.place_name,
      lastScraped: data.lastScraped,
      reviews: data.reviews.sort((a, b) => new Date(b.dateIso) - new Date(a.dateIso))
    });

  } catch (error) {
    console.error('Error scraping reviews:', error);
    res.status(500).json({ 
      error: 'Failed to scrape reviews',
      message: error.message 
    });
  }
});

// GET /reviews/stats - Get review statistics for a place
app.get('/reviews/stats', async (req, res) => {
  const { place_id } = req.query;

  if (!place_id) {
    return res.status(400).json({ error: 'place_id is required' });
  }

  try {
    const place = await Review.findOne({ placeId: place_id });

    if (!place || !place.reviews || place.reviews.length === 0) {
      return res.status(404).json({ error: 'No reviews found for this place_id' });
    }

    const reviews = place.reviews;
    const totalReviews = reviews.length;
    const averageRating = reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews;
    
    // Calculate rating distribution
    const ratingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    reviews.forEach(review => {
      ratingCounts[review.rating] = (ratingCounts[review.rating] || 0) + 1;
    });

    // Get date range
    const sortedByDate = reviews.sort((a, b) => new Date(a.dateIso) - new Date(b.dateIso));
    const oldestReview = sortedByDate[0]?.dateIso;
    const newestReview = sortedByDate[sortedByDate.length - 1]?.dateIso;

    res.json({
      placeId: place.placeId,
      placeName: place.placeName,
      totalReviews: totalReviews,
      averageRating: Math.round(averageRating * 10) / 10,
      ratingDistribution: ratingCounts,
      oldestReview: oldestReview,
      newestReview: newestReview,
      lastScraped: place.lastScraped
    });

  } catch (error) {
    console.error('Error getting review stats:', error);
    res.status(500).json({ 
      error: 'Failed to get review statistics',
      message: error.message 
    });
  }
});

// GET /reviews/all - Get all places with their review counts
app.get('/reviews/all', async (req, res) => {
  try {
    const places = await Review.find({}, {
      placeId: 1,
      placeName: 1,
      lastScraped: 1,
      reviewCount: { $size: '$reviews' }
    }).sort({ lastScraped: -1 });

    const summary = places.map(place => ({
      placeId: place.placeId,
      placeName: place.placeName,
      reviewCount: place.reviews ? place.reviews.length : 0,
      lastScraped: place.lastScraped
    }));

    res.json({
      totalPlaces: places.length,
      places: summary
    });

  } catch (error) {
    console.error('Error getting all places:', error);
    res.status(500).json({ 
      error: 'Failed to get places list',
      message: error.message 
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Cache TTL: ${cacheTtlHours} hours`);
  console.log(`Proxies configured: ${proxies.length > 0 ? proxies.length : 'None'}`);
});