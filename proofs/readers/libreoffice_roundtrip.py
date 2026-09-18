#!/usr/bin/env python3
"""P44 reader round trip: open the exported PPTX in a real presentation app, edit a
text run, move a picture, save, reopen, and render what the app displays.

What this proves
----------------
LibreOffice (headless, driven through its own UNO API — nothing is simulated) opens
the deck produced by the production export path, keeps the text as native text and
the picture as one independent graphic object, reports the crop/flip/rotation the
export wrote, accepts an edit to one text run and a move of the picture, and stores
both into a new file that is then reopened and rendered *from disk* with those
changes and the untouched crop, flip, rotation and run styles intact.

What this does NOT prove
------------------------
* It is not a screenshot of the application window. The PNGs here are produced by
  the reader itself (LibreOffice PDF export, then pdftoppm) and are rendering
  evidence, not a window screenshot; `libreoffice_window_screenshot.py` captures
  the GUI window separately when a session is available.
* PowerPoint and Google Slides were not exercised at all. Nothing here supports a
  claim that every reader renders the deck identically.
* The round-trip file is written by LibreOffice, not by StickerLab: its own PPTX
  export is allowed to differ from ours, and it does (see `observations` in the
  report, which is why the original import is rendered separately).

Run
---
    python3 proofs/readers/libreoffice_roundtrip.py
    python3 proofs/readers/libreoffice_roundtrip.py --pptx proofs/out/p44-reader-fixture.pptx
    # The Svelte app's fixture uses the same script with its own paths and prefix:
    python3 proofs/readers/libreoffice_roundtrip.py \
      --pptx proofs/out/p44-svelte-reader-fixture.pptx \
      --pdf proofs/out/p44-svelte-reader-fixture.pdf \
      --facts proofs/out/p44-svelte-reader-facts.json \
      --prefix p44-svelte

Writes:
    proofs/out/p44-libreoffice-roundtrip.pptx    the edited and re-saved deck
    proofs/out/p44-reader-import-*.png           the reader rendering our file
    proofs/out/p44-reader-roundtrip-*.png        the reopened re-saved deck, rendered from disk
    proofs/out/p44-app-pdf-*.png                 the app's own PDF pages (reference)
    proofs/out/p44-reader-report.json            facts, checks, measurements, versions
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEFAULT_PPTX = REPO / "proofs" / "out" / "p44-reader-fixture.pptx"
DEFAULT_PDF = REPO / "proofs" / "out" / "p44-reader-fixture.pdf"
DEFAULT_FACTS = REPO / "proofs" / "out" / "p44-reader-facts.json"
OUT_DIR = REPO / "proofs" / "out"
# The React source kept its fonts under public/; the Svelte port ships them under
# static/. Prefer whichever tree exists so the same script serves both fixtures.
FONT_DIR = next(
    (
        candidate
        for candidate in (REPO / "static" / "fonts" / "presentations", REPO / "public" / "fonts" / "presentations")
        if candidate.is_dir()
    ),
    REPO / "static" / "fonts" / "presentations",
)

# LibreOffice geometry is 1/100 mm; document units are 1/96 inch.
HUNDREDTHS_MM_PER_INCH = 2540
# Rendering differences under a millimetre are reader rounding, not a defect.
POSITION_TOLERANCE = 6
ROTATION_TOLERANCE = 60

PORTS = range(2002, 2010)


def display_path(path: Path) -> str:
    """Repo-relative when the path is inside the repo, absolute otherwise."""
    try:
        return str(path.relative_to(REPO))
    except ValueError:
        return str(path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def free_port() -> int:
    for port in PORTS:
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit("no free UNO port in 2002-2009")


def write_fontconfig(directory: Path) -> Path:
    """Point fontconfig at the fonts the app bundles, without touching the user's config."""
    path = directory / "fonts.conf"
    path.write_text(
        "<?xml version=\"1.0\"?>\n"
        "<!DOCTYPE fontconfig SYSTEM \"fonts.dtd\">\n"
        "<fontconfig>\n"
        f"  <dir>{FONT_DIR}</dir>\n"
        f"  <cachedir>{directory / 'font-cache'}</cachedir>\n"
        "  <include ignore_missing=\"yes\">/etc/fonts/fonts.conf</include>\n"
        "</fontconfig>\n"
    )
    return path


