"""Build and annotate OSM hiking route relations without inventing connections."""

from park_boundary import PARK_BUFFER_M, interpolate
from trail_geometry import TrailProximity, connected_pieces, haversine_km, simplify_line, stitch_lines

TRAIL_COLOURS = {"red", "blue", "green", "yellow", "white", "black", "orange", "purple"}
TRAIL_NETWORKS = {"lwn", "rwn", "nwn", "iwn"}
OTHER_WAY_ROLES = {"alternative", "excursion", "approach", "connection"}
MIN_PARK_KM = 2
MIN_PARK_SHARE = 0.25
HEX_COLOURS = {
    "#ff0000": "red", "#0000ff": "blue", "#008000": "green", "#00ff00": "green", "#ffff00": "yellow",
    "#ffffff": "white", "#000000": "black", "#ffa500": "orange", "#800080": "purple",
}


def trail_colour(tags):
    for raw in ((tags.get("osmc:symbol") or "").split(":")[0], tags.get("colour") or ""):
        value = raw.strip().lower()
        if len(value) == 4 and value.startswith("#"):
            value = "#" + "".join(channel * 2 for channel in value[1:])
        value = HEX_COLOURS.get(value, value)
        if value in TRAIL_COLOURS:
            return value
    return None


def way_in_park(geometry, boundary):
    points = [None if point is None else (round(point["lon"], 7), round(point["lat"], 7)) for point in geometry]
    lines = []
    within_km = total_km = 0.0
    clipped = False
    for start, end in zip(points, points[1:]):
        if start is None or end is None or start == end:
            continue
        total_km += haversine_km(start, end)
        # A centimetre inside the buffer protects the strict 300 m limit when
        # the boundary intersections are rounded to seven decimal places.
        interior, buffered = boundary.intervals(start, end, radius=PARK_BUFFER_M - 0.01)
        within_km += sum(haversine_km(interpolate(start, end, low), interpolate(start, end, high))
                         for low, high in interior)
        clipped |= buffered != [(0, 1)]
        for low, high in buffered:
            first, last = (tuple(round(value, 7) for value in interpolate(start, end, t)) for t in (low, high))
            if first == last:
                continue
            if lines and lines[-1][-1] == first:
                lines[-1].append(last)
            else:
                lines.append([first, last])
    return lines, within_km, total_km, clipped


def build_marked_trails(capture, boundary, tolerance=3):
    features, raw_lines, excluded = [], {}, []
    for relation in sorted(capture["elements"], key=lambda element: element["id"]):
        tags = relation["tags"]
        if relation["type"] != "relation" or tags.get("type") != "route" or tags.get("route") not in {"hiking", "foot"}:
            continue
        lines = []
        counted_ids = set()
        roles = set()
        within_km = total_km = 0.0
        clipped = False
        complete = True
        for member in relation.get("members", []):
            if member["type"] != "way":
                continue
            way_id, role = member["ref"], member.get("role", "")
            if role in OTHER_WAY_ROLES:
                roles.add((way_id, role))
            if way_id in counted_ids:
                continue
            counted_ids.add(way_id)
            geometry = member.get("geometry") or []
            if len(geometry) < 2 or any(point is None for point in geometry):
                complete = False
            parts, inside, full, way_clipped = way_in_park(geometry, boundary)
            lines.extend(parts)
            within_km += inside
            total_km += full
            clipped |= way_clipped
        relation_id = relation["id"]
        trail_id = f"trail-{relation_id}"
        name_bg = tags.get("name:bg") or tags.get("name") or tags.get("ref")
        park_share = min(within_km / total_km, 1) if total_km else 0
        coverage = {"park_length_km": round(within_km, 6), "relation_length_km": round(total_km, 6),
                    "park_share": round(park_share, 6)}
        reasons = []
        if within_km < MIN_PARK_KM:
            reasons.append("short_in_park")
        if park_share < MIN_PARK_SHARE:
            reasons.append("small_park_share")
        if not complete:
            reasons.append("incomplete_relation_geometry")
        if reasons:
            excluded.append({"id": trail_id, "name_bg": name_bg, "ref": tags.get("ref"), **coverage, "reasons": reasons})
            continue
        length = sum(haversine_km(start, end) for line in lines for start, end in zip(line, line[1:]))
        raw_lines[trail_id] = lines
        features.append({
            "type": "Feature",
            "properties": {
                "id": trail_id,
                "osm_relation_id": relation_id,
                "osm_url": f"https://www.openstreetmap.org/relation/{relation_id}",
                "wmt_url": f"https://hiking.waymarkedtrails.org/#route?id={relation_id}&type=relation",
                "name_bg": name_bg,
                "name_en": tags.get("name:en") or tags.get("int_name") or name_bg,
                "ref": tags.get("ref"),
                "network": tags["network"] if tags.get("network") in TRAIL_NETWORKS else None,
                "operator": tags.get("operator"),
                "from": tags.get("from"),
                "to": tags.get("to"),
                "osmc_symbol": tags.get("osmc:symbol"),
                "colour": trail_colour(tags),
                "length_km": round(length, 3),
                **coverage,
                "piece_count": connected_pieces(lines),
                "alternative_way_count": sum(role == "alternative" for _, role in roles),
                "way_roles": [{"osm_way_id": way_id, "role": role} for way_id, role in sorted(roles)],
                "clipped": clipped,
            },
            "geometry": {"type": "MultiLineString",
                         "coordinates": [simplify_line(line, tolerance, boundary.contains_segment) for line in stitch_lines(lines)]},
        })
    if len(features) < 5:
        raise ValueError("Fewer than five marked hiking routes with geometry within Vitosha")
    return features, raw_lines, excluded


def annotate_approaches(routes, trails, raw_lines):
    trail_props = {trail["properties"]["id"]: trail["properties"] for trail in trails}
    proximity = TrailProximity(raw_lines)
    for route in routes:
        props = route["properties"]
        shares, total = proximity.shares(route["geometry"]["coordinates"][0])
        props["marked_share"] = total
        props["marked_trails"] = [
            {"trail_id": trail_id, "ref": trail_props[trail_id]["ref"],
             "colour": trail_props[trail_id]["colour"], "share": share}
            for trail_id, share in sorted(shares.items(), key=lambda pair: (-pair[1], pair[0])) if share > 0
        ]
