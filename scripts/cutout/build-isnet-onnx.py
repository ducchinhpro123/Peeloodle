#!/usr/bin/env python3
"""Build static/models/cutout/isnet-general-int8-v1.onnx from the upstream DIS weights.

Source: https://github.com/xuebinqin/DIS (Apache-2.0), isnet-general-use.pth.
Never use third-party/imgly-derived ONNX conversions.

Usage: python scripts/cutout/build-isnet-onnx.py --out static/models/cutout/isnet-general-int8-v1.onnx
Intermediates (.pth download, fp32 ONNX) go in --work (default: a temp dir).
"""
import argparse
import hashlib
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "vendor"))

# Upstream README ("isnet-general-use.pth", Google Drive link).
PTH_URL = "https://drive.google.com/uc?id=1klUkUnQFAxPdFu9XE3Vhnn-e72CVz6oM"
PTH_SHA256 = "ea0889743a78391b48d6b7c40b4def963ee329cb10934c75aa32481dc5af9c61"
OPSET = 17


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--work", default=None, help="dir for the .pth and fp32 intermediates")
    args = ap.parse_args()
    work = args.work or tempfile.mkdtemp(prefix="isnet-build-")
    os.makedirs(work, exist_ok=True)

    import torch
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from isnet import ISNetDIS  # vendored, pinned upstream commit

    pth = os.path.join(work, "isnet-general-use.pth")
    if not os.path.exists(pth):
        import gdown
        gdown.download(PTH_URL, pth, quiet=False)
    got = sha256(pth)
    if got != PTH_SHA256:
        sys.exit(f"SHA-256 mismatch for {pth}: expected {PTH_SHA256}, got {got}")

    class MaskOnly(torch.nn.Module):
        """Keep only d1 (main side output, already sigmoid)."""

        def __init__(self, net):
            super().__init__()
            self.net = net

        def forward(self, x):
            return self.net(x)[0][0]

    net = ISNetDIS()
    net.load_state_dict(torch.load(pth, map_location="cpu"))
    net.eval()
    model = MaskOnly(net).eval()

    fp32 = os.path.join(work, "isnet-general-fp32.onnx")
    torch.onnx.export(
        model,
        torch.zeros(1, 3, 1024, 1024),
        fp32,
        opset_version=OPSET,
        input_names=["input"],
        output_names=["mask"],
        dynamo=False,
        do_constant_folding=True,
    )

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    quantize_dynamic(fp32, args.out, weight_type=QuantType.QUInt8)

    print(f"out:    {args.out}")
    print(f"size:   {os.path.getsize(args.out)} bytes")
    print(f"sha256: {sha256(args.out)}")


if __name__ == "__main__":
    main()
