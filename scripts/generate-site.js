const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build-recovery');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(srcDir, destDir) {
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function toOutputAssetPath(assetPath, pathPrefix = '') {
  return `${pathPrefix}${assetPath.replace(/^\//, '')}`;
}

function getBannerForPage(page, banners) {
  if (!page || !banners) {
    return null;
  }

  const candidates = [page.bannerSlug, page.slug === 'index' ? 'home' : null, page.slug];
  for (const key of candidates) {
    if (key && banners[key]) {
      return banners[key];
    }
  }

  return null;
}

function renderLayout(title, description, content, site, nav, canonicalUrl, config, banner, pathPrefix = '') {
  const devBanner = config.previewMode
    ? `<section class="dev-banner"><strong>${config.previewMessage}</strong><br />${config.previewSubmessage}</section>`
    : '';
  const bannerTitle = banner ? banner.title || title : title;
  const bannerSubtitle = banner ? banner.subtitle || '' : '';
  const bannerAlt = banner && banner.alt ? banner.alt : bannerTitle;
  const bannerIdAttr = banner && banner.bannerId ? ` data-banner-id="${banner.bannerId}"` : '';
  const bannerImage = banner && banner.image
    ? `<img class="page-banner-image" src="${pathPrefix}${banner.image}" alt="${bannerAlt}"${bannerIdAttr} />`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} | ${site.siteName}</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${canonicalUrl}" />
    <link rel="stylesheet" href="${pathPrefix}styles.css" />
  </head>
  <body>
    ${devBanner}
    <header class="site-header">
      <div class="brand">${site.siteName}</div>
      <nav class="site-nav" aria-label="Primary navigation">
        ${nav.items.map((item) => `<a href="${pathPrefix}${item.href}">${item.label}</a>`).join('')}
      </nav>
    </header>

    <main class="page-shell">
      ${bannerTitle ? `<section class="page-banner">${bannerImage}<div class="page-banner-copy"><h1>${bannerTitle}</h1>${bannerSubtitle ? `<p>${bannerSubtitle}</p>` : ''}</div></section>` : ''}
      ${content}
    </main>

    <footer class="site-footer">
      <p>${site.footerText}</p>
    </footer>
  </body>