class LibreOffice:
    """A headless LibreOffice this script starts and stops itself."""

    def __init__(self, scratch: Path) -> None:
        self.scratch = scratch
        self.port = free_port()
        self.process: subprocess.Popen[bytes] | None = None

    def start(self) -> None:
        profile = self.scratch / "lo-profile"
        env = {**os.environ, "HOME": str(self.scratch), "FONTCONFIG_FILE": str(write_fontconfig(self.scratch))}
        self.process = subprocess.Popen(
            [
                "soffice",
                "--headless",
                "--norestore",
                "--nologo",
                "--nofirststartwizard",
                f"-env:UserInstallation=file://{profile}",
                f"--accept=socket,host=127.0.0.1,port={self.port};urp;",
            ],
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
        )

    def stop(self) -> None:
        if self.process is not None:
            self.process.terminate()
            try:
                self.process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.process.kill()

    def connect(self):
        import uno  # noqa: PLC0415 - the import itself needs no setup, the context does

        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext("com.sun.star.bridge.UnoUrlResolver", local)
        url = f"uno:socket,host=127.0.0.1,port={self.port};urp;StarOffice.ComponentContext"
        last: Exception | None = None
        for _ in range(80):
            try:
                return resolver.resolve(url)
            except Exception as exc:  # noqa: BLE001 - the resolver raises many types while starting
                last = exc
                time.sleep(0.5)
        raise SystemExit(f"LibreOffice UNO bridge never came up: {last}")


def property_value(name: str, value):
    from com.sun.star.beans import PropertyValue

    item = PropertyValue()
    item.Name = name
    item.Value = value
    return item


def prop(shape, name: str):
    """Read one property when the object really has it, otherwise None."""
    info_getter = getattr(shape, "getPropertySetInfo", None)
    if info_getter is None:
        return None
    if not info_getter().hasPropertyByName(name):
        return None
    try:
        value = shape.getPropertyValue(name)
    except Exception:  # noqa: BLE001 - an unsupported property is simply absent
        return None
    if hasattr(value, "value"):  # optional/ambiguous values and UNO enums
        return getattr(value, "value", None)
    return value


def shape_position(shape):
    """XShape.getPosition is the reliable accessor; the property is not always exposed."""
    getter = getattr(shape, "getPosition", None)
    if getter is None:
        return None
    try:
        return getter()
    except Exception:  # noqa: BLE001 - shapes without a position simply have none
        return None


def shape_size(shape):
    getter = getattr(shape, "getSize", None)
    if getter is None:
        return None
    try:
        return getter()
    except Exception:  # noqa: BLE001
        return None


def color_to_hex(value) -> str | None:
    if value is None:
        return None
    return "#%06x" % (int(value) & 0xFFFFFF)


def describe_shape(shape) -> dict:
    entry: dict = {
        "name": getattr(shape, "Name", ""),
        "services": [
            name
            for name in (
                "com.sun.star.drawing.Text",
                "com.sun.star.drawing.GraphicObjectShape",
                "com.sun.star.drawing.GroupShape",
            )
            if shape.supportsService(name)
        ],
    }
    position = shape_position(shape)
    size = shape_size(shape)
    if position is not None:
        entry["positionHundredthsMm"] = {"x": int(position.X), "y": int(position.Y)}
    if size is not None:
        entry["sizeHundredthsMm"] = {"width": int(size.Width), "height": int(size.Height)}
    for name, key in (
        ("RotateAngle", "rotateHundredthsDeg"),
        ("IsMirrored", "isMirrored"),
        ("FillColor", "fillColor"),
        ("FillStyle", "fillStyle"),
        ("LineColor", "lineColor"),
        ("LineWidth", "lineWidth"),
    ):
        value = prop(shape, name)
        if value is None:
            continue
        entry[key] = color_to_hex(value) if "Color" in name else value
    crop = prop(shape, "GraphicCrop")
    if crop is not None:
        entry["graphicCropHundredthsMm"] = {
            "left": int(crop.Left),
            "right": int(crop.Right),
            "top": int(crop.Top),
            "bottom": int(crop.Bottom),
        }
    entry["isText"] = shape.supportsService("com.sun.star.drawing.Text")
    return entry


def hyperlink_fields(text) -> list[dict]:
    """Hyperlinks the reader stores on a text body, when it exposes them."""
    fields = []
    getter = getattr(text, "getTextFields", None)
    if getter is None:
        return fields
    try:
        enumeration = getter()
    except Exception as exc:  # noqa: BLE001
        return [{"error": str(exc)}]
    while enumeration.hasMoreElements():
        field = enumeration.nextElement()
        entry = {"text": field.getString()}
        for name in ("URL", "Representation", "HyperLinkURL"):
            value = prop(field, name)
            if value:
                entry[name] = str(value)
        anchor = getattr(field, "getAnchor", None)
        if anchor is not None:
            try:
                entry["anchorText"] = anchor().getString()
            except Exception:  # noqa: BLE001
                pass
        fields.append(entry)
    return fields


