"""Validate USDA Forest Service trail geometry before advancing catalog cursors."""
import math


def cursor_below_current_source_range(saved_cursor, total_count, older_count, page_size=1000):
    """Detect a partial cursor stranded below a refreshed source's ID range."""
    return (saved_cursor is not None and older_count == 0 and total_count > page_size)


def retain_record_without_geometry(records, route_id, cycle):
    """Keep a prior verified-shape discovery when the source omits its shape.

    A missing shape is not evidence that the source record disappeared. New
    records without geometry are intentionally not added to the route catalog.
    """
    existing = records.get(route_id)
    if existing is None:
        return False
    existing['lastSeenCycle'] = cycle
    return True


def trail_center(geometry, object_id):
    if not isinstance(geometry, dict) or not isinstance(geometry.get('paths'), list):
        raise ValueError(f'USFS trail {object_id} has no polyline geometry')
    points = []
    for path in geometry['paths']:
        if not isinstance(path, list):
            raise ValueError(f'USFS trail {object_id} has an invalid path')
        for point in path:
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                raise ValueError(f'USFS trail {object_id} has an invalid coordinate pair')
            longitude, latitude = point[:2]
            if any(not isinstance(value, (int, float)) or isinstance(value, bool)
                   or not math.isfinite(value) for value in (longitude, latitude)):
                raise ValueError(f'USFS trail {object_id} has a non-finite coordinate')
            if abs(longitude) > 180 or abs(latitude) > 90:
                raise ValueError(f'USFS trail {object_id} coordinate is outside WGS84 bounds')
            points.append((longitude, latitude))
    if not points:
        raise ValueError(f'USFS trail {object_id} has no usable coordinates')
    return [round(sum(point[axis] for point in points) / len(points), 5) for axis in (0, 1)]
