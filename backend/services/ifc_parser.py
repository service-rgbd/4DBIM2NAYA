"""Pure-Python IFC (ISO-10303-21 / STEP) metadata extractor. Geometry is rendered client-side by web-ifc."""
import re
from collections import defaultdict
from typing import Callable, Optional

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


def _read_string(s: str, i: int):
    """Reads a STEP string starting at the opening quote; '' is an escaped quote."""
    j, buf = i + 1, []
    while True:
        k = s.index("'", j)
        if k + 1 < len(s) and s[k + 1] == "'":
            buf.append(s[j:k] + "'")
            j = k + 2
            continue
        buf.append(s[j:k])
        return _decode("".join(buf)), k + 1


def _close(stack: list):
    v = stack.pop()
    stack[-1].append({"type": v.name, "value": v[0] if len(v) == 1 else list(v)} if isinstance(v, _Typed) else v)


def _read_token(s: str, i: int, stack: list) -> int:
    m = _TOKEN.match(s, i)
    tok, i = m.group(), m.end()
    while i < len(s) and s[i] in " \t\r\n":
        i += 1
    if i < len(s) and s[i] == "(" and re.match(r"^[A-Z][A-Z0-9_]*$", tok):
        stack.append(_Typed(tok))
        return i + 1
    stack[-1].append(_conv(tok))
    return i


def parse_args(s: str) -> list:
    stack, i, n = [[]], 0, len(s)
    while i < n:
        c = s[i]
        if c == "'":
            v, i = _read_string(s, i)
            stack[-1].append(v)
        elif c == "(":
            stack.append([])
            i += 1
        elif c == ")":
            _close(stack)
            i += 1
        elif c in ", \r\n\t":
            i += 1
        else:
            i = _read_token(s, i, stack)
    return stack[0]


def split_statements(data: str) -> list:
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


def discipline_of(ifc_type: str) -> str:
    t = ifc_type.upper().replace("IFC", "", 1)
    if any(t.startswith(p) for p in STRUCT):
        return "Structure"
    if any(t.startswith(p) for p in MEP):
        return "CVC / Fluides"
    if any(t.startswith(p) for p in ARCHI):
        return "Architecture"
    return "Autre"


def _opt_str(a: list, i: int) -> Optional[str]:
    return a[i] if len(a) > i and isinstance(a[i], str) else None


_MATERIAL_NEXT = {
    "IFCMATERIALLIST": lambda a: a[0] or [],
    "IFCMATERIALLAYERSETUSAGE": lambda a: [a[0]],
    "IFCMATERIALLAYERSET": lambda a: a[0] or [],
    "IFCMATERIALLAYER": lambda a: [a[0]] if a[0] is not None else [],
}


