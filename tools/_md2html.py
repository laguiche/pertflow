#!/usr/bin/env python3
# Convertit un Markdown en HTML AUTONOME (images embarquees en data-URI, CSS inline,
# adapte a l'ecran ET a l'impression PDF). Outillage de doc — hors livraison.
# Usage : python3 tools/_md2html.py <fichier.md> "<Titre>"  > sortie.html

import sys, os, re, base64, mimetypes
import markdown

def main():
    md_path, title = sys.argv[1], sys.argv[2]
    base = os.path.dirname(os.path.abspath(md_path))
    with open(md_path, encoding="utf-8") as f:
        text = f.read()

    html_body = markdown.markdown(
        text,
        extensions=["tables", "fenced_code", "toc", "sane_lists", "attr_list"],
    )

    # Embarque les images locales en data-URI (HTML autonome + rendu PDF fiable).
    def embed(m):
        src = m.group(1)
        if src.startswith(("data:", "http:", "https:")):
            return m.group(0)
        p = os.path.normpath(os.path.join(base, src))
        if not os.path.isfile(p):
            return m.group(0)
        mime = mimetypes.guess_type(p)[0] or "application/octet-stream"
        with open(p, "rb") as img:
            b64 = base64.b64encode(img.read()).decode("ascii")
        return 'src="data:%s;base64,%s"' % (mime, b64)

    html_body = re.sub(r'src="([^"]+)"', embed, html_body)

    css = """
    :root { --fg:#1c2230; --muted:#5a6577; --line:#dfe3ea; --accent:#1a4a9a;
            --codebg:#f4f6fa; --thbg:#eef2f8; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
           color: var(--fg); line-height: 1.55; max-width: 900px; margin: 0 auto;
           padding: 48px 40px; background: #fff; font-size: 15px; }
    h1 { font-size: 2em; border-bottom: 3px solid var(--accent); padding-bottom: .3em;
         color: var(--accent); margin-top: 0; }
    h2 { font-size: 1.5em; border-bottom: 1px solid var(--line); padding-bottom: .25em;
         margin-top: 1.8em; color: #14213d; }
    h3 { font-size: 1.2em; margin-top: 1.4em; color: #14213d; }
    h4 { font-size: 1.05em; margin-top: 1.1em; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { background: var(--codebg); padding: .12em .4em; border-radius: 4px;
           font-family: "SF Mono", "Consolas", "Menlo", monospace; font-size: .88em; }
    pre { background: var(--codebg); padding: 14px 16px; border-radius: 8px; overflow-x: auto;
          border: 1px solid var(--line); }
    pre code { background: none; padding: 0; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: .95em; }
    th, td { border: 1px solid var(--line); padding: 8px 12px; text-align: left;
             vertical-align: top; }
    th { background: var(--thbg); font-weight: 600; }
    tr:nth-child(even) td { background: #fafbfd; }
    img { max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 8px;
          box-shadow: 0 2px 10px rgba(20,40,80,.08); margin: .6em 0; display: block; }
    blockquote { border-left: 4px solid #9fb6d8; margin: 1em 0; padding: .3em 1em;
                 color: var(--muted); background: #f7f9fc; border-radius: 0 6px 6px 0; }
    hr { border: none; border-top: 1px solid var(--line); margin: 2em 0; }
    ul, ol { padding-left: 1.5em; }
    li { margin: .2em 0; }
    @media print {
      body { max-width: none; padding: 0; font-size: 11pt; }
      h1, h2, h3, h4 { break-after: avoid; }
      img, table, pre, blockquote { break-inside: avoid; }
      a { color: var(--fg); }
    }
    @page { margin: 18mm 16mm; }
    """

    print('<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">'
          '<meta name="viewport" content="width=device-width, initial-scale=1">'
          '<title>%s</title><style>%s</style></head><body>%s</body></html>'
          % (title, css, html_body))

if __name__ == "__main__":
    main()
