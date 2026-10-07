# Convert the official realesr-animevideov3.pth (SRVGGNetCompact) to ONNX
# without torch: a restricted unpickler that only rebuilds tensors.
import pickle, zipfile, sys
import numpy as np
import onnx
from onnx import helper, TensorProto, numpy_helper

SRC, DST = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(SRC)
prefix = z.namelist()[0].split("/")[0]

DTYPES = {"FloatStorage": np.float32, "HalfStorage": np.float16}

class StorageType:
    def __init__(self, name): self.name = name

def rebuild_tensor_v2(storage, offset, size, stride, *rest):
    arr = storage
    n = int(np.prod(size)) if size else 1
    flat = arr[offset:offset + n] if n else arr[offset:offset]
    # Official checkpoints are contiguous; assert so we never misread one.
    exp = []
    acc = 1
    for s in reversed(size):
        exp.insert(0, acc); acc *= s
    assert tuple(stride) == tuple(exp), (size, stride)
    return flat.reshape(size).astype(np.float32)

class SafeUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        if module == "collections" and name == "OrderedDict":
            import collections; return collections.OrderedDict
        if module == "torch._utils" and name == "_rebuild_tensor_v2":
            return rebuild_tensor_v2
        if module == "torch" and name in DTYPES:
            return StorageType(name)
        raise pickle.UnpicklingError(f"blocked {module}.{name}")
    def persistent_load(self, pid):
        _, typ, key, _loc, _n = pid
        raw = z.read(f"{prefix}/data/{key}")
        return np.frombuffer(raw, dtype=DTYPES[typ.name])

state = SafeUnpickler(z.open(f"{prefix}/data.pkl")).load()
if "params" in state: state = state["params"]
keys = list(state.keys())
print(len(keys), keys[:4], keys[-2:])

inits, nodes = [], []
x = "input"
idx = sorted({int(k.split(".")[1]) for k in keys})
for i in idx:
    w = state[f"body.{i}.weight"]
    if w.ndim == 4:
        b = state[f"body.{i}.bias"]
        inits += [numpy_helper.from_array(w, f"w{i}"), numpy_helper.from_array(b, f"b{i}")]
        nodes.append(helper.make_node("Conv", [x, f"w{i}", f"b{i}"], [f"c{i}"], pads=[1, 1, 1, 1], kernel_shape=[3, 3]))
        x = f"c{i}"
    else:
        inits.append(numpy_helper.from_array(w.reshape(-1, 1, 1), f"a{i}"))
        nodes.append(helper.make_node("PRelu", [x, f"a{i}"], [f"p{i}"]))
        x = f"p{i}"
up = 4
nodes.append(helper.make_node("DepthToSpace", [x], ["shuf"], blocksize=up, mode="CRD"))
inits.append(numpy_helper.from_array(np.array([1, 1, up, up], np.float32), "scales"))
nodes.append(helper.make_node("Resize", ["input", "", "scales"], ["base"], mode="nearest"))
nodes.append(helper.make_node("Add", ["shuf", "base"], ["output"]))
g = helper.make_graph(nodes, "realesr-animevideov3",
    [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, 3, "h", "w"])],
    [helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 3, "H", "W"])], inits)
m = helper.make_model(g, opset_imports=[helper.make_opsetid("", 13)], producer_name="hycanvas-convert")
m.ir_version = 8
onnx.checker.check_model(m)
onnx.save(m, DST)
print("saved", DST)
