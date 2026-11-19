"""Build and annotate OSM hiking route relations without inventing connections."""

import math

from trail_geometry import TrailProximity, clipped_way, connected_pieces, metres, simplify_line, stitch_lines

TRAIL_COLOURS = {"red", "blue", "green", "yellow", "white", "black", "orange", "purple"}
TRAIL_NETWORKS = {"lwn", "rwn", "nwn", "iwn"}
OTHER_WAY_ROLES = {"alternative", "excursion", "approach", "connection"}
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


def build_marked_trails(capture, tolerance=3):
    features, raw_lines = [], {}
    for relation in sorted(capture["elements"], key=lambda element: element["id"]):
        tags = relation["tags"]
        if relation["type"] != "relation" or tags.get("type") != "route" or tags.get("route") not in {"hiking", "foot"}:
            continue
        lines = []
        counted_ids = set()
        roles = set()
        clipped = False
        for member in relation.get("members", []):
            if member["type"] != "way":
                continue
            way_id, role = member["ref"], member.get("role", "")
            if role in OTHER_WAY_ROLES:
                roles.add((way_id, role))
            if way_id in counted_ids or not member.get("geometry"):
                continue
            counted_ids.add(way_id)
            parts, way_clipped = clipped_way(member["geometry"])
            lines.extend(parts)
            clipped |= way_clipped
        if not lines:
            continue
        relation_id = relation["id"]
        trail_id = f"trail-{relation_id}"
        name_bg = tags.get("name:bg") or tags.get("name") or tags.get("ref")
        length = sum(math.dist(metres(start), metres(end)) for line in lines for start, end in zip(line, line[1:]))
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
                "length_km": round(length / 1000, 3),
                "piece_count": connected_pieces(lines),
                "alternative_way_count": sum(role == "alternative" for _, role in roles),
                "way_roles": [{"osm_way_id": way_id, "role": role} for way_id, role in sorted(roles)],
                "clipped": clipped,
            },
            "geometry": {"type": "MultiLineString", "coordinates": [simplify_line(line, tolerance) for line in stitch_lines(lines)]},
        })
    if len(features) < 5:
        raise ValueError("Fewer than five marked hiking routes with geometry within Vitosha")
    return features, raw_lines


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
