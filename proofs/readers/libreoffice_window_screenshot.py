#!/usr/bin/env python3
"""Capture a screenshot of a real reader window showing an exported fixture.

The P44 plan row asks for app/version/OS **and screenshots**. The round-trip
script's PNGs are rendered by the reader itself (PDF export → pdftoppm), which is
rendering evidence but not a window. This script opens the fixture in the reader's
GUI on the current Wayland/Hyprland session, captures only that window with
`grim`, and closes it again. Nothing else on the desktop is captured.

Run (LibreOffice, the default):
    python3 proofs/readers/libreoffice_window_screenshot.py

Run (OnlyOffice, the independent second reader):
    python3 proofs/readers/libreoffice_window_screenshot.py --app onlyoffice

Writes:
    proofs/out/p44-svelte-reader-window.png         the window pixels
    proofs/out/p44-svelte-reader-window.json        app/version/OS/geometry evidence
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from libreoffice_roundtrip import REPO, display_path, sha256, write_fontconfig  # noqa: E402

OUT_DIR = REPO / "proofs" / "out"
DEFAULT_FILE = OUT_DIR / "p44-svelte-reader-fixture.pptx"

APPS = {
    "libreoffice": {
        "binary": "soffice",
        "matcher": r"soffice|libreoffice",
        "title": r"impress",
        "version": ["soffice", "--version"],
    },
    "onlyoffice": {
        "binary": "onlyoffice-desktopeditors",
        "matcher": r"onlyoffice",
        "title": "",
        "version": ["onlyoffice-desktopeditors", "--version"],
    },
}


def hyprctl_clients() -> list[dict]:
    result = subprocess.run(["hyprctl", "clients", "-j"], capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def active_window_address() -> str | None:
    result = subprocess.run(
        ["hyprctl", "activewindow", "-j"], capture_output=True, text=True, check=True
    )
    try:
        return json.loads(result.stdout).get("address")
    except json.JSONDecodeError:
        return None


def find_window(app: dict, title_contains: str) -> dict | None:
    for client in hyprctl_clients():
        if not client.get("mapped", True) or client.get("hidden"):
            continue
        haystack = f"{client.get('class', '')} {client.get('initialClass', '')}"
        if not re.search(app["matcher"], haystack, re.IGNORECASE):
            continue
        title = client.get("title", "")
        if title_contains and title_contains.lower() not in title.lower():
            continue
        if app["title"] and not re.search(app["title"], title, re.IGNORECASE):
            continue
        return client
    return None


def app_version(app: dict) -> str:
    try:
        result = subprocess.run(app["version"], capture_output=True, text=True, check=False)
        text = (result.stdout or result.stderr).strip().splitlines()
        return text[0] if text else "unknown"
    except FileNotFoundError:
        return "not installed"


def launch(app: dict, fixture: Path, scratch: Path, env: dict) -> subprocess.Popen[bytes]:
    if app["binary"] == "soffice":
        profile = scratch / "lo-profile"
        command = [
            app["binary"],
            "--norestore",
            "--nologo",
            "--nofirststartwizard",
            f"-env:UserInstallation=file://{profile}",
            str(fixture),
        ]
    else:
        command = [app["binary"], str(fixture)]
    # Own process group: OnlyOffice's launcher exits while its editor children keep
    # the window alive, so termination has to target the group, not the wrapper.
    return subprocess.Popen(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
        env=env,
        start_new_session=True,
    )


def stop_reader(reader: subprocess.Popen[bytes]) -> None:
    """Terminate the reader's whole process group, escalating if it does not exit."""
    try:
        pgid = os.getpgid(reader.pid)
    except ProcessLookupError:
        return
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        reader.wait(timeout=20)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        reader.kill()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app", choices=sorted(APPS), default="libreoffice")
    parser.add_argument("--file", type=Path, default=DEFAULT_FILE)
    parser.add_argument("--out", type=Path, default=OUT_DIR / "p44-svelte-reader-window.png")
    parser.add_argument("--meta", type=Path, default=OUT_DIR / "p44-svelte-reader-window.json")
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--focus-timeout", type=float, default=20.0)
    parser.add_argument("--settle", type=float, default=4.0)
    parser.add_argument("--scratch", type=Path, default=Path("/tmp/stickerlab-p44-window"))
    args = parser.parse_args()

    if os.environ.get("WAYLAND_DISPLAY") is None:
        raise SystemExit("no WAYLAND_DISPLAY; this script needs the live Wayland session")
    for tool in ("grim", "hyprctl"):
        if shutil.which(tool) is None:
            raise SystemExit(f"{tool} is not installed")
    if not args.file.exists():
        raise SystemExit(f"missing {args.file}; generate the fixture first")
    if shutil.which(APPS[args.app]["binary"]) is None:
        raise SystemExit(f"{APPS[args.app]['binary']} is not installed")

    args.scratch.mkdir(parents=True, exist_ok=True)
    # Office suites drop a lock file next to the document; a leftover lock makes the
    # *other* reader open read-only. Track ours and remove exactly what we created.
    lock_path = args.file.parent / f".~lock.{args.file.name}#"
    lock_existed_before = lock_path.exists()
    fontconfig = write_fontconfig(args.scratch)
    env = {
        **os.environ,
        "HOME": str(args.scratch),
        "XDG_DATA_HOME": str(args.scratch / "data"),
        "XDG_CONFIG_HOME": str(args.scratch / "config"),
        "XDG_CACHE_HOME": str(args.scratch / "cache"),
        "FONTCONFIG_FILE": str(fontconfig),
    }
    reader = launch(APPS[args.app], args.file, args.scratch, env)

    def cleanup() -> None:
        stop_reader(reader)
        if not lock_existed_before and lock_path.exists():
            lock_path.unlink()

    window: dict | None = None
    deadline = time.time() + args.timeout
    while time.time() < deadline:
        if reader.poll() is not None:
            raise SystemExit(f"the reader exited before showing a window (exit {reader.returncode})")
        window = find_window(APPS[args.app], args.file.stem)
        if window is not None:
            break
        time.sleep(0.5)
    if window is None:
        cleanup()
        raise SystemExit("timed out waiting for the reader window")

    address = window["address"]
    # The reader takes focus when it opens. Hyprland 0.56's Lua dispatcher namespace
    # is not callable through `hyprctl dispatch` here, so instead of forcing focus we
    # verify it and refuse to capture an occluded window: a screenshot of whatever
    # happened to cover the reader would be misleading evidence.
    focus_deadline = time.time() + args.focus_timeout
    while time.time() < focus_deadline:
        if active_window_address() == address:
            break
        time.sleep(0.25)
    if active_window_address() != address:
        cleanup()
        raise SystemExit(
            "the reader window is not focused; bring it to the front and rerun "
            "(no screenshot was taken)"
        )

    # Let the window paint; Impress renders the first slide after its own layout pass.
    time.sleep(args.settle)

    window = find_window(APPS[args.app], args.file.stem) or window
    if active_window_address() != window["address"]:
        cleanup()
        raise SystemExit("focus moved away before the capture; no screenshot was taken")
    x, y = window["at"]
    width, height = window["size"]
    geometry = f"{x},{y} {width}x{height}"
    subprocess.run(["grim", "-g", geometry, str(args.out)], check=True)

    # Neither reader has unsaved changes here, so closing is not destructive.
    cleanup()
    close_deadline = time.time() + 15
    while time.time() < close_deadline:
        if find_window(APPS[args.app], args.file.stem) is None:
            break
        time.sleep(0.5)
    if find_window(APPS[args.app], args.file.stem) is not None:
        raise SystemExit("the reader window is still open after termination")

    meta = {
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "app": args.app,
        "appVersion": app_version(APPS[args.app]),
        "osRelease": Path("/etc/os-release").read_text().splitlines()[0]
        if Path("/etc/os-release").exists()
        else "unknown",
        "display": "Wayland/Hyprland live session; only the reader window rectangle was captured",
        "window": {
            "class": window.get("class"),
            "initialClass": window.get("initialClass"),
            "title": window.get("title"),
            "geometry": geometry,
            "workspace": window.get("workspace", {}).get("name"),
        },
        "file": {
            "path": display_path(args.file),
            "sha256": sha256(args.file),
            "bytes": args.file.stat().st_size,
        },
        "screenshot": {"path": display_path(args.out), "bytes": args.out.stat().st_size},
        "fonts": f"FONTCONFIG_FILE pointed at {display_path(fontconfig)} via an isolated HOME",
        "note": "Only the reader window region was captured; no full-screen image was taken.",
    }
    args.meta.write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {args.out} ({args.out.stat().st_size} bytes) and {args.meta}")
    print(f"  window: {meta['window']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