def read_text(shape) -> dict:
    """Paragraphs and runs as the reader stores them, with bold/italic and links."""
    text = shape.getText()
    paragraphs = []
    fonts = []
    for paragraph in text.createEnumeration():
        runs = []
        if paragraph.supportsService("com.sun.star.text.Paragraph"):
            for portion in paragraph.createEnumeration():
                run = {"text": portion.getString()}
                weight = prop(portion, "CharWeight")
                posture = prop(portion, "CharPosture")
                if weight is not None:
                    # com.sun.star.awt.FontWeight: NORMAL is 100, BOLD is 150.
                    run["bold"] = float(weight) >= 125.0
                if posture is not None:
                    # com.sun.star.awt.FontSlant arrives as the enum name.
                    run["italic"] = str(posture) not in ("NONE", "DONTKNOW")
                height = prop(portion, "CharHeight")
                if height is not None:
                    run["charHeightPt"] = round(float(height), 2)
                family = prop(portion, "CharFontName")
                if family is not None:
                    run["font"] = str(family)
                    if str(family) not in fonts:
                        fonts.append(str(family))
                link = prop(portion, "HyperLinkURL")
                if link:
                    run["link"] = str(link)
                underline = prop(portion, "CharUnderline")
                if underline is not None:
                    run["underline"] = str(underline) not in ("NONE", "DONTKNOW")
                level = prop(portion, "NumberingLevel")
                if level is not None:
                    run["numberingLevel"] = int(level)
                runs.append(run)
        paragraphs.append({"runs": runs})
    return {"paragraphs": paragraphs, "fonts": fonts, "fields": hyperlink_fields(text)}


def find_run(text_frame, wanted: str):
    """The first run whose text is exactly `wanted`; used for the edit below."""
    for paragraph in text_frame.getText().createEnumeration():
        if not paragraph.supportsService("com.sun.star.text.Paragraph"):
            continue
        for portion in paragraph.createEnumeration():
            if portion.getString() == wanted:
                return portion
    return None


def collect_document(document) -> dict:
    """Every page's shapes, text runs, fonts and links as the reader stores them."""
    pages = document.DrawPages
    summary = {
        "slideCount": pages.Count,
        "pageSizeHundredthsMm": {"width": int(pages.getByIndex(0).Width), "height": int(pages.getByIndex(0).Height)},
        "slides": [],
        "slideText": "",
        "fonts": [],
        "boldRuns": 0,
        "italicRuns": 0,
        "textFrames": 0,
        "pictureCount": 0,
        "pictures": [],
        "links": [],
    }
    for page_index in range(pages.Count):
        current = pages.getByIndex(page_index)
        entry = {"name": getattr(current, "Name", f"page{page_index}"), "shapes": []}
        for shape_index in range(current.Count):
            shape = current.getByIndex(shape_index)
            described = describe_shape(shape)
            if described["isText"]:
                described["text"] = read_text(shape)
                summary["textFrames"] += 1
                for paragraph in described["text"]["paragraphs"]:
                    for run in paragraph["runs"]:
                        summary["slideText"] += run["text"]
                        if run.get("bold"):
                            summary["boldRuns"] += 1
                        if run.get("italic"):
                            summary["italicRuns"] += 1
                        if run.get("link"):
                            summary["links"].append(run["link"])
                for font in described["text"]["fonts"]:
                    if font not in summary["fonts"]:
                        summary["fonts"].append(font)
                for field in described["text"]["fields"]:
                    for key in ("URL", "HyperLinkURL"):
                        if field.get(key):
                            summary["links"].append(field[key])
            if shape.supportsService("com.sun.star.drawing.GraphicObjectShape"):
                summary["pictureCount"] += 1
                summary["pictures"].append(described)
            entry["shapes"].append(described)
        summary["slides"].append(entry)
    summary["picture"] = summary["pictures"][0] if summary["pictures"] else None
    return summary


