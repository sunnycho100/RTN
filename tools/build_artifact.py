"""Build a shareable copy of a landing draft for a claude.ai Artifact: python3 site/tools/build_artifact.py [index.html]

Artifacts wrap the page in their own <html>/<head>/<body>, and their sandbox only plays media published with the page.
So this strips the document tags and turns every clip linked from another site into a labeled placeholder box.
Writes site/dist/<name>; publish it with scan.js, engine.js and media/ as supporting files.
"""
import os, re, sys

site = os.path.join(os.path.dirname(__file__), "..")
name = sys.argv[1] if len(sys.argv) > 1 else "index.html"
s = open(os.path.join(site, name)).read()

head = re.search(r"<head>(.*?)</head>", s, re.S).group(1)
head = re.sub(r'<meta (charset|name="viewport")[^>]*>\s*', "", head)
body = re.search(r"<body>(.*?)</body>", s, re.S).group(1)

def placeholder(m):
    host = m.group(1)
    return f'<a class="empty" href="https://{host}/" target="_blank" rel="noopener">Placeholder clip · plays on {host}</a>'
body = re.sub(r'(src="[^"?]+)\?v=\d+"', r'\1"', body)  # cache-busting query is for local serving; artifact files are versioned
body, n = re.subn(r'<video data-src="https://([^/"]+)/[^"]*"[^>]*></video>', placeholder, body)

# Clips without a license for public use (CooHOI) live in the git-ignored private/ folder and only go on the share link.
tiles = os.path.join(site, "private", "tiles.html")
if os.path.exists(tiles):
    body = re.sub(r"\s*<!-- private-tiles:[^>]*-->", "\n" + open(tiles).read().rstrip(), body)

os.makedirs(os.path.join(site, "dist"), exist_ok=True)
out = os.path.join(site, "dist", name)
open(out, "w").write(head.strip() + "\n" + body.strip() + "\n")
print(f"{out}: {n} external clips turned into placeholders")
