import json
import os
import shutil
from pathlib import Path

root = Path(__file__).resolve().parent.parent
build_dir = root / 'build'


def read_json(relative_path):
    with (root / relative_path).open('r', encoding='utf-8') as fh:
        return json.load(fh)


def ensure_dir(path):
    path.mkdir(parents=True, exist_ok=True)


def render_layout(title, description, content, site, nav):
    nav_html = ''.join(f'<a href="{item["href"]}">{item["label"]}</a>' for item in nav['items'])
    return f'''<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title} | {site['siteName']}</title>
    <meta name="description" content="{description}" />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header class="site-header">
      <div class="brand">{site['siteName']}</div>
      <nav class="site-nav" aria-label="Primary navigation">
        {nav_html}
      </nav>
    </header>

    <main class="page-shell">
      {content}
    </main>

    <footer class="site-footer">
      <p>{site['footerText']}</p>
    </footer>
  </body>
</html>'''


def render_landing_page(page, site, nav):
    return render_layout(
        page['title'],
        site['tagline'],
        f'''<section class="hero-card">
      <p class="eyebrow">Welcome to</p>
      <h1>{site['siteName']}</h1>
      <p>{page['content']}</p>
      <a class="button" href="storybook-shelf.html">Visit the Storybook Shelf</a>
    </section>

    <section class="content-card">
      <h2>Vertical slice</h2>
      <p>This page links to the first working path: home → storybook shelf → storybook series → example books → book detail.</p>
    </section>''',
        site,
        nav,
    )


def render_article_page(page, site, nav):
    return render_layout(
        page['title'],
        page['content'],
        f'''<section class="page-banner">
      <h1>{page['title']}</h1>
      <p>{page['content']}</p>
    </section>

    <section class="content-card">
      <p>This content is generated from structured page data and shared templates.</p>
    </section>''',
        site,
        nav,
    )


def render_series_page(page, site, nav, series_data, books_data):
    series = next(entry for entry in series_data['series'] if entry['slug'] == page['seriesSlug'])
    books = [book for book in books_data['books'] if book['seriesSlug'] == series['slug']][:3]
    cards_html = ''.join(
        f'''<article class="book-card">
        <h3>{book['title']}</h3>
        <p><strong>Series:</strong> {book['seriesTitle']}</p>
        <p><strong>Age:</strong> {book['age']}</p>
        <p>{book['description']}</p>
        <a class="button" href="{book['slug']}.html">Read more</a>
      </article>'''
        for book in books
    )
    return render_layout(
        series['title'],
        series['description'],
        f'''<section class="page-banner">
      <h1>{series['title']}</h1>
      <p>{series['subtitle']}</p>
    </section>

    <section class="content-card">
      <p>{series['description']}</p>
    </section>

    <section class="content-card">
      <h2>Books in this series</h2>
      <div class="card-grid">{cards_html}</div>
    </section>''',
        site,
        nav,
    )


def render_book_detail_page(page, site, nav, books_data):
    book = next(entry for entry in books_data['books'] if entry['slug'] == page['bookSlug'])
    return render_layout(
        book['pageTitle'],
        book['description'],
        f'''<section class="page-banner">
      <h1>{book['title']}</h1>
      <p>{book['seriesTitle']}</p>
    </section>

    <section class="content-card">
      <img src="{book['coverImage']}" alt="Cover image for {book['title']}" />
      <h2>About this book</h2>
      <p>{book['summary']}</p>
      <p><strong>Age:</strong> {book['age']}</p>
      <a class="button" href="storybook-shelf.html">Back to series</a>
    </section>''',
        site,
        nav,
    )


def write_page(filename, content):
    ensure_dir(build_dir)
    (build_dir / filename).write_text(content, encoding='utf-8')


def build_site():
    site = read_json('data/site.json')
    nav = read_json('data/navigation.json')
    pages = read_json('data/pages.json')['pages']
    series_data = read_json('data/series.json')
    books_data = read_json('data/books.json')

    ensure_dir(build_dir)
    shutil.copy2(root / 'styles.css', build_dir / 'styles.css')
    ensure_dir(build_dir / 'images')
    if not (build_dir / 'images' / 'placeholder-banner.jpg').exists():
        (build_dir / 'images' / 'placeholder-banner.jpg').write_text('placeholder-banner', encoding='utf-8')
    if not (build_dir / 'images' / 'placeholder-cover.jpg').exists():
        (build_dir / 'images' / 'placeholder-cover.jpg').write_text('placeholder-cover', encoding='utf-8')

    for page in pages:
        if page['slug'] == 'index':
            html = render_landing_page(page, site, nav)
        elif page['template'] == 'article':
            html = render_article_page(page, site, nav)
        elif page['template'] == 'series':
            html = render_series_page(page, site, nav, series_data, books_data)
        elif page['template'] == 'book-detail':
            html = render_book_detail_page(page, site, nav, books_data)
        else:
            continue
        write_page('index.html' if page['slug'] == 'index' else f"{page['slug']}.html", html)

    print('Generated site in build/')


if __name__ == '__main__':
    build_site()