class IfcIndex:
    """Lazy index over STEP entities and the relationships needed for metadata extraction."""

    def __init__(self, types: dict, raw_args: dict):
        self.types, self.raw, self.cache = types, raw_args, {}
        self.contained, self.parent_of, self.type_of, self.mat_of = {}, {}, {}, {}
        self.children, self.psets_of = defaultdict(list), defaultdict(list)
        self.root_ids, self.storey_name = set(), {}
        handlers = {
            "IFCRELCONTAINEDINSPATIALSTRUCTURE": self._rel_contained,
            "IFCRELAGGREGATES": self._rel_aggregates,
            "IFCRELNESTS": self._rel_aggregates,
            "IFCRELDEFINESBYPROPERTIES": lambda a: self._rel_many(a, self.psets_of),
            "IFCRELDEFINESBYTYPE": lambda a: self._rel_one(a, self.type_of),
            "IFCRELASSOCIATESMATERIAL": lambda a: self._rel_one(a, self.mat_of),
        }
        for eid, t in types.items():
            if t in handlers:
                handlers[t](self.args(eid))

    def args(self, eid: int) -> list:
        if eid not in self.cache:
            self.cache[eid] = parse_args(self.raw[eid])
        return self.cache[eid]

    def _rel_contained(self, a: list):
        for r in a[4] or []:
            self.contained[int(r)] = int(a[5])
            self.root_ids.add(int(r))

    def _rel_aggregates(self, a: list):
        for r in a[5] or []:
            self.parent_of[int(r)] = int(a[4])
            self.children[int(a[4])].append(int(r))

    @staticmethod
    def _rel_one(a: list, target: dict):
        for r in a[4] or []:
            target[int(r)] = int(a[5])

    @staticmethod
    def _rel_many(a: list, target: dict):
        for r in a[4] or []:
            target[int(r)].append(int(a[5]))

    def material_names(self, mid: Optional[int], depth: int = 0) -> list:
        if mid is None or depth > 4 or mid not in self.types:
            return []
        t, a = self.types[mid], self.args(mid)
        if t == "IFCMATERIAL":
            return [a[0]]
        nxt = _MATERIAL_NEXT.get(t, lambda _: [])(a)
        return [n for r in nxt for n in self.material_names(int(r), depth + 1)]

    def _refs_of_type(self, refs, prefix: str) -> list:
        return [self.args(int(r)) for r in refs or [] if self.types.get(int(r), "").startswith(prefix)]

    def properties(self, eid: int) -> list:
        props = []
        for pid in self.psets_of.get(eid, []):
            t = self.types.get(pid)
            if t == "IFCPROPERTYSET":
                a = self.args(pid)
                props += [{"pset": a[2] or "", "name": p[0], "value": _val(p[2])} for p in self._refs_of_type(a[4], "IFCPROPERTYSINGLEVALUE")]
            elif t == "IFCELEMENTQUANTITY":
                a = self.args(pid)
                props += [{"pset": a[2] or "Quantités", "name": q[0], "value": _val(q[3])} for q in self._refs_of_type(a[5], "IFCQUANTITY")]
        return props

    def _type_props(self, eid: int) -> list:
        tid = self.type_of.get(eid)
        if tid not in self.types:
            return []
        ta = self.args(tid)
        head = [{"pset": "Type", "name": "Nom du type", "value": ta[2] if len(ta) > 2 else None}]
        return head + [{**p, "pset": f"Type · {p['pset']}"} for p in self.properties(tid)]

    def _material_props(self, eid: int) -> list:
        mats = [m for m in self.material_names(self.mat_of.get(eid)) if m]
        return [{"pset": "Matériaux", "name": "Matériau", "value": ", ".join(dict.fromkeys(mats))}] if mats else []

    def spatial(self) -> list:
        out = []
        for eid, t in self.types.items():
            if t not in SPATIAL:
                continue
            a = self.args(eid)
            elev = a[9] if t == "IFCBUILDINGSTOREY" and len(a) > 9 and isinstance(a[9], (int, float)) else None
            out.append({"express_id": eid, "global_id": a[0], "ifc_type": t, "name": a[2] or t, "elevation": elev, "parent": self.parent_of.get(eid)})
        self.storey_name = {s["express_id"]: s["name"] for s in out if s["ifc_type"] == "IFCBUILDINGSTOREY"}
        return out

    def storey_for(self, eid: Optional[int], depth: int = 0) -> Optional[str]:
        if depth > 20 or eid is None:
            return None
        if eid in self.storey_name:
            return self.storey_name[eid]
        return self.storey_for(self.contained.get(eid, self.parent_of.get(eid)), depth + 1)

    def element_ids(self, spatial_ids: set) -> list:
        """Elements contained in the spatial structure plus their aggregated parts."""
        out, stack, seen = [], list(self.root_ids), set()
        while stack:
            eid = stack.pop()
            if eid in seen or eid not in self.types:
                continue
            seen.add(eid)
            if eid not in spatial_ids and self.types[eid] not in SKIP:
                out.append(eid)
            stack.extend(self.children.get(eid, []))
        return sorted(out)

    def element(self, eid: int) -> Optional[dict]:
        a, t = self.args(eid), self.types[eid]
        if not a or not isinstance(a[0], str):
            return None
        props = self.properties(eid) + self._type_props(eid) + self._material_props(eid)
        return {
            "express_id": eid, "global_id": a[0], "ifc_type": t, "name": a[2] or "",
            "object_type": _opt_str(a, 4), "tag": _opt_str(a, 7),
            "storey": self.storey_for(eid) or "Non localisé", "parent_express_id": self.parent_of.get(eid),
            "discipline": discipline_of(t), "properties": props[:300],
        }

    def _unit_name(self, uid: int) -> Optional[str]:
        ut = self.types.get(uid)
        if ut not in ("IFCSIUNIT", "IFCCONVERSIONBASEDUNIT"):
            return None
        ua = self.args(uid)
        if ua[1] != "LENGTHUNIT":
            return None
        if ut == "IFCSIUNIT":
            return SI_PREFIX.get(ua[2], "") + ("m" if ua[3] == "METRE" else str(ua[3]))
        return str(ua[2]).lower()

    def length_unit(self) -> str:
        assignment = next((eid for eid, t in self.types.items() if t == "IFCUNITASSIGNMENT"), None)
        if assignment is None:
            return "inconnue"
        names = [self._unit_name(int(r)) for r in self.args(assignment)[0] or []]
        return next((n for n in names if n), "inconnue")


def _read_header(text: str):
    if not text.lstrip().startswith("ISO-10303-21"):
        raise ValueError("Fichier non conforme ISO-10303-21 (en-tête STEP absent)")
    schema_m = re.search(r"FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'", text)
    di = text.find("DATA;")
    if di < 0:
        raise ValueError("Section DATA absente du fichier IFC")
    return (schema_m.group(1) if schema_m else "inconnu"), text[di + 5:]


def _index_entities(stmts: list):
    types, raw_args = {}, {}
    for st in stmts:
        m = _ENTITY.match(st)
        if m:
            eid = int(m.group(1))
            types[eid], raw_args[eid] = m.group(2).upper(), m.group(3)
    if not types:
        raise ValueError("Aucune entité IFC trouvée")
    return types, raw_args


def parse_ifc(raw: bytes, progress: Callable[[int], None] = lambda p: None) -> dict:
    schema, data = _read_header(raw.decode("latin-1"))
    stmts = split_statements(data)
    progress(10)
    types, raw_args = _index_entities(stmts)
    progress(25)
    idx = IfcIndex(types, raw_args)
    progress(45)
    spatial = idx.spatial()
    ids = idx.element_ids({s["express_id"] for s in spatial})
    progress(60)
    elements = []
    for i, eid in enumerate(ids):
        e = idx.element(eid)
        if e:
            elements.append(e)
        if i % 200 == 0:
            progress(60 + int(35 * i / max(len(ids), 1)))
    unit = idx.length_unit()
    progress(97)
    return {"schema": schema, "length_unit": unit, "entity_count": len(types), "spatial": spatial, "elements": elements}
