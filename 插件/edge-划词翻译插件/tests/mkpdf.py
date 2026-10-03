import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample.pdf")

PAGES = [
    [
        (72, 700, 20, "Hello world, this is a translation test."),
        (72, 660, 14, "Select any word with the mouse and double click it."),
        (72, 620, 14, "The quick brown fox jumps over the lazy dog."),
    ],
    [
        (72, 700, 18, "Second page of the sample document."),
        (72, 660, 14, "Translation should also work on this page."),
    ],
]

objs = []
content_ids = []
page_ids = []
n = 0


def alloc():
    global n
    n += 1
    return n


catalog_id = alloc()
pages_id = alloc()
font_id = alloc()

for lines in PAGES:
    stream_lines = ["BT"]
    for x, y, size, text in lines:
        stream_lines.append(f"/F1 {size} Tf 1 0 0 1 {x} {y} Tm ({text}) Tj")
    stream_lines.append("ET")
    stream = "\n".join(stream_lines).encode("latin-1")
    cid = alloc()
    pid = alloc()
    content_ids.append(cid)
    page_ids.append(pid)
    objs.append((cid, b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"))
    objs.append(
        (
            pid,
            (
                "<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] "
                "/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
                % (pages_id, font_id, cid)
            ).encode("latin-1"),
        )
    )

objs.append(
    (
        font_id,
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    )
)
objs.append(
    (
        pages_id,
        (
            "<< /Type /Pages /Kids [%s] /Count %d >>"
            % (" ".join("%d 0 R" % p for p in page_ids), len(page_ids))
        ).encode("latin-1"),
    )
)
objs.append((catalog_id, b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id))

objs.sort(key=lambda x: x[0])

out = bytearray(b"%PDF-1.4\n")
offsets = {}
for idx, data in objs:
    offsets[idx] = len(out)
    out += b"%d 0 obj\n" % idx + data + b"\nendobj\n"

xref_at = len(out)
total = n + 1
out += b"xref\n0 %d\n" % total
out += b"0000000000 65535 f \n"
for i in range(1, total):
    out += b"%010d 00000 n \n" % offsets[i]
out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
    total,
    catalog_id,
    xref_at,
)

with open(OUT, "wb") as f:
    f.write(bytes(out))
print(OUT, len(out), "bytes,", len(page_ids), "pages")
