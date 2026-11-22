"""Extract Housekeep human-preference counts from data.npy into plain JSON.
Loads the pickle with a whitelist of numpy reconstructors only."""
import sys, io, json, pickle, struct
import numpy as np

ALLOWED = {('numpy', 'dtype'), ('numpy', 'ndarray'),
           ('numpy.core.multiarray', '_reconstruct'), ('numpy.core.multiarray', 'scalar')}

class Safe(pickle.Unpickler):
    def find_class(self, module, name):
        if (module, name) not in ALLOWED:
            raise pickle.UnpicklingError(f'blocked {module}.{name}')
        if module == 'numpy.core.multiarray':
            from numpy._core import multiarray as m  # numpy 2 location
            return getattr(m, name)
        return getattr(np, name)

src, out = sys.argv[1], sys.argv[2]
with open(src, 'rb') as f:
    f.read(6); ver = f.read(2)
    hl = struct.unpack('<H', f.read(2))[0] if ver[0] == 1 else struct.unpack('<I', f.read(4))[0]
    f.read(hl)
    arr = Safe(io.BytesIO(f.read()), encoding='latin1').load()
data = arr.item() if hasattr(arr, 'item') else arr
ranks, objects, rr = data['ranks'], list(data['objects']), list(data['room_receptacles'])
print('ranks', ranks.shape, 'objects', len(objects), 'room-receps', len(rr))
result = {'objects': objects, 'room_receptacles': rr, 'counts': {}}
for oi, o in enumerate(objects):
    row = {}
    for ri, r in enumerate(rr):
        v = ranks[ri, oi, :]
        v = v[~np.isnan(v)] if v.dtype.kind == 'f' else v
        before, after, impl = int((v < 0).sum()), int((v > 0).sum()), int((v == 0).sum())
        if before or after:
            row[r] = [before, after, len(v)]
    result['counts'][o] = row
json.dump(result, open(out, 'w'))
print('saved', out)
