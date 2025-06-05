import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class ProxyRotator {
  constructor(proxies) {
    this.proxies = Array.isArray(proxies) ? proxies : [proxies].filter(Boolean);
    this.currentIndex = 0;
  }

  getNextProxy() {
    if (this.proxies.length === 0) return null;
    const proxy = this.proxies[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    return proxy;
  }
}

class ReviewScraper {
  constructor(proxies) {
    this.proxyRotator = new ProxyRotator(proxies);
    this.xhrReviews = new Map();
    this.placeName = '';
  }

  async initialize() {
    const proxy = this.proxyRotator.getNextProxy();
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080'
    ];
    if (proxy) {
      args.push(`--proxy-server=${proxy}`);
    }

    this.browser = await puppeteer.launch({
      headless: 'new',
      args,
      defaultViewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async waitForElement(page, selector, timeout = 60000) {
    try {
      await page.waitForSelector(selector, { timeout });
      return true;
    } catch {
      return false;
    }
  }

  // Setup XHR interception
  async setupXHRInterception(page) {
    // Block unnecessary resources
    await page.setRequestInterception(true);
    
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Optimize response handling
    page.on('response', async (response) => {
      try {
        const url = response.url();
        
        // Only process review-related responses
        if (url.includes('search?tbm=map') || 
            url.includes('listugcposts') || 
            url.includes('preview/review') ||
            url.includes('ludocids') ||
            (url.includes('maps/api') && url.includes('reviews'))) {
          
          const responseText = await response.text();
          this.parseXHRResponse(responseText);
        }
      } catch (error) {
        // Silently handle parsing errors
      }
    });

    // Set page performance optimizations
    await page.setCacheEnabled(true);
    await page.setDefaultNavigationTimeout(30000);
    await page.setDefaultTimeout(30000);
  }

  // Parse XHR response for review data
  parseXHRResponse(responseText) {
    try {
      // Handle different response formats
      let data;
      
      // Try to parse as JSON first
      try {
        data = JSON.parse(responseText);
      } catch {
        // Handle JSONP or other formats
        const jsonMatch = responseText.match(/(\[.*\])/);
        if (jsonMatch) {
          data = JSON.parse(jsonMatch[1]);
        } else {
          return;
        }
      }

      this.extractReviewsFromData(data);
    } catch (error) {
      // Continue silently if parsing fails
    }
  }

  // Extract reviews from various data structures
  extractReviewsFromData(data) {
    const traverse = (obj) => {
      if (!obj) return;
      
      if (Array.isArray(obj)) {
        obj.forEach(traverse);
      } else if (typeof obj === 'object') {
        // Look for review-like structures
        if (this.isReviewObject(obj)) {
          const review = this.parseReviewObject(obj);
          if (review && review.id) {
            this.xhrReviews.set(review.id, review);
          }
        }
        
        // Continue traversing
        Object.values(obj).forEach(traverse);
      }
    };
    
    traverse(data);
  }

  // Check if object looks like a review
  isReviewObject(obj) {
    const hasReviewFields = (
      (obj.hasOwnProperty('rating') || obj.hasOwnProperty('stars')) &&
      (obj.hasOwnProperty('text') || obj.hasOwnProperty('comment') || obj.hasOwnProperty('review')) &&
      (obj.hasOwnProperty('author') || obj.hasOwnProperty('reviewer') || obj.hasOwnProperty('name'))
    );
    
    const hasReviewArray = Array.isArray(obj) && obj.length > 3 && 
      typeof obj[0] === 'string' && typeof obj[1] === 'number';
    
    return hasReviewFields || hasReviewArray;
  }

  // Parse review object into standard format
  parseReviewObject(obj) {
    try {
      let reviewer = '';
      let rating = 0;
      let content = '';
      let dateIso = new Date().toISOString();
      let id = '';

      if (Array.isArray(obj)) {
        // Handle array format [reviewer, rating, content, date, ...]
        reviewer = obj[0] || '';
        rating = obj[1] || 0;
        content = obj[2] || '';
        if (obj[3]) dateIso = this.parseDate(obj[3]);
        id = this.generateReviewId(reviewer, content, rating);
      } else {
        // Handle object format
        reviewer = obj.author || obj.reviewer || obj.name || '';
        rating = obj.rating || obj.stars || 0;
        content = obj.text || obj.comment || obj.review || '';
        
        if (obj.date || obj.timestamp) {
          dateIso = this.parseDate(obj.date || obj.timestamp);
        }
        
        id = obj.id || this.generateReviewId(reviewer, content, rating);
      }

      return {
        id,
        reviewer: reviewer.toString(),
        rating: this.parseRating(rating),
        content: content.toString(),
        dateIso
      };
    } catch {
      return null;
    }
  }

  // Generate unique ID for review
  generateReviewId(reviewer, content, rating) {
    return Buffer.from(`${reviewer}-${content.substring(0, 50)}-${rating}`).toString('base64');
  }

  // Parse rating from different formats
  parseRating(ratingData) {
    if (typeof ratingData === 'number') return Math.max(0, Math.min(5, ratingData));
    if (typeof ratingData === 'string') {
      const match = ratingData.match(/(\d+)/);
      return match ? Math.max(0, Math.min(5, parseInt(match[1]))) : 0;
    }
    return 0;
  }

  // Parse date from timestamp or relative text
  parseDate(dateData) {
    if (!dateData) return new Date().toISOString();
    
    // If it's a timestamp (seconds or milliseconds)
    if (typeof dateData === 'number') {
      const timestamp = dateData > 1e10 ? dateData : dateData * 1000;
      return new Date(timestamp).toISOString();
    }
    
    // If it's relative text like "2 weeks ago"
    if (typeof dateData === 'string') {
      const now = new Date();
      const match = dateData.match(/(\d+)\s*(\w+)/);
      if (match) {
        const number = parseInt(match[1]);
        const unit = match[2].toLowerCase();
        switch (unit) {
          case 'second':
          case 'seconds': now.setSeconds(now.getSeconds() - number); break;
          case 'minute':
          case 'minutes': now.setMinutes(now.getMinutes() - number); break;
          case 'hour':
          case 'hours': now.setHours(now.getHours() - number); break;
          case 'day':
          case 'days': now.setDate(now.getDate() - number); break;
          case 'week':
          case 'weeks': now.setDate(now.getDate() - number * 7); break;
          case 'month':
          case 'months': now.setMonth(now.getMonth() - number); break;
          case 'year':
          case 'years': now.setFullYear(now.getFullYear() - number); break;
        }
      } else {
        // Try direct date parsing
        const parsed = new Date(dateData);
        if (!isNaN(parsed)) return parsed.toISOString();
      }
      return now.toISOString();
    }
    
    return new Date().toISOString();
  }

  // DOM extraction fallback method
  async scrollReviewContainer(page) {
    await page.evaluate(() => {
      const scrollableDiv = document.querySelector('.m6QErb.DxyBCb.kA9KIf.dS8AEf');
      if (scrollableDiv) {
        scrollableDiv.scrollBy(0, 500);
      }
    });
  }

  async expandAllMoreButtons(page) {
    try {
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button[aria-expanded="false"]'));
        buttons.forEach(btn => {
          const text = btn.textContent.trim();
          if (text === 'More' || text === 'Read more' || text === '… More') {
            btn.click();
          }
        });
      });
      await delay(1500);
    } catch (err) {
      console.log('Error expanding More buttons:', err.message);
    }
  }

  async extractReviewsFromDOM(page) {
    return await page.evaluate(() => {
      const reviews = [];
      const elements = document.querySelectorAll('div[data-review-id]');
      
      for (const el of elements) {
        const id = el.getAttribute('data-review-id');
        const name = el.querySelector('.d4r55, .TSUbDb')?.textContent.trim() || 'Unknown';
        const rating = el.querySelector('[aria-label*="stars"]')?.getAttribute('aria-label') || '0 stars';
        const content = el.querySelector('.wiI7pd, .MyEned, .review-full-text')?.textContent.trim() || '';
        const dateText = el.querySelector('[aria-label*="ago"]')?.getAttribute('aria-label') || '';
        
        reviews.push({ 
          id, 
          reviewer: name, 
          rating, 
          content, 
          dateText 
        });
      }
      return reviews;
    });
  }

  // Main scraping method with XHR + DOM fallback
  async scrapeReviews(placeId) {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (this.browser) {
          await this.close();
        }
        await this.initialize();

        const page = await this.browser.newPage();
        
        // Setup XHR interception
        await this.setupXHRInterception(page);
        this.xhrReviews.clear();

        try {
          console.log(`Navigating to place ID: ${placeId} (Attempt ${attempt + 1}/${maxRetries})`);
          await page.goto(`https://www.google.com/maps/place/?q=place_id:${placeId}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });
          await delay(2000);

          // Get place name
          this.placeName = await page.evaluate(() => {
            const nameEl = document.querySelector('h1');
            return nameEl ? nameEl.textContent.trim() : 'Unknown Place';
          });
          console.log(`Found place: ${this.placeName}`);

          // Click the Reviews button with optimized selector
          const reviewButton = await page.waitForSelector('button[aria-label*="Reviews"], button[data-tab-index="1"]', { timeout: 10000 });
          if (reviewButton) {
            await reviewButton.click();
            await delay(1000);
          } else {
            throw new Error('Could not find the Reviews button');
          }

          // Try to sort by newest with multiple approaches
          try {
            // First attempt: Direct sort button click
            const sortButton = await page.waitForSelector('button[aria-label*="Sort"]', { timeout: 5000 });
            if (sortButton) {
              await sortButton.click();
              await delay(1000);

              // Try multiple selectors for the newest option
              const sortSelectors = [
                'div[role="menuitemradio"]:has-text("Newest")',
                'div[role="menuitemradio"]',
                'div[aria-label*="Newest"]',
                'div[jsaction*="sort"]'
              ];

              let sorted = false;
              for (const selector of sortSelectors) {
                try {
                  const options = await page.$$(selector);
                  for (const option of options) {
                    const text = await option.evaluate(el => el.textContent);
                    if (text.toLowerCase().includes('newest')) {
                      await option.click();
                      sorted = true;
                      break;
                    }
                  }
                  if (sorted) break;
                } catch (err) {
                  continue;
                }
              }

              if (!sorted) {
                console.log('Could not find sort option, continuing without sorting...');
              }
            }
          } catch (sortError) {
            console.log('Sorting failed, continuing without sorting:', sortError.message);
          }

          await delay(2000);

          // Optimized review collection
          const reviewMap = new Map();
          let triesWithoutNew = 0;
          const maxTries = 10;
          const scrollDelay = 1000;

          console.log('Starting optimized data collection...');
          
          while (triesWithoutNew < maxTries) {
            // Parallel operations
            await Promise.all([
              this.scrollReviewContainer(page),
              this.expandAllMoreButtons(page)
            ]);
            
            await delay(scrollDelay);
            
            // Process XHR reviews
            let newCount = 0;
            for (const [id, review] of this.xhrReviews) {
              if (!reviewMap.has(id)) {
                reviewMap.set(id, review);
                newCount++;
              }
            }

            // Fallback to DOM extraction if needed
            if (this.xhrReviews.size === 0 || newCount === 0) {
              const domReviews = await this.extractReviewsFromDOM(page);
              for (const r of domReviews) {
                if (!reviewMap.has(r.id)) {
                  reviewMap.set(r.id, {
                    id: r.id,
                    reviewer: r.reviewer,
                    rating: this.parseRating(r.rating),
                    content: r.content,
                    dateIso: this.parseDate(r.dateText)
                  });
                  newCount++;
                }
              }
            }

            if (newCount === 0) {
              triesWithoutNew++;
              console.log(`No new reviews found. ${triesWithoutNew}/${maxTries}`);
            } else {
              console.log(`Collected ${newCount} new reviews. Total: ${reviewMap.size}`);
              triesWithoutNew = 0;
            }
          }

          // Process and return results
          const reviews = Array.from(reviewMap.values())
            .sort((a, b) => new Date(b.dateIso) - new Date(a.dateIso))
            .map(review => ({
              reviewer: review.reviewer,
              rating: review.rating,
              content: review.content,
              dateIso: review.dateIso
            }));

          return {
            place_id: placeId,
            place_name: this.placeName,
            lastScraped: new Date().toISOString(),
            reviews
          };

        } catch (err) {
          console.error('Scraping failed:', err);
          throw new Error(`Scraping error: ${err.message}`);
        } finally {
          await page.close();
        }
      } catch (err) {
        console.error(`Attempt ${attempt + 1}/${maxRetries} failed:`, err);
        lastError = err;
      }
    }

    throw new Error(`All attempts failed. Last error: ${lastError.message}`);
  }
}

export default ReviewScraper;