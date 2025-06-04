# Google Maps Review Scraper

A Node.js application that scrapes Google Maps reviews using Puppeteer and exposes them through a REST API.

## Features

- Scrapes Google Maps reviews using Puppeteer with stealth mode
- Caches results in memory with configurable TTL
- Exposes reviews through a simple REST API
- Works on Windows 10 with Node.js v20+
- No Docker or cloud setup required

## Prerequisites

- Node.js v20 or higher
- Windows 10

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and adjust settings if needed:
   ```bash
   copy .env.example .env
   ```

## Configuration

Edit `.env` to configure:

- `PORT`: Server port (default: 8080)
- `CACHE_TTL_HOURS`: Cache duration in hours (default: 6)
- `PROXY`: Optional proxy server (e.g., http://localhost:8080)

## Usage

Start the server:
```bash
npm start
```

### API Endpoint

GET `/reviews?place_id=<PLACE_ID>&force=true|false`

Parameters:
- `place_id`: Google Maps place ID (required)
- `force`: Set to "true" to bypass cache (optional)

Example:
```
http://localhost:8080/reviews?place_id=ChIJN1t_tDeuEmsRUsoyG83frY4&force=false
```

Response format:
```json
{
  "store": "Business Name",
  "lastScraped": "2025-06-03T10:00:00Z",
  "reviews": [
    {
      "reviewer": "Jane Doe",
      "rating": "5 stars",
      "dateIso": "2025-05-30T00:00:00Z",
      "content": "Friendly staff and clean facility."
    }
  ]
}
```

## Notes

- The scraper uses Puppeteer in headless mode with stealth plugin to avoid detection
- Reviews are sorted by newest first
- The cache is stored in memory and cleared when the server restarts
- The scraper performs infinite scrolling to load all available reviews 