</html>`;
}

function renderLandingPage(page, site, nav, config, banner) {
  return renderLayout(
    page.title,
    site.tagline,
    `<section class="hero-card">
      <p class="eyebrow">Welcome to</p>
      <h1>${site.siteName}</h1>
      <p>Hawkins Hollow is a place where stories gather, children find their first favorites, and every path leads toward a warm welcome.</p>
      <a class="button" href="storybook-shelf.html">Visit the Storybook Shelf</a>
    </section>

    <section class="content-card">
      <h2>Begin your visit</h2>
      <p>Start with the stories, step into the world, and discover the books that make Hawkins Hollow feel like home.</p>
    </section>`,
    site,
    nav,
    `${site.domain}/`,
    config,
    banner
  );
}

function renderArticlePage(page, site, nav, config, banner) {
  if (page.slug === 'books') {
    return renderLayout(
      page.title,
      'Every Hawkins Hollow story belongs somewhere in a larger journey. Some books are perfect for bedtime, some help beginning readers gain confidence, and others offer comfort during difficult moments. Browse the collections below and discover the stories that fit your family best.',
      `<section class="content-card" aria-labelledby="books-introduction">
      <h2 id="books-introduction">Books</h2>
      <p>Every Hawkins Hollow story belongs somewhere in a larger journey. Some books are perfect for bedtime, some help beginning readers gain confidence, and others offer comfort during difficult moments. Browse the collections below and discover the stories that fit your family best.</p>
    </section>

    <section class="content-card" aria-labelledby="books-series">
      <h2 id="books-series">Browse the Collections</h2>
      <div class="start-here-grid">
        <article class="start-here-item">
          <h3>Storybooks</h3>
          <p>Our flagship illustrated storybooks that introduce children to Hawkins Hollow through gentle stories, memorable characters, and everyday adventures.</p>
          <a class="button" href="storybook-shelf.html">Explore Storybooks</a>
        </article>

        <article class="start-here-item">
          <h3>First Readers</h3>
          <p>Simple stories written for children beginning to read independently.</p>
          <p class="status-label">Coming Soon</p>
        </article>

        <article class="start-here-item">
          <h3>Second Readers</h3>
          <p>Longer stories for growing readers ready for richer adventures and conversations.</p>
          <p class="status-label">Coming Soon</p>
        </article>

        <article class="start-here-item">
          <h3>Bedtime Library</h3>
          <p>Gentle evening stories created to help families slow down and finish the day together.</p>
          <p class="status-label">Coming Soon</p>
        </article>

        <article class="start-here-item">
          <h3>Growing Together</h3>
          <p>Stories celebrating friendship, family, cooperation, and belonging.</p>
          <p class="status-label">Coming Soon</p>
        </article>

        <article class="start-here-item">
          <h3>Tender Times</h3>
          <p>Comforting stories for children working through change, uncertainty, loss, or difficult emotions.</p>
          <p class="status-label">Coming Soon</p>
        </article>
      </div>
    </section>

    <section class="content-card" aria-labelledby="books-closing">
      <h2 id="books-closing">Looking Ahead</h2>
      <p>Every new Hawkins Hollow book begins with one child, one family, and one small moment that matters.</p>
      <p>As new series arrive on the website, this library will continue to grow.</p>
    </section>`,
      site,
      nav,
      `${site.domain}/${page.slug}.html`,
      config,
      banner
    );
  }

  if (page.slug === 'start-here') {
    return renderLayout(
      page.title,
      'Welcome to Hawkins Hollow, a gentle storybook world built around family, belonging, courage, kindness, and the quiet moments that help children grow.',
      `<section class="content-card start-here-intro">
      <p>Welcome to Hawkins Hollow, a gentle storybook world built around family, belonging, courage, kindness, and the quiet moments that help children grow.</p>
      <p>These books are written to be shared—between children and the grown-ups who love them, between beginning readers and patient listeners, and between families looking for stories that feel warm, familiar, and safe.</p>
    </section>

    <section class="content-card start-here-series" aria-labelledby="choose-a-place-to-begin">
      <h2 id="choose-a-place-to-begin">Choose a Place to Begin</h2>
      <div class="start-here-grid">
        <article class="start-here-item">
          <h3>Storybooks</h3>
          <p>Illustrated stories for shared reading, bedtime, quiet afternoons, and family story time. These books invite children into Hawkins Hollow through gentle adventures, familiar feelings, and characters who learn by living alongside one another.</p>
          <a class="button" href="storybook-shelf.html">Visit the Storybook Shelf</a>
        </article>

        <article class="start-here-item">
          <h3>First Readers</h3>
          <p>Short, approachable stories for children beginning to read with growing independence. First Readers use brief lines, supportive illustrations, and comfortable pacing without making the child feel hurried or tested.</p>
          <p class="status-label">Coming to the website soon</p>
        </article>

        <article class="start-here-item">
          <h3>Second Readers</h3>
          <p>Longer stories for developing readers who are ready for more detail, more conversation, and a little more time inside each Hawkins Hollow moment.</p>
          <p class="status-label">Coming to the website soon</p>
        </article>

        <article class="start-here-item">
          <h3>Bedtime Library</h3>
          <p>Quiet stories made for winding down together. The Bedtime Library offers gentle pacing, emotional warmth, and a comfortable ending for the close of the day.</p>
          <p class="status-label">Coming to the website soon</p>
        </article>

        <article class="start-here-item">
          <h3>Growing Together</h3>
          <p>Stories about relationships, cooperation, belonging, and the everyday ways children and families learn to understand one another.</p>
          <p class="status-label">Coming to the website soon</p>
        </article>

        <article class="start-here-item">
          <h3>Tender Times</h3>
          <p>Comfort-centered stories for children moving through difficult feelings, uncertainty, change, or moments when reassurance matters most.</p>
          <p class="status-label">Coming to the website soon</p>
        </article>
      </div>
    </section>

    <section class="content-card start-here-grownups" aria-labelledby="for-the-grown-ups">
      <h2 id="for-the-grown-ups">For the Grown-Ups</h2>
      <p>Hawkins Hollow books are written for children, but they are also made to support the adults reading beside them. Many books include gentle discussion prompts, family support pages, or small invitations to talk, listen, remember, and connect.</p>
      <p>There is no test at the end and no single correct way to use a Hawkins Hollow story. Read slowly. Pause when a child wants to pause. Return to a favorite page. Let the story become part of your family's own conversation.</p>
    </section>

    <section class="content-card start-here-closing" aria-labelledby="the-porch-light-is-on">
      <h2 id="the-porch-light-is-on">The Porch Light Is On</h2>
      <p>You do not have to explore everything at once. Begin with one story, one character, or one quiet moment that feels like a good fit. Hawkins Hollow will still be here when you come back.</p>
    </section>`,
      site,
      nav,
      `${site.domain}/${page.slug}.html`,
      config,
      banner
    );
  }

  return renderLayout(
    page.title,
    page.content,
    `<section class="content-card">
      <p>Grandpa is still setting the table for this part of the Hollow. The path is ready, and the welcome is waiting.</p>
    </section>`,
    site,
    nav,
    `${site.domain}/${page.slug}.html`,
    config,
    banner
  );
}

function renderCharactersPage(site, nav, charactersData, config, banner) {
  const cards = charactersData.characters
    .filter((character) => character.featured === true)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(
      (character) => `<a class="character-card" href="characters/${character.slug}.html" aria-label="Meet ${character.name}">
          <img src="${character.heroImage.replace(/^\//, '')}" alt="${character.name}" width="320" height="180" loading="lazy" />
          <h3>${character.name}</h3>
          <p>${character.description}</p>
        </a>`
    )
    .join('');

  return renderLayout(
    'Meet the Friends of Hawkins Hollow',
    'Every Hawkins Hollow story begins with someone worth knowing.',
    `<section class="content-card" aria-labelledby="characters-introduction">
      <h2 id="characters-introduction">Meet the Friends of Hawkins Hollow</h2>
      <p>Every Hawkins Hollow story begins with someone worth knowing.</p>
      <p>Some are adventurous. Some are quiet. Some ask questions. Some listen carefully. Some need encouragement. Some discover they can encourage someone else.</p>
      <p>Together they make Hawkins Hollow a place where every child can find someone who feels familiar.</p>
    </section>

    <section class="content-card" aria-labelledby="community-of-many-voices">
      <h2 id="community-of-many-voices">A Community of Many Voices</h2>
      <p>Children in Hawkins Hollow are different from one another in personality, interests, abilities, families, and experiences.</p>
      <p>Every character brings something valuable to the community, and every story reminds us that kindness, patience, courage, and belonging often grow through everyday moments.</p>
    </section>

    <section class="content-card" aria-labelledby="characters-youll-meet">
      <h2 id="characters-youll-meet">Characters You'll Meet</h2>
      <div class="character-grid">${cards}</div>
    </section>

    <section class="content-card" aria-labelledby="more-friends-are-waiting">
      <h2 id="more-friends-are-waiting">More Friends Are Waiting</h2>
      <p>Hawkins Hollow continues to grow with every new story.</p>
      <p>As additional books are published, more characters, families, and familiar places will find their home here.</p>
    </section>

    <section class="content-card" aria-labelledby="every-story-begins-with-someone">
      <h2 id="every-story-begins-with-someone">Every Story Begins with Someone</h2>
      <p>Whether you begin with a favorite character or discover someone new along the way, every Hawkins Hollow story offers another opportunity to listen, imagine, and grow together.</p>
    </section>`,
    site,
    nav,
    `${site.domain}/characters.html`,
    config,
    banner
  );
}

function renderCharacterDetailPage(character, site, nav, config) {
  return renderLayout(
    character.name,
    character.description,
    `<section class="content-card">
      <img src="../${character.heroImage.replace(/^\//, '')}" alt="${character.name}" width="640" height="360" />
      <h1>${character.name}</h1>
      <p>${character.description}</p>
      <p><a href="../characters.html">Back to Meet the Friends of Hawkins Hollow</a></p>
    </section>`,
    site,
    nav,
    `${site.domain}/characters/${character.slug}.html`,
    config,
    null,
    '../'
  );
}

function renderSeriesPage(page, site, nav, seriesData, booksData, config, banner) {
  const series = seriesData.series.find((entry) => entry.slug === page.seriesSlug);

  if (page.slug === 'storybook-shelf') {
    return renderLayout(
      series.title,
      'Welcome to the Hawkins Hollow Storybook Shelf.',
      `<section class="content-card" aria-labelledby="storybook-shelf-introduction">
      <h2 id="storybook-shelf-introduction">Storybook Shelf</h2>
      <p>Welcome to the Hawkins Hollow Storybook Shelf.</p>
      <p>These illustrated stories invite children and families into a gentle countryside community filled with familiar feelings, caring relationships, small adventures, and characters who grow by living alongside one another.</p>
    </section>

    <section class="content-card" aria-labelledby="stories-made-to-be-shared">
      <h2 id="stories-made-to-be-shared">Stories Made to Be Shared</h2>
      <p>Hawkins Hollow Storybooks are created for reading together—at bedtime, during a quiet afternoon, in a classroom reading corner, or anywhere a child and a caring grown-up can pause for a story.</p>
      <p>Each book stands on its own, so families may begin with whichever character, feeling, or adventure seems like the best fit.</p>
    </section>

    <section class="content-card" aria-labelledby="the-shelf-is-growing">
      <h2 id="the-shelf-is-growing">The Shelf Is Growing</h2>
      <p>Individual story listings, book covers, descriptions, and purchase links will be added here as the Hawkins Hollow website continues to grow.</p>
      <p>For now, visitors may learn more about the Storybook Series and explore the rest of Hawkins Hollow.</p>
      <p>
        <a class="button" href="storybook-series.html">About the Storybook Series</a>
        <a class="button" href="books.html">Explore All Book Series</a>
      </p>
      <div class="card-grid" aria-label="Future story listings">
        <article class="book-card">
          <h3>Shelf Space Ready for New Stories</h3>
          <p class="placeholder">Future story listings will appear here as new books are added.</p>
        </article>
      </div>
    </section>

    <section class="content-card" aria-labelledby="choose-the-story-that-feels-right">
      <h2 id="choose-the-story-that-feels-right">Choose the Story That Feels Right</h2>
      <p>There is no required reading order in Hawkins Hollow. Begin with one story that catches your attention, share it at your own pace, and return whenever the porch light calls you back.</p>
    </section>`,
      site,
      nav,
      `${site.domain}/${page.slug}.html`,
      config,
      banner
    );
  }

  const books = (booksData.books || []).filter((book) => book.seriesSlug === series.slug).slice(0, 3);
  const cards = books
    .map(
      (book) => `<article class="book-card">
        <img src="${toOutputAssetPath(book.coverImage)}" alt="Cover image for ${book.title}" loading="lazy" />
        <h3>${book.title}</h3>
        <p><strong>Code:</strong> ${book.code}</p>
        ${book.description ? `<p>${book.description}</p>` : ''}
        <a class="button" href="${book.slug}.html">Read more</a>
      </article>`
    )
    .join('');

  return renderLayout(
    series.title,
    series.description,
    `<section class="content-card">
      <p>${series.description}</p>
      <p><a class="button" href="storybook-series.html">View the Storybook Series</a></p>
    </section>

    <section class="content-card">
      <h2>Books in this series</h2>
      <div class="card-grid">${cards}</div>
    </section>`,
    site,
    nav,
    `${site.domain}/${page.slug}.html`,
    config,
    banner
  );
}

function renderBookDetailPage(page, site, nav, booksData, config, banner) {
  const book = booksData.books.find((entry) => entry.slug === page.bookSlug);
  return renderLayout(
    book.title,
    book.description,
    `<section class="content-card">
      <img src="${toOutputAssetPath(book.coverImage)}" alt="Cover image for ${book.title}" />
      <h2>About this book</h2>
      ${book.description ? `<p>${book.description}</p>` : ''}
      <p><strong>Series:</strong> ${book.seriesSlug}</p>
      <a class="button" href="books.html">Back to books</a>
    </section>`,
    site,
    nav,
    `${site.domain}/${page.slug}.html`,
    config,
    banner
  );
}

function renderUnderConstructionPage(site, nav, constructionData, config, banner) {
  return renderLayout(
    constructionData.title,
    constructionData.message,
    `<section class="hero-card">
      <p class="eyebrow">Under construction</p>
      <h1>${constructionData.title}</h1>
      <p>${constructionData.message}</p>
      <p>
        <a class="button" href="${constructionData.primaryLinkHref}">${constructionData.primaryLinkLabel}</a>
        <a class="button" href="${constructionData.secondaryLinkHref}">${constructionData.secondaryLinkLabel}</a>
      </p>
    </section>`,
    site,
    nav,
    `${site.domain}/`,
    config,
    banner
  );
}

function renderReferenceFallbackPage(page, issue, site, nav, constructionData, config, banner) {
  const isLegacy = page.status === 'legacy';
  const label = isLegacy ? 'Legacy route preserved' : 'Under construction';
  const message = isLegacy
    ? 'This historical route is preserved while its original source record is reconciled.'
    : constructionData.message;

  return renderLayout(
    page.title,
    message,
    `<section class="hero-card">
      <p class="eyebrow">${label}</p>
      <h1>${page.title}</h1>
      <p>${message}</p>
      <p><strong>Unresolved ${issue.type} reference:</strong> ${issue.slug}</p>
      <p><a class="button" href="index.html">Return Home</a></p>
    </section>`,
    site,
    nav,
    `${site.domain}/${page.slug}.html`,
    config,
    banner
  );
}

function getReferenceIssue(page, seriesData, booksData) {
  if (page.template === 'series') {
    const exists = seriesData.series.some((entry) => entry.slug === page.seriesSlug);
    return exists ? null : { type: 'series', slug: page.seriesSlug };
  }

  if (page.template === 'book-detail') {
    const exists = booksData.books.some((entry) => entry.slug === page.bookSlug);
    return exists ? null : { type: 'book', slug: page.bookSlug };
  }

  if (page.status === 'legacy' && page.legacyReference) {
    return page.legacyReference;
  }

  return null;
}

function writePage(fileName, html) {
  const outputPath = path.join(buildDir, fileName);
  ensureDir(path.dirname(outputPath));
  fs.writeFileSync(outputPath, html, 'utf8');
}

function buildSite() {
  const site = readJson('data/site.json');
  const nav = readJson('data/navigation.json');
  const pages = readJson('data/pages.json').pages;
  const seriesData = readJson('data/series.json');
  const booksData = readJson('data/books.json');
  const charactersData = readJson('data/characters.json');
  const constructionData = readJson('data/under-construction.json');
  const config = readJson('data/site-config.json');
  const banners = readJson('data/banners.json');

  const pageDefinitions = pages.map((page) => ({ ...page }));
  const existingSlugs = new Set(pageDefinitions.map((page) => page.slug));
  for (const item of nav.items) {
    const slug = item.href.replace(/\.html$/, '');
    if (!existingSlugs.has(slug)) {
      pageDefinitions.push({
        slug,
        title: item.label,
        template: 'under-construction'
      });
      existingSlugs.add(slug);
    }
  }

  const pageReferenceIssues = new Map();
  for (const page of pageDefinitions) {
    const issue = getReferenceIssue(page, seriesData, booksData);
    if (issue) {
      const fallbackAction = page.status === 'legacy' ? 'legacy' : 'under-construction';
      console.warn(
        `[recovery warning] page "${page.slug}": missing ${issue.type} reference "${issue.slug}"; fallback action: ${fallbackAction}`
      );
      pageReferenceIssues.set(page.slug, issue);
    }
  }

  ensureDir(buildDir);
  fs.copyFileSync(path.join(root, 'styles.css'), path.join(buildDir, 'styles.css'));
  if (fs.existsSync(path.join(root, 'assets'))) {
    copyDir(path.join(root, 'assets'), path.join(buildDir, 'assets'));
  }
  ensureDir(path.join(buildDir, 'images'));
  if (!fs.existsSync(path.join(buildDir, 'images', 'placeholder-banner.jpg'))) {
    fs.writeFileSync(path.join(buildDir, 'images', 'placeholder-banner.jpg'), 'placeholder-banner');
  }
  if (!fs.existsSync(path.join(buildDir, 'images', 'placeholder-cover.jpg'))) {
    fs.writeFileSync(path.join(buildDir, 'images', 'placeholder-cover.jpg'), 'placeholder-cover');
  }

  for (const page of pageDefinitions) {
    const banner = getBannerForPage(page, banners);
    const referenceIssue = pageReferenceIssues.get(page.slug);
    let html = '';
    if (referenceIssue) {
      html = renderReferenceFallbackPage(page, referenceIssue, site, nav, constructionData, config, banner);
    } else if (page.slug === 'index') {
      html = renderLandingPage(page, site, nav, config, banner);
    } else if (page.slug === 'characters') {
      html = renderCharactersPage(site, nav, charactersData, config, banner);
    } else if (page.template === 'article') {
      html = renderArticlePage(page, site, nav, config, banner);
    } else if (page.template === 'series') {
      html = renderSeriesPage(page, site, nav, seriesData, booksData, config, banner);
    } else if (page.template === 'book-detail') {
      html = renderBookDetailPage(page, site, nav, booksData, config, banner);
    } else {
      html = renderUnderConstructionPage(site, nav, constructionData, config, banner);
    }

    writePage(page.slug === 'index' ? 'index.html' : `${page.slug}.html`, html);
  }

  const featuredCharacters = charactersData.characters
    .filter((character) => character.featured === true)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  for (const character of featuredCharacters) {
    writePage(
      path.join('characters', `${character.slug}.html`),
      renderCharacterDetailPage(character, site, nav, config)
    );
  }

  console.log('Generated recovery site in build-recovery/');
}

buildSite();
