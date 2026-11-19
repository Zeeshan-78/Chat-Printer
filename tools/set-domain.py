"""Change the website address used in SEO tags, sitemap and robots.txt.
Usage (from the project folder):  python tools/set-domain.py https://www.yourdomain.com
"""
import sys, pathlib
OLD = 'https://chatprinter.vercel.app'
if len(sys.argv) != 2 or not sys.argv[1].startswith('https://'):
    sys.exit('Give the new address, for example: python tools/set-domain.py https://www.yourdomain.com')
new = sys.argv[1].rstrip('/')
n = 0
for p in list(pathlib.Path('public').rglob('*.html')) + [pathlib.Path('public/sitemap.xml'), pathlib.Path('public/robots.txt')]:
    t = p.read_text(encoding='utf-8')
    if OLD in t:
        p.write_text(t.replace(OLD, new), encoding='utf-8'); n += 1
print('Updated', n, 'files. Also update connect/redirect settings in Appwrite and your social logins.')