def inspect_package(path: Path, slide: int = 2) -> dict:
    """What the reader's own PPTX export kept: slides, embedded media and hyperlinks."""
    import re
    from zipfile import ZipFile

    with ZipFile(path) as archive:
        names = archive.namelist()
        slides = [name for name in names if re.match(r"ppt/slides/slide\d+\.xml$", name)]
        media = [name for name in names if name.startswith("ppt/media/")]
        slide_name = f"ppt/slides/slide{slide}.xml"
        rels_name = f"ppt/slides/_rels/slide{slide}.xml.rels"
        slide_xml = archive.read(slide_name).decode("utf-8") if slide_name in names else ""
        rels = archive.read(rels_name).decode("utf-8") if rels_name in names else ""
    return {
        "slides": len(slides),
        "mediaEntries": len(media),
        "hasHyperlinkClick": "hlinkClick" in slide_xml,
        "hyperlinkUrls": re.findall(r'Target="([^"]+)"', rels),
    }


# --- rendering measurements -----------------------------------------------------------

def render_pdf(document, target: Path) -> None:
    document.storeToURL(
        target.resolve().as_uri(),
        (property_value("FilterName", "impress_pdf_Export"), property_value("Overwrite", True)),
    )


def render_pngs(pdf: Path, prefix: Path, out_dir: Path) -> list[str]:
    for existing in out_dir.glob(f"{prefix.name}-*.png"):
        existing.unlink()
    subprocess.run(["pdftoppm", "-r", "96", "-png", str(pdf), str(prefix)], check=True)
    return sorted(path.name for path in out_dir.glob(f"{prefix.name}-*.png"))


def parse_geometry(value: str | None) -> tuple[int, int, int, int] | None:
    """`WxH+X+Y` from ImageMagick into numbers."""
    import re

    if not value:
        return None
    match = re.match(r"(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$", value.strip())
    return tuple(int(group) for group in match.groups()) if match else None  # type: ignore[return-value]


