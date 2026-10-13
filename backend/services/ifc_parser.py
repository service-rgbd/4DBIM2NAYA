"""Pure-Python IFC (ISO-10303-21 / STEP) metadata extractor. Geometry is rendered client-side by web-ifc."""
import re
from collections import defaultdict

SPATIAL = {"IFCPROJECT", "IFCSITE", "IFCBUILDING", "IFCBUILDINGSTOREY", "IFCSPACE"}
SKIP = {"IFCOPENINGELEMENT", "IFCVIRTUALELEMENT", "IFCANNOTATION", "IFCGRID"}
INTERESTING = SPATIAL | {
    "IFCRELCONTAINEDINSPATIALSTRUCTURE", "IFCRELAGGREGATES", "IFCRELNESTS", "IFCRELDEFINESBYPROPERTIES",
    "IFCRELDEFINESBYTYPE", "IFCPROPERTYSET", "IFCPROPERTYSINGLEVALUE", "IFCELEMENTQUANTITY", "IFCQUANTITYLENGTH",
    "IFCQUANTITYAREA", "IFCQUANTITYVOLUME", "IFCQUANTITYCOUNT", "IFCQUANTITYWEIGHT", "IFCRELASSOCIATESMATERIAL",
    "IFCMATERIAL", "IFCMATERIALLIST", "IFCMATERIALLAYERSETUSAGE", "IFCMATERIALLAYERSET", "IFCMATERIALLAYER",
    "IFCUNITASSIGNMENT", "IFCSIUNIT", "IFCCONVERSIONBASEDUNIT",
}
STRUCT = ("BEAM", "COLUMN", "SLAB", "FOOTING", "PILE", "MEMBER", "PLATE", "REINFORCING", "TENDON")
ARCHI = ("WALL", "DOOR", "WINDOW", "ROOF", "STAIR", "RAILING", "COVERING", "CURTAINWALL", "RAMP", "FURNISH", "CHIMNEY", "SHADING")
MEP = ("FLOW", "DISTRIBUTION", "DUCT", "PIPE", "CABLE", "ENERGY", "SANITARY", "LIGHT", "AIRTERMINAL", "PUMP", "VALVE", "TANK")
SI_PREFIX = {"MILLI": "m", "CENTI": "c", "DECI": "d", "KILO": "k"}


class Ref(int):
    pass


class _Typed(list):
    def __init__(self, name):
        super().__init__()
        self.name = name


_TOKEN = re.compile(r"[^,()'\s]+")
_ENC = re.compile(r"\\X2\\([0-9A-Fa-f]+)\\X0\\|\\X\\([0-9A-Fa-f]{2})|\\S\\(.)")


def _decode(s):
    def rep(m):
        if m.group(1):
            h = m.group(1)
            return "".join(chr(int(h[i:i + 4], 16)) for i in range(0, len(h), 4))
        if m.group(2):
            return bytes([int(m.group(2), 16)]).decode("latin-1")
        return chr(ord(m.group(3)) + 128)
    return _ENC.sub(rep, s).replace("\\\\", "\\")


def _conv(tok):
    if tok.startswith("#"):
        return Ref(int(tok[1:]))
    if tok in ("$", "*"):
        return None
    if tok.startswith(".") and tok.endswith("."):
        v = tok[1:-1]
        return True if v == "T" else False if v == "F" else v
    try:
        return int(tok)
    except ValueError:
        try:
            return float(tok)
        except ValueError:
            return tok


def parse_args(s):
    stack, i, n = [[]], 0, len(s)
    while i < n:
        c = s[i]
        if c == "'":
            j, buf = i + 1, []
            while True:
                k = s.index("'", j)
                if k + 1 < n and s[k + 1] == "'":
                    buf.append(s[j:k] + "'")
                    j = k + 2
                    continue
                buf.append(s[j:k])
                i = k + 1
                break
            stack[-1].append(_decode("".join(buf)))
        elif c == "(":
            stack.append([])
            i += 1
        elif c == ")":
            v = stack.pop()
            if isinstance(v, _Typed):
                stack[-1].append({"type": v.name, "value": v[0] if len(v) == 1 else list(v)})
            else:
                stack[-1].append(v)
            i += 1
        elif c in ", \r\n\t":
            i += 1
        else:
            m = _TOKEN.match(s, i)
            tok = m.group()
            i = m.end()
            while i < n and s[i] in " \t\r\n":
                i += 1
            if i < n and s[i] == "(" and re.match(r"^[A-Z][A-Z0-9_]*$", tok):
                stack.append(_Typed(tok))
                i += 1
            else:
                stack[-1].append(_conv(tok))
    return stack[0]


