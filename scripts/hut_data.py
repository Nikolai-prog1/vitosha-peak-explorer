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
MANUAL_FIELDS = set(OSM_FIELDS) | {"water", "food", "season", "notes_bg", "notes_en", "payment"}


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
        valid_value = ((isinstance(value, str) and bool(value.strip()))
                       or isinstance(value, bool) or (type(value) is int and value > 0)
                       or (isinstance(value, list) and value and all(isinstance(item, str) and item.strip() for item in value)))
        if record.get("source") != "manual" or not valid_value or (checked is not None and checked_date(checked) != checked):
            raise ValueError(f"{hut_id}: invalid value, source or checked date for {field}")
        name = "drinking_water" if field == "water" else field
        if name in merged:
            raise ValueError(f"{hut_id}: repeated manual hut field {name}")
        merged[name] = {"value": value, "source": "manual", "checked": checked}
    return merged


def enrich_huts(huts, capture, curated):
    manual = curated.get("huts", {})
    if curated.get("schema_version") != 1 or set(manual) != {hut["properties"]["id"] for hut in huts}:
        raise ValueError("hut-details.curated.json must have one record for each configured hut")
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
        if props["elevation_m"] is None and "ele" in tags:
            try:
                props["elevation_m"] = round(float(tags["ele"].replace(",", ".")))
            except (ValueError, OverflowError):
                pass
