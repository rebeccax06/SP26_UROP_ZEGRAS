"""
Curated OSM relation identifiers for the Massachusetts cities the LTS
pipeline runs against.

Each entry's `key` / `value` pair must uniquely match the relation on
openstreetmap.org. The most reliable choice is usually `wikipedia` +
the English Wikipedia page title, but any tag works as long as it
returns exactly one relation. Add a new city by inspecting it on
openstreetmap.org and copying a tag pair.
"""

CITIES = {
    "Arlington": {
        "key": "wikipedia",
        "value": "en:Arlington, Massachusetts"
    },
    "Belmont": {
        "key": "wikipedia",
        "value": "en:Belmont, Massachusetts"
    },
    "Boston": {
        "key": "wikipedia",
        "value": "en:Boston"
    },
    "Brookline": {
        "key": "wikipedia",
        "value": "en:Brookline, Massachusetts"
    },
    "Cambridge": {
        "key": "wikipedia",
        "value": "en:Cambridge, Massachusetts"
    },
    "Chelsea": {
        "key": "wikipedia",
        "value": "en:Chelsea, Massachusetts"
    },
    "Everett": {
        "key": "wikipedia",
        "value": "en:Everett, Massachusetts"
    },
    "Malden": {
        "key": "wikipedia",
        "value": "en:Malden, Massachusetts"
    },
    "Medford": {
        "key": "wikipedia",
        "value": "en:Medford, Massachusetts"
    },
    "Newton": {
        "key": "wikipedia",
        "value": "en:Newton, Massachusetts"
    },
    "Lexington": {
        "key": "wikipedia",
        "value": "en:Lexington, Massachusetts"
    },
    "Somerville": {
        "key": "wikipedia",
        "value": "en:Somerville, Massachusetts"
    },
    "Waltham": {
        "key": "wikipedia",
        "value": "en:Waltham, Massachusetts"
    },
    "Watertown": {
        "key": "wikipedia",
        "value": "en:Watertown, Massachusetts"
    }
}
