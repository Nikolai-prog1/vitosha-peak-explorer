"""Merge public OSM tags and the maintainer's sourced hut facts."""

import datetime as dt


OSM_FIELDS = {
    "website": ("website", "contact:website"),
    "phone": ("phone", "contact:phone"),
    "email": ("email", "contact:email"),
    "operator": ("operator",),
    "opening_hours": ("opening_hours",),
    "reservation": ("reservation",),
    "fee": ("fee",),
    "capacity_beds": ("capacity", "beds"),
    "drinking_water": ("drinking_water",),
    "toilets": ("toilets",),
    "shower": ("shower",),
    "internet_access": ("internet_access",),
    "wheelchair": ("wheelchair",),
    "description": ("description",),
    "check_date": ("check_date",),
    "wikidata": ("wikidata",),
}
MANUAL_FIELDS = set(OSM_FIELDS) | {"water", "food", "season", "notes_bg", "notes_en", "payment", "status", "kind"}
# Operating status is a sourced manual fact; only a confirmed closure is recorded.
HUT_STATUSES = {"closed"}
# OSM tags every listed lodge as alpine_hut; a different facility kind needs a sourced manual record.
HUT_KINDS = {"hut", "shelter", "lodge"}
# Every manual record names one of the sources listed in hut-details.curated.json.
MANUAL_SOURCES = {"park", "bts"}
# The browser rejects the whole dataset outside these bounds (src/explorer-data.js).
MAX_TEXT = 3000
MAX_LIST_ITEMS = 80
MAX_LIST_TEXT = 250


def _client_text(value, limit):
    # JavaScript string lengths count UTF-16 code units.
    return isinstance(value, str) and bool(value.strip()) and len(value.encode("utf-16-le")) // 2 <= limit


def valid_detail_value(value):
    return (_client_text(value, MAX_TEXT) or isinstance(value, bool)
            or (type(value) is int and 0 < value <= 2 ** 53 - 1)
            or (isinstance(value, list) and 0 < len(value) <= MAX_LIST_ITEMS
                and all(_client_text(item, MAX_LIST_TEXT) for item in value)))


def checked_date(value):
    if not isinstance(value, str):
        return None
    try:
        return dt.date.fromisoformat(value).isoformat() if len(value) == 10 else None
    except ValueError:
        return None


def tag_value(name, value):
    if name == "check_date":
        return checked_date(value)
    if name == "capacity_beds":
        return int(value) if value.isascii() and value.isdecimal() and 0 < len(value) <= 5 and int(value) > 0 else None
    return value


def osm_details(tags):
    details = {}
    for field, qualifiers in OSM_FIELDS.items():
        for tag in qualifiers:
            value = tag_value(field, tags.get(tag, "").strip())
            if value:
                details[field] = {
                    "value": value, "source": "osm",
                    "checked": checked_date(tags.get(f"check_date:{tag}")),
                }
                break
    payments = [f"{tag.removeprefix('payment:')}={value}"
                for tag, value in sorted(tags.items()) if tag.startswith("payment:") and tag != "payment:" and value]
    if payments:
        details["payment"] = {"value": payments, "source": "osm", "checked": checked_date(tags.get("check_date:payment"))}
    return details


def manual_details(entries, hut_id):
    merged = {}
    for field, record in entries.items():
        if field not in MANUAL_FIELDS or not isinstance(record, dict):
            raise ValueError(f"{hut_id}: unknown manual hut field {field}")
        value, checked = record.get("value"), record.get("checked")
        if value is None:
            continue
        if (record.get("source") != "manual" or record.get("ref") not in MANUAL_SOURCES or not valid_detail_value(value)
                or (checked is not None and checked_date(checked) != checked)
                or (field == "status" and (value not in HUT_STATUSES or checked is None))
                or (field == "kind" and (value not in HUT_KINDS or checked is None))):
            raise ValueError(f"{hut_id}: invalid value, source or checked date for {field}")
        name = "drinking_water" if field == "water" else field
        if name in merged:
            raise ValueError(f"{hut_id}: repeated manual hut field {name}")
        merged[name] = {"value": value, "source": "manual", "ref": record["ref"], "checked": checked}
    return merged


def enrich_huts(huts, capture, curated):
    manual = curated.get("huts", {})
    if curated.get("schema_version") != 1 or set(manual) != {hut["properties"]["id"] for hut in huts}:
        raise ValueError("hut-details.curated.json must have one record for each configured hut")
    if set(curated.get("sources", {})) != MANUAL_SOURCES:
        raise ValueError("hut-details.curated.json must describe every manual source")
    tags_by_key = {(element["type"], element["id"]): element.get("tags", {}) for element in capture["elements"]}
    expected = {(hut["properties"]["source_names"].split()[1], hut["properties"]["osm_id"]) for hut in huts}
    if set(tags_by_key) != expected or len(tags_by_key) != len(capture["elements"]):
        raise ValueError("The OSM hut capture must match every configured hut by both type and ID")
    for hut in huts:
        props = hut["properties"]
        osm_type, osm_id = props["source_names"].split()[1], props["osm_id"]
        tags = tags_by_key[(osm_type, osm_id)]
        props["osm_type"] = osm_type
        props["osm_url"] = f"https://www.openstreetmap.org/{osm_type}/{osm_id}"
        props["details"] = osm_details(tags) | manual_details(manual[props["id"]], props["id"])
        if "kind" in props["details"]:
            props["kind"] = props["details"]["kind"]["value"]
        if props["elevation_m"] is None and "ele" in tags:
            try:
                props["elevation_m"] = round(float(tags["ele"].replace(",", ".")))
            except (ValueError, OverflowError):
                pass
