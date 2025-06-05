# Google Review Scraper

A powerful and efficient Google Maps review scraper built with Node.js, Express, and Puppeteer. This tool allows you to scrape reviews from Google Maps places and store them in MongoDB for analysis and caching.

## Features

- Scrape reviews from any Google Maps place using its place_id
- Automatic caching of reviews in MongoDB
- Configurable cache TTL (Time To Live)
- Proxy support for avoiding rate limits
- Review statistics and analytics
- RESTful API endpoints
- CORS enabled for cross-origin requests
- Docker support for easy deployment

## Prerequisites

- Node.js >= 20.0.0
- MongoDB (local or remote)
- Google Maps place_id of the location you want to scrape
- Docker (optional, for containerized deployment)

## Installation

### Option 1: Local Installation

1. Clone the repository:
```bash
git clone https://github.com/tabishkhan03/google-review-scraper.git
cd google-review-scraper
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```env
PORT=8080
MONGODB_URI=mongodb://localhost:27017/google-reviews
CACHE_TTL_HOURS=6
PROXIES=proxy1.example.com:8080,proxy2.example.com:8080  # Optional
```

4. Start the server:
```bash
npm start
```

The server will start on the specified port (default: 8080).



### Option 2: Docker Installation

1. Clone the repository:
```bash
docker pull tabishkhan03/google-review-scraper
```

2. Build and run the Docker container:
```bash
# Build the Docker image
docker build -t google-review-scraper .

# Run the container
docker run -d \
  --name google-review-scraper \
  -p 8080:8080 \
  -p 27017:27017 \
  -v $(pwd)/.env:/usr/src/app/.env \
  -v mongodb_data:/data/db \
  google-review-scraper
```

The application will be available at `http://localhost:8080`.


### API Endpoints

#### 1. Get Reviews
```
GET /reviews?place_id=<place_id>&force=true
```
- `place_id`: (Required) Google Maps place ID
- `force`: (Optional) Set to 'true' to force refresh the cache

Response:
```json
{
  "placeId": "string",
  "placeName": "string",
  "lastScraped": "date",
  "reviews": [
    {
      "author": "string",
      "rating": number,
      "text": "string",
      "dateIso": "date",
      "relativeTime": "string"
    }
  ]
}
```


## Finding Google Maps Place ID

1. Go to Google Maps
2. Search for the place you want to scrape
3. Click on the place to open its details
4. The place_id is in the URL after "place_id=" parameter
   Example: `https://www.google.com/maps/place/?q=place_id:ChIJ...`

## Configuration

### Environment Variables

- `PORT`: Server port (default: 8080)
- `MONGODB_URI`: MongoDB connection string
- `CACHE_TTL_HOURS`: Cache duration in hours (default: 6)
- `PROXIES`: Comma-separated list of proxy servers (optional)

### Cache Behavior

- Reviews are cached in MongoDB for the duration specified by `CACHE_TTL_HOURS`
- Use `force=true` parameter to bypass cache and fetch fresh data
- Cache is automatically updated when new reviews are scraped

## Error Handling

The API returns appropriate HTTP status codes and error messages:
- 400: Bad Request (missing required parameters)
- 404: Not Found (no reviews found for place_id)
- 500: Internal Server Error (scraping or database errors)

## Security Considerations

- Use proxies to avoid IP-based rate limiting
- Implement rate limiting on your API endpoints
- Secure your MongoDB instance
- Use environment variables for sensitive configuration

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Docker Commands

### View Logs
```bash
docker logs google-review-scraper
```

### Stop Container
```bash
docker stop google-review-scraper
```

### Start Container
```bash
docker start google-review-scraper
```

### Remove Container
```bash
docker rm -f google-review-scraper
```

### Rebuild and Update
```bash
docker build -t google-review-scraper .
docker rm -f google-review-scraper
docker run -d \
  --name google-review-scraper \
  -p 8080:8080 \
  -p 27017:27017 \
  -v $(pwd)/.env:/usr/src/app/.env \
  -v mongodb_data:/data/db \
  google-review-scraper
``` 