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
  }

  async initialize() {
    const proxy = this.proxyRotator.getNextProxy();
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ];
    if (proxy) {
      args.push(`--proxy-server=${proxy}`);
    }

    this.browser = await puppeteer.launch({
      headless: 'new',
      args
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
      // Click only buttons with aria-expanded="false" that indicate a collapsed "More" section
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button[aria-expanded="false"]'));
        buttons.forEach(btn => {
          const text = btn.textContent.trim();
          if (text === 'More' || text === 'Read more' || text === '… More') {
            btn.click();
          }
        });
      });
      await delay(1500); // wait for content to expand
    } catch (err) {
      console.log('Error expanding More buttons:', err.message);
    }
  }

  async extractNewReviews(page) {
    return await page.evaluate(() => {
      const reviews = [];
      const elements = document.querySelectorAll('div[data-review-id]');
      
      for (const el of elements) {
        const id = el.getAttribute('data-review-id');
        const name = el.querySelector('.d4r55, .TSUbDb')?.textContent.trim() || 'Unknown';
        const rating = el.querySelector('[aria-label*="stars"]')?.getAttribute('aria-label') || '0 stars';
        const content = el.querySelector('.wiI7pd, .MyEned, .review-full-text')?.textContent.trim() || '';
        const dateText = el.querySelector('[aria-label*="ago"]')?.getAttribute('aria-label') || '';
        reviews.push({ id, name, rating, content, dateText });
      }
      return reviews;
    });
  }

  parseDate(dateText) {
    const now = new Date();
    if (!dateText) return now.toISOString();

    const match = dateText.match(/(\d+)\s(\w+)/);
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
      const parsed = new Date(dateText);
      if (!isNaN(parsed)) return parsed.toISOString();
    }
    return now.toISOString();
  }

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
        await page.setViewport({ width: 1920, height: 1080 });

        try {
          console.log(`Navigating to place ID: ${placeId} (Attempt ${attempt + 1}/${maxRetries})`);
          await page.goto(`https://www.google.com/maps/place/?q=place_id:${placeId}`, {
            waitUntil: ['networkidle0', 'domcontentloaded'],
            timeout: 60000
          });
          await delay(5000);

          const storeName = await page.evaluate(() => {
            const nameEl = document.querySelector('h1');
            return nameEl ? nameEl.textContent.trim() : 'Unknown Store';
          });
          console.log(`Found store: ${storeName}`);

          // Click the Reviews button
          const reviewSelectors = [
            'button[aria-label*="Reviews"]',
            'button[data-tab-index="1"]',
            'button[jsaction*="pane.reviewChart.moreReviews"]'
          ];
          let found = false;
          for (const sel of reviewSelectors) {
            if (await this.waitForElement(page, sel)) {
              await page.click(sel);
              found = true;
              break;
            }
          }
          if (!found) throw new Error('Could not find the Reviews button');

          await delay(3000);

          // Sort by newest
          const sortButton = 'button[aria-label*="Sort"]';
          if (await this.waitForElement(page, sortButton)) {
            await page.click(sortButton);
            await delay(1000);
            const options = await page.$$('div[role="menuitemradio"]');
            for (const opt of options) {
              const text = await opt.evaluate(el => el.textContent);
              if (text.includes('Newest')) {
                await opt.click();
                break;
              }
            }
          }

          await delay(2000);

          // Start infinite scroll and expand all "More" buttons on every scroll
          const reviewMap = new Map();
          let triesWithoutNew = 0;
          const maxTries = 10;

          console.log('Starting scroll loop...');
          while (triesWithoutNew < maxTries) {
            await this.scrollReviewContainer(page);
            await delay(1500);

            // Expand only collapsed "More" buttons efficiently
            await this.expandAllMoreButtons(page);

            // Extract reviews with expanded content
            const newBatch = await this.extractNewReviews(page);
            let newCount = 0;
            for (const r of newBatch) {
              if (!reviewMap.has(r.id)) {
                reviewMap.set(r.id, {
                  reviewer: r.name,
                  rating: r.rating,
                  content: r.content,
                  dateIso: this.parseDate(r.dateText)
                });
                newCount++;
              }
            }

            if (newCount === 0) {
              triesWithoutNew++;
              console.log(`No new reviews. ${triesWithoutNew}/${maxTries}`);
            } else {
              console.log(`Fetched ${newCount} new reviews. Total: ${reviewMap.size}`);
              triesWithoutNew = 0;
            }
          }

          console.log('Finished scrolling and extracting reviews.');

          const reviews = Array.from(reviewMap.values()).sort(
            (a, b) => new Date(b.dateIso) - new Date(a.dateIso)
          );

          return {
            store: storeName,
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
