# Enhance model for Vectorize

`frontend/public/models/realesr-animevideov3.onnx` is the official Real-ESRGAN
`realesr-animevideov3.pth` (release v0.2.5.0 of github.com/xinntao/Real-ESRGAN,
BSD-3-Clause, SHA-256 `b8a8376811077954d82ca3fcf476f1ac3da3e8a68a4f4d71363008000a18b75d`)
converted to ONNX with `convert.py`. The converter reads the checkpoint with a
restricted unpickler that only rebuilds tensors (no torch, no arbitrary code)
and writes the SRVGGNetCompact graph (16 conv + PReLU layers, 4x pixel shuffle,
nearest-upsampled residual).

Reproduce:

    curl -LO https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-animevideov3.pth
    pip install onnx numpy
    python convert.py realesr-animevideov3.pth realesr-animevideov3.onnx