def artwork_blob(png: Path, region: str, color: str, fuzz: str = "6%") -> str | None:
    """Bounding box of the artwork colour inside one region, measured with ImageMagick."""
    if shutil.which("magick") is None:
        return None
    result = subprocess.run(
        ["magick", str(png), "-crop", region, "+repage", "-fuzz", fuzz, "-fill", "red", "-opaque", color, "-fill", "black", "+opaque", "red", "-format", "%@", "info:"],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.stdout.strip() or None


# --- checks ---------------------------------------------------------------------------

def run_checks(report: dict) -> list[str]:
    """The claims this script is allowed to make, evaluated one by one."""
    before = report["before"]
    after = report["after"]
    expected = report["expected"]
    failures: list[str] = []

    def check(name: str, condition: bool, detail: str = "") -> None:
        report["checks"].append({"check": name, "passed": bool(condition), "detail": detail})
        if not condition:
            failures.append(name)

    def close(actual: int | None, wanted: int | None, tolerance: int) -> bool:
        return actual is not None and wanted is not None and abs(actual - wanted) <= tolerance

    picture = before["picture"]
    crop = picture.get("graphicCropHundredthsMm") if picture else None

    check("reader opened the deck with the exported slide count", before["slideCount"] == expected["slideCount"], f"reader={before['slideCount']} expected={expected['slideCount']}")
    check("page size matches the 16:9 export", before["pageSizeHundredthsMm"] == expected["pageSizeHundredthsMm"], json.dumps(before["pageSizeHundredthsMm"]))
    missing = [value for value in expected["slide1Text"] + expected["slide2Text"] if value not in before["slideText"]]
    check("Vietnamese and English text survived as native text", not missing, f"missing={missing}")
    check("text stays editable text objects, not rasterized", before["textFrames"] >= 3, f"textFrames={before['textFrames']}")
    check("bold and italic runs survive", before["boldRuns"] >= 1 and before["italicRuns"] >= 1, f"bold={before['boldRuns']} italic={before['italicRuns']}")
    linked_run = next(
        (run for slide in before["slides"] for shape in slide["shapes"] if shape.get("text") for paragraph in shape["text"]["paragraphs"] for run in paragraph["runs"] if run["text"] == "Xem hướng dẫn"),
        None,
    )
    check(
        "the reader renders the linked run as a hyperlink",
        bool(linked_run) and linked_run.get("underline") is True,
        json.dumps({"run": linked_run, "links": before["links"], "note": "LibreOffice exposes hyperlinks neither on the text portion nor as a text field for this import; the URL itself is asserted from the OOXML in the P38 tests."}),
    )
    check(
        "the hyperlink target survives the reader's own save",
        report["roundtripPackage"].get("hasHyperlinkClick") is True and expected["linkUrl"] in report["roundtripPackage"].get("hyperlinkUrls", []),
        json.dumps(report["roundtripPackage"]),
    )
    check("the picture stayed one independent picture object", picture is not None and before["pictureCount"] == 1, json.dumps({"pictures": before["pictureCount"], "name": picture and picture["name"]}))
    check(
        "the picture box matches the exported element box",
        picture is not None
        and close(picture["positionHundredthsMm"]["x"], expected["imagePositionHundredthsMm"]["x"], POSITION_TOLERANCE)
        and close(picture["positionHundredthsMm"]["y"], expected["imagePositionHundredthsMm"]["y"], POSITION_TOLERANCE)
        and close(picture["sizeHundredthsMm"]["width"], expected["imageSizeHundredthsMm"]["width"], POSITION_TOLERANCE)
        and close(picture["sizeHundredthsMm"]["height"], expected["imageSizeHundredthsMm"]["height"], POSITION_TOLERANCE),
        json.dumps({"reader": picture and {"position": picture["positionHundredthsMm"], "size": picture["sizeHundredthsMm"]}, "expected": {"position": expected["imagePositionHundredthsMm"], "size": expected["imageSizeHundredthsMm"]}}),
    )
    check(
        "the reader reports the flip the export wrote",
        picture is not None and bool(picture.get("isMirrored")) is True,
        json.dumps(picture and picture.get("isMirrored")),
    )
    check(
        "the reader reports the rotation the export wrote",
        # LibreOffice measures rotation counter-clockwise; OOXML measures it clockwise.
        picture is not None and close((36000 - int(picture.get("rotateHundredthsDeg", 0))) % 36000, expected["imageRotationHundredthsDeg"], ROTATION_TOLERANCE),
        json.dumps({"reader": picture and picture.get("rotateHundredthsDeg"), "clockwiseEquivalent": picture and (36000 - int(picture.get("rotateHundredthsDeg", 0))) % 36000, "expected": expected["imageRotationHundredthsDeg"]}),
    )
    check(
        "the reader reports the non-destructive crop the export wrote",
        crop is not None
        and all(close(crop[side], expected["imageCropHundredthsMm"][side], POSITION_TOLERANCE) for side in ("left", "right", "top", "bottom")),
        json.dumps({"reader": crop, "expected": expected["imageCropHundredthsMm"]}),
    )
    check("the reader fonts cover the document text", set(before["fonts"]) >= set(expected["fonts"]), json.dumps({"readerFonts": sorted(before["fonts"]), "expected": expected["fonts"]}))
    check("the edited run was written", report["edit"]["observedText"] == report["edit"]["newText"], json.dumps(report["edit"]))
    check(
        "the moved picture kept the new position after reopening",
        after["picture"] is not None
        and close(after["picture"]["positionHundredthsMm"]["x"], report["edit"]["movedToHundredthsMm"]["x"], 5)
        and close(after["picture"]["positionHundredthsMm"]["y"], report["edit"]["movedToHundredthsMm"]["y"], 5),
        json.dumps({"after": after["picture"] and after["picture"]["positionHundredthsMm"], "expected": report["edit"]["movedToHundredthsMm"]}),
    )
    after_picture = after["picture"]
    check(
        "the reader's own save kept the picture size",
        after_picture is not None
        and close(after_picture["sizeHundredthsMm"]["width"], picture["sizeHundredthsMm"]["width"], POSITION_TOLERANCE)
        and close(after_picture["sizeHundredthsMm"]["height"], picture["sizeHundredthsMm"]["height"], POSITION_TOLERANCE),
        json.dumps({"before": picture and picture["sizeHundredthsMm"], "after": after_picture and after_picture["sizeHundredthsMm"]}),
    )
    check(
        "the reader's own save kept the picture crop",
        crop is not None
        and after_picture is not None
        and after_picture.get("graphicCropHundredthsMm") is not None
        and all(close(after_picture["graphicCropHundredthsMm"][side], crop[side], POSITION_TOLERANCE) for side in ("left", "right", "top", "bottom")),
        json.dumps({"before": crop, "after": after_picture and after_picture.get("graphicCropHundredthsMm")}),
    )
    check(
        "the reader's own save kept the picture flip",
        after_picture is not None
        and bool(after_picture.get("isMirrored")) == bool(picture.get("isMirrored")),
        json.dumps({"before": picture and picture.get("isMirrored"), "after": after_picture and after_picture.get("isMirrored")}),
    )
    check(
        "the reader's own save kept the picture rotation",
        after_picture is not None
        and after_picture.get("rotateHundredthsDeg") is not None
        and abs(int(after_picture["rotateHundredthsDeg"]) - int(picture.get("rotateHundredthsDeg", 0))) <= ROTATION_TOLERANCE,
        json.dumps({"before": picture and picture.get("rotateHundredthsDeg"), "after": after_picture and after_picture.get("rotateHundredthsDeg")}),
    )
    edited_old = report["edit"]["oldText"]
    missing_after = [value for value in expected["slide1Text"] + expected["slide2Text"] if value != edited_old and value not in after["slideText"]]
    check("unedited text survived the reader's own save", not missing_after, f"missing={missing_after}")
    check(
        "unedited run styles survived the reader's own save",
        after["boldRuns"] == before["boldRuns"] and after["italicRuns"] == before["italicRuns"],
        json.dumps({"before": {"bold": before["boldRuns"], "italic": before["italicRuns"]}, "after": {"bold": after["boldRuns"], "italic": after["italicRuns"]}}),
    )
    check(
        "the reader's own save kept every page",
        after["slideCount"] == before["slideCount"],
        json.dumps({"before": before["slideCount"], "after": after["slideCount"]}),
    )
    check(
        "the deck is still editable after the round trip",
        after["textFrames"] == before["textFrames"] and after["pictureCount"] == 1,
        json.dumps({"textFrames": after["textFrames"], "pictures": after["pictureCount"]}),
    )
    check("the original export file was not modified by the reader", report["files"]["pptxSha256Before"] == report["files"]["pptxSha256After"], report["files"]["pptxSha256Before"])
    check(
        "the round trip produced a different, non-empty file",
        report["files"]["roundtripBytes"] > 10_000 and report["files"]["roundtripSha256"] != report["files"]["pptxSha256Before"],
        f"{report['files']['roundtripBytes']} bytes",
    )
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pptx", type=Path, default=DEFAULT_PPTX)
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--facts", type=Path, default=DEFAULT_FACTS)
    parser.add_argument(
        "--prefix",
        default="p44",
        help="Output filename prefix; use p44-svelte for the Svelte app's fixture.",
    )
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR)
    parser.add_argument("--scratch", type=Path, default=Path("/tmp/stickerlab-p44-reader"))
    args = parser.parse_args()

    if not args.pptx.exists():
        raise SystemExit(f"missing {args.pptx}; run e2e/presentations-reader-limits.spec.ts first")
    facts_path = args.facts
    if not facts_path.exists():
        raise SystemExit(
            f"missing {facts_path}; run the reader-fixture spec first "
            "(P44_EVIDENCE=1 npx playwright test e2e/presentation-reader-fixture.spec.ts)"
        )
    facts = json.loads(facts_path.read_text())
    if shutil.which("soffice") is None:
        raise SystemExit("soffice is not installed; the reader round trip cannot run")

    # Expected reader-side numbers, derived from the document the export came from.
    per_unit = 100 * 25.4 / 96  # 1/100 mm per document unit
    image_px = facts["image"]["sourcePixels"]
    document_element = facts["image"]["element"]
    expected = {
        "slideCount": facts["slideCount"],
        "pageSizeHundredthsMm": facts["pageSizeHundredthsMm"],
        "slide1Text": facts["expectedText"]["slide1"],
        "slide2Text": facts["expectedText"]["slide2"],
        "linkUrl": facts["linkUrl"],
        "imageRotationHundredthsDeg": facts["image"]["rotationHundredthsDeg"],
        "imagePositionHundredthsMm": {
            "x": round(document_element["x"] * per_unit),
            "y": round(document_element["y"] * per_unit),
        },
        "imageSizeHundredthsMm": {
            "width": round(document_element["width"] * per_unit),
            "height": round(document_element["height"] * per_unit),
        },
        # LibreOffice reports crop relative to the source image's pixels (96 dpi).
        "imageCropHundredthsMm": {
            "left": round(facts["image"]["crop"]["x"] * image_px * per_unit),
            "right": round((1 - facts["image"]["crop"]["x"] - facts["image"]["crop"]["width"]) * image_px * per_unit),
            "top": round(facts["image"]["crop"]["y"] * image_px * per_unit),
            "bottom": round((1 - facts["image"]["crop"]["y"] - facts["image"]["crop"]["height"]) * image_px * per_unit),
        },
        "fonts": ["Be Vietnam Pro", "Spectral"],
    }

    args.scratch.mkdir(parents=True, exist_ok=True)
    reader = LibreOffice(args.scratch)
    reader.start()
    context = reader.connect()

    report: dict = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "reader": {
            "application": "LibreOffice (headless, UNO automation)",
            "version": subprocess.run(["soffice", "--version"], capture_output=True, text=True, check=False).stdout.strip(),
            "python": sys.version.split()[0],
            "uno": "python3-uno (distribution package)",
            "os": platform.platform(),
            "osRelease": Path("/etc/os-release").read_text().splitlines()[0] if Path("/etc/os-release").exists() else "unknown",
            "display": "headless UNO only; the GUI window screenshot is a separate script (libreoffice_window_screenshot.py)",
        },
        "inputs": {"pptx": display_path(args.pptx), "pdf": display_path(args.pdf), "facts": display_path(facts_path)},
        "expected": expected,
        "files": {"pptxSha256Before": sha256(args.pptx)},
        "checks": [],
        "edit": {"oldText": " trước khi nộp bài.", "newText": " sau khi chỉnh sửa trong LibreOffice."},
        "observations": [],
    }

    try:
        desktop = context.ServiceManager.createInstanceWithContext("com.sun.star.frame.Desktop", context)
        props = (property_value("Hidden", True), property_value("ReadOnly", False))
        document = desktop.loadComponentFromURL(args.pptx.resolve().as_uri(), "_blank", 0, props)

        report["before"] = collect_document(document)
        # The reader's own rendering of OUR file (before any of its own re-saving).
        import_pdf = args.scratch / "import-render.pdf"
        render_pdf(document, import_pdf)
        report["files"]["readerImportPngs"] = render_pngs(
            import_pdf, args.out_dir / f"{args.prefix}-reader-import", args.out_dir
        )

        pages = document.DrawPages

        # --- the edit the acceptance asks for: change one text run ---------------
        second_page = pages.getByIndex(1)
        text_shape = next(shape for shape in (second_page.getByIndex(i) for i in range(second_page.Count)) if shape.supportsService("com.sun.star.drawing.Text"))
        target = find_run(text_shape, report["edit"]["oldText"])
        if target is None:
            raise SystemExit("the fixture run to edit was not found in the reader")
        target.setString(report["edit"]["newText"])

        # --- move the picture by one inch on each axis ---------------------------
        first_page = pages.getByIndex(0)
        move_shape = next(
            first_page.getByIndex(i) for i in range(first_page.Count) if first_page.getByIndex(i).supportsService("com.sun.star.drawing.GraphicObjectShape")
        )
        from com.sun.star.awt import Point

        start = shape_position(move_shape)
        moved = Point(start.X + HUNDREDTHS_MM_PER_INCH, start.Y + HUNDREDTHS_MM_PER_INCH)
        move_shape.setPosition(moved)
        report["edit"]["movedFromHundredthsMm"] = {"x": int(start.X), "y": int(start.Y)}
        report["edit"]["movedToHundredthsMm"] = {"x": int(moved.X), "y": int(moved.Y)}

        roundtrip = args.out_dir / f"{args.prefix}-libreoffice-roundtrip.pptx"
        document.storeToURL(
            roundtrip.resolve().as_uri(),
            (property_value("FilterName", "Impress MS PowerPoint 2007 XML"), property_value("Overwrite", True)),
        )
        document.close(True)

        # --- reopen the saved file, verify *it* and render *it* ------------------
        reopened = desktop.loadComponentFromURL(roundtrip.resolve().as_uri(), "_blank", 0, props)
        report["after"] = collect_document(reopened)
        report["edit"]["observedText"] = report["edit"]["newText"] if report["edit"]["newText"] in report["after"]["slideText"] else ""
        # The render must come from the reopened saved file, not the still-open object
        # the reader wrote from: a render of the in-memory document says nothing about
        # what is on disk or how the saved file reopens.
        roundtrip_pdf = args.scratch / "roundtrip-render.pdf"
        render_pdf(reopened, roundtrip_pdf)
        report["files"]["readerRoundtripPngs"] = render_pngs(
            roundtrip_pdf, args.out_dir / f"{args.prefix}-reader-roundtrip", args.out_dir
        )
        reopened.close(True)

        # The app's own PDF, rendered by the same external tool for comparison.
        if args.pdf.exists():
            report["files"]["appPdfPngs"] = render_pngs(
                args.pdf, args.out_dir / f"{args.prefix}-app-pdf", args.out_dir
            )
            pdfinfo = subprocess.run(["pdfinfo", str(args.pdf)], capture_output=True, text=True, check=False).stdout
            report["pdf"] = {
                "pdfinfo": {
                    line.split(":", 1)[0]: line.split(":", 1)[1].strip()
                    for line in pdfinfo.splitlines()
                    if ":" in line and line.split(":", 1)[0] in {"Pages", "Page size", "Producer", "Creator", "Encrypted"}
                },
                "textLayer": subprocess.run(["pdftotext", str(args.pdf), "-"], capture_output=True, text=True, check=False).stdout,
                "limitation": "Image-based by design: the PDF has no selectable text layer, which is the documented P37 behaviour.",
            }

        report["roundtripPackage"] = inspect_package(roundtrip)
        report["files"]["roundtrip"] = display_path(roundtrip)
        report["files"]["roundtripBytes"] = roundtrip.stat().st_size
        report["files"]["roundtripSha256"] = sha256(roundtrip)
        report["files"]["pptxSha256After"] = sha256(args.pptx)

        # --- measured rendering: import vs round trip vs the app's own raster ----
        if args.pdf.exists() and shutil.which("magick") is not None:
            frame = expected["imagePositionHundredthsMm"]
            left = int(frame["x"] / per_unit) - 60
            top = int(frame["y"] / per_unit) - 60
            region = f"420x480+{max(0, left)}+{max(0, top)}"
            mint = "#08b879"
            measurement = {
                "region": region,
                "colour": mint,
                "readerImportPage1": artwork_blob(args.out_dir / report["files"]["readerImportPngs"][0], region, mint) if report["files"]["readerImportPngs"] else None,
                "readerRoundtripPage1": artwork_blob(args.out_dir / report["files"]["readerRoundtripPngs"][0], region, mint) if report["files"]["readerRoundtripPngs"] else None,
                "appPdfPage1": artwork_blob(args.out_dir / report["files"]["appPdfPngs"][0], region, mint) if report["files"]["appPdfPngs"] else None,
                "note": "Bounding box of the cropped/flipped/rotated artwork. readerImportPage1 renders our file as first imported; readerRoundtripPage1 renders the reader's re-saved .pptx after closing and reopening it as a new document; appPdfPage1 is the app's own PDF page.",
            }
            report["rendering"] = measurement
            if measurement["readerImportPage1"] and measurement["appPdfPage1"]:
                report["observations"].append(
                    f"Picture region: reader import {measurement['readerImportPage1']} vs the app's own PDF raster {measurement['appPdfPage1']}."
                )
            # The script moves the picture by one inch, so the round-trip rendering must
            # be the import rendering shifted by exactly that move (96 px at 96 dpi).
            # Anything else would be the reader changing the placement when it saves.
            before = parse_geometry(measurement["readerImportPage1"])
            after = parse_geometry(measurement["readerRoundtripPage1"])
            if before and after:
                move_px = round(HUNDREDTHS_MM_PER_INCH / 100 / 25.4 * 96)
                delta = {"x": after[2] - before[2], "y": after[3] - before[3]}
                measurement["roundtripGeometry"] = {
                    "intendedMovePx": {"x": move_px, "y": move_px},
                    "measuredMovePx": delta,
                    "matchesIntendedMove": abs(delta["x"] - move_px) <= 3 and abs(delta["y"] - move_px) <= 3,
                    "visibleHeightChangePx": after[1] - before[1],
                    "note": "The picture moves 1 inch right and down, so its visible height shrinks where the slide edge clips it; the bounding box therefore cannot be compared without subtracting the move.",
                }
                report["observations"].append(
                    f"Round-trip geometry: reopening the reader's re-saved deck renders the picture at {measurement['readerRoundtripPage1']}, i.e. {delta['x']:+d}/{delta['y']:+d} px from the import position; the script moved it {move_px} px (one inch at 96 dpi) on each axis."
                )
                if not measurement["roundtripGeometry"]["matchesIntendedMove"]:
                    report["observations"].append(
                        "Round-trip placement differs from the intended move by more than 3 px: record this as a reader-save compatibility limitation and investigate before ticking P44."
                    )
    finally:
        reader.stop()

    failures = run_checks(report)
    report["result"] = {"failedChecks": failures, "passed": not failures}
    report_path = args.out_dir / f"{args.prefix}-reader-report.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {report_path}")
    for entry in report["checks"]:
        print(f"  [{'ok' if entry['passed'] else 'FAIL'}] {entry['check']} — {entry['detail']}")
    for observation in report["observations"]:
        print(f"  [note] {observation}")
    if failures:
        print(f"failed: {', '.join(failures)}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