def split_statements(data):
    out, start, in_str = [], 0, False
    for m in re.finditer(r"[';]", data):
        if m.group() == "'":
            in_str = not in_str
        elif not in_str:
            out.append(data[start:m.start()])
            start = m.end()
    return out


_ENTITY = re.compile(r"\s*#(\d+)\s*=\s*([A-Za-z0-9_]+)\s*\((.*)\)\s*$", re.S)


def _val(v):
    if isinstance(v, dict):
        v = v.get("value")
    if isinstance(v, float):
        return round(v, 4)
    if isinstance(v, (list, tuple)):
        return ", ".join(str(_val(x)) for x in v)
    return v


def discipline_of(ifc_type):
    t = ifc_type.upper().replace("IFC", "", 1)
    if any(t.startswith(p) for p in STRUCT):
        return "Structure"
    if any(t.startswith(p) for p in MEP):
        return "CVC / Fluides"
    if any(t.startswith(p) for p in ARCHI):
        return "Architecture"
    return "Autre"


def parse_ifc(raw: bytes, progress=lambda p: None):
    text = raw.decode("latin-1")
    if not text.lstrip().startswith("ISO-10303-21"):
        raise ValueError("Fichier non conforme ISO-10303-21 (en-tête STEP absent)")
    schema_m = re.search(r"FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'", text)
    schema = schema_m.group(1) if schema_m else "inconnu"
    di = text.find("DATA;")
    if di < 0:
        raise ValueError("Section DATA absente du fichier IFC")
    stmts = split_statements(text[di + 5:])
    progress(10)
    types, raw_args = {}, {}
    for st in stmts:
        m = _ENTITY.match(st)
        if not m:
            continue
        eid, t = int(m.group(1)), m.group(2).upper()
        types[eid] = t
        raw_args[eid] = m.group(3)
    if not types:
        raise ValueError("Aucune entité IFC trouvée")
    progress(25)
    cache = {}

    def args(eid):
        if eid not in cache:
            cache[eid] = parse_args(raw_args[eid])
        return cache[eid]

    contained, parent_of, children = {}, {}, defaultdict(list)
    psets_of, type_of, mat_of = defaultdict(list), {}, {}
    root_ids = set()
    for eid, t in types.items():
        if t == "IFCRELCONTAINEDINSPATIALSTRUCTURE":
            a = args(eid)
            for r in a[4] or []:
                contained[int(r)] = int(a[5])
                root_ids.add(int(r))
        elif t in ("IFCRELAGGREGATES", "IFCRELNESTS"):
            a = args(eid)
            for r in a[5] or []:
                parent_of[int(r)] = int(a[4])
                children[int(a[4])].append(int(r))
        elif t == "IFCRELDEFINESBYPROPERTIES":
            a = args(eid)
            for r in a[4] or []:
                psets_of[int(r)].append(int(a[5]))
        elif t == "IFCRELDEFINESBYTYPE":
            a = args(eid)
            for r in a[4] or []:
                type_of[int(r)] = int(a[5])
        elif t == "IFCRELASSOCIATESMATERIAL":
            a = args(eid)
            for r in a[4] or []:
                mat_of[int(r)] = int(a[5])
    progress(45)

    def material_names(mid, depth=0):
        if mid is None or depth > 4 or mid not in types:
            return []
        t, a = types[mid], args(mid)
        if t == "IFCMATERIAL":
            return [a[0]]
        if t == "IFCMATERIALLIST":
            return [n for r in a[0] or [] for n in material_names(int(r), depth + 1)]
        if t == "IFCMATERIALLAYERSETUSAGE":
            return material_names(int(a[0]), depth + 1)
        if t == "IFCMATERIALLAYERSET":
            return [n for r in a[0] or [] for n in material_names(int(r), depth + 1)]
        if t == "IFCMATERIALLAYER":
            return material_names(int(a[0]) if a[0] is not None else None, depth + 1)
        return []

    def properties(eid):
        props = []
        for pid in psets_of.get(eid, []):
            if pid not in types:
                continue
            t, a = types[pid], args(pid)
            if t == "IFCPROPERTYSET":
                for r in a[4] or []:
                    if types.get(int(r)) == "IFCPROPERTYSINGLEVALUE":
                        pa = args(int(r))
                        props.append({"pset": a[2] or "", "name": pa[0], "value": _val(pa[2])})
            elif t == "IFCELEMENTQUANTITY":
                for r in a[5] or []:
                    if types.get(int(r), "").startswith("IFCQUANTITY"):
                        qa = args(int(r))
                        props.append({"pset": a[2] or "Quantités", "name": qa[0], "value": _val(qa[3])})
        return props

    spatial = []
    for eid, t in types.items():
        if t in SPATIAL:
            a = args(eid)
            spatial.append({
                "express_id": eid, "global_id": a[0], "ifc_type": t, "name": a[2] or t,
                "elevation": a[9] if t == "IFCBUILDINGSTOREY" and len(a) > 9 and isinstance(a[9], (int, float)) else None,
                "parent": parent_of.get(eid),
            })
    spatial_ids = {s["express_id"] for s in spatial}
    storey_name = {s["express_id"]: s["name"] for s in spatial if s["ifc_type"] == "IFCBUILDINGSTOREY"}

    def storey_for(eid, depth=0):
        if depth > 20 or eid is None:
            return None
        if eid in storey_name:
            return storey_name[eid]
        if eid in contained:
            return storey_for(contained[eid], depth + 1)
        return storey_for(parent_of.get(eid), depth + 1)

    element_ids, stack = [], list(root_ids)
    seen = set()
    while stack:
        eid = stack.pop()
        if eid in seen or eid not in types:
            continue
        seen.add(eid)
        if eid not in spatial_ids and types[eid] not in SKIP:
            element_ids.append(eid)
        stack.extend(children.get(eid, []))
    progress(60)

    elements, total = [], max(len(element_ids), 1)
    for i, eid in enumerate(sorted(element_ids)):
        a, t = args(eid), types[eid]
        if not a or not isinstance(a[0], str):
            continue
        props = properties(eid)
        tid = type_of.get(eid)
        if tid in types:
            ta = args(tid)
            props.append({"pset": "Type", "name": "Nom du type", "value": ta[2] if len(ta) > 2 else None})
            props.extend({**p, "pset": f"Type · {p['pset']}"} for p in properties(tid))
        mats = material_names(mat_of.get(eid))
        if mats:
            props.append({"pset": "Matériaux", "name": "Matériau", "value": ", ".join(dict.fromkeys(m for m in mats if m))})
        elements.append({
            "express_id": eid, "global_id": a[0], "ifc_type": t, "name": a[2] or "",
            "object_type": a[4] if len(a) > 4 and isinstance(a[4], str) else None,
            "tag": a[7] if len(a) > 7 and isinstance(a[7], str) else None,
            "storey": storey_for(eid) or "Non localisé", "parent_express_id": parent_of.get(eid),
            "discipline": discipline_of(t), "properties": props[:300],
        })
        if i % 200 == 0:
            progress(60 + int(35 * i / total))

    unit = "inconnue"
    for eid, t in types.items():
        if t == "IFCUNITASSIGNMENT":
            for r in args(eid)[0] or []:
                ut = types.get(int(r))
                if ut == "IFCSIUNIT":
                    ua = args(int(r))
                    if ua[1] == "LENGTHUNIT":
                        unit = SI_PREFIX.get(ua[2], "") + ("m" if ua[3] == "METRE" else str(ua[3]))
                elif ut == "IFCCONVERSIONBASEDUNIT":
                    ua = args(int(r))
                    if ua[1] == "LENGTHUNIT":
                        unit = str(ua[2]).lower()
            break
    progress(97)
    return {"schema": schema, "length_unit": unit, "entity_count": len(types), "spatial": spatial, "elements": elements}